"""A HuggingFace smolagents remote executor backed by a Tenki sandbox.

smolagents' `CodeAgent` writes Python *as its actions* and runs it through a
`RemotePythonExecutor` — the same seam its E2B / Docker / Modal / Blaxel
executors plug into (see `smolagents/remote_executors.py`). `TenkiExecutor`
implements that seam against a disposable [Tenki](https://tenki.cloud) microVM.

The catch: `CodeAgent` needs a *stateful* namespace. It defines the tools once
(`send_tools`), then every step's code shares variables with the previous step.
Tenki's `exec()` starts a fresh `python3` each call, so this runs a tiny
persistent kernel *inside* the sandbox — a stdlib-only daemon on sandbox-loopback
TCP that holds one namespace and executes code sent to it. No outbound network,
no extra packages: it's the reason the shipped executors all use a live kernel.

Uses the official `tenki-sandbox` Python SDK (pip install tenki-sandbox; Python 3.10+).
"""
from __future__ import annotations

import base64
import json

from smolagents.local_python_executor import CodeOutput
from smolagents.monitoring import LogLevel
from smolagents.remote_executors import RemotePythonExecutor
from smolagents.utils import AgentError
from tenki_sandbox import Sandbox

_PORT = 47000  # sandbox-loopback only; never exposed outside the microVM

# --- kernel.py: runs INSIDE the sandbox, holds ONE persistent namespace -------
_KERNEL = r'''
import ast, socket, io, json, contextlib
HOST, PORT = "127.0.0.1", %d
ns = {"__name__": "__main__"}

def _recv(c, n):
    b = b""
    while len(b) < n:
        chunk = c.recv(n - len(b))
        if not chunk:
            raise IOError("connection closed")
        b += chunk
    return b

def _read(c):
    n = int.from_bytes(_recv(c, 8), "big")
    return json.loads(_recv(c, n).decode())

def _write(c, obj):
    d = json.dumps(obj).encode()
    c.sendall(len(d).to_bytes(8, "big") + d)

def _jsonsafe(v):
    try:
        json.dumps(v)
        return v
    except Exception:
        return repr(v)

def _run(code):
    res = {"logs": "", "output": None, "is_final_answer": False, "final": None, "error": None}
    buf, value = io.StringIO(), None
    try:
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            # exec/eval of agent-written code is the whole point of a CodeAgent
            # executor; the disposable, network-isolated Tenki microVM is the
            # security boundary (same model as smolagents' E2B/Docker executors).
            tree = ast.parse(code, mode="exec")
            # Jupyter/E2B semantics: a trailing expression is the cell's result.
            if tree.body and isinstance(tree.body[-1], ast.Expr):
                last = ast.Expression(tree.body.pop().value)
                if tree.body:
                    exec(compile(tree, "<agent>", "exec"), ns)
                value = eval(compile(last, "<agent>", "eval"), ns)
            else:
                exec(compile(tree, "<agent>", "exec"), ns)
    except BaseException as e:  # FinalAnswerException subclasses BaseException
        if type(e).__name__ == "FinalAnswerException":
            res["is_final_answer"] = True
            res["final"] = getattr(e, "value", None)
        else:
            import traceback
            res["error"] = {"name": type(e).__name__, "value": str(e),
                            "traceback": traceback.format_exc()}
    res["logs"] = buf.getvalue()
    if value is not None and not res["is_final_answer"]:
        res["output"] = _jsonsafe(value)
    return res

srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind((HOST, PORT)); srv.listen(8)
while True:
    conn, _ = srv.accept()
    try:
        _write(conn, _run(_read(conn)["code"]))
    except Exception:
        pass  # never let one bad request kill the kernel
    finally:
        try:
            conn.close()
        except Exception:
            pass
''' % _PORT

# --- client.py: runs INSIDE the sandbox per exec(), relays code to the kernel --
_CLIENT = r'''
import socket, sys, json, base64, time
code = base64.b64decode(sys.argv[1]).decode()
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
for _ in range(50):  # kernel may still be binding on the first call
    try:
        s.connect(("127.0.0.1", %d)); break
    except OSError:
        time.sleep(0.1)
else:
    print(json.dumps({"error": {"name": "KernelUnreachable", "value": "no kernel on loopback",
          "traceback": ""}, "logs": "", "output": None, "is_final_answer": False, "final": None}))
    sys.exit(0)
d = json.dumps({"code": code}).encode()
s.sendall(len(d).to_bytes(8, "big") + d)
def _r(n):
    b = b""
    while len(b) < n:
        b += s.recv(n - len(b))
    return b
n = int.from_bytes(_r(8), "big")
sys.stdout.write(_r(n).decode())
''' % _PORT


class TenkiExecutor(RemotePythonExecutor):
    """smolagents remote executor that runs `CodeAgent`'s Python in a Tenki sandbox.

    Args:
        additional_imports: extra pip packages to install (needs `allow_outbound=True`).
        logger: the agent's `AgentLogger`.
        allow_pickle: forwarded to `RemotePythonExecutor` (final-answer deserialization).
        **sandbox_kwargs: passed straight to `Sandbox.create(...)` — `auth_token`,
            `workspace_id`, `cpu_cores`, `memory_mb`, `allow_outbound`, …
    """

    def __init__(self, additional_imports, logger, allow_pickle=False, **sandbox_kwargs):
        super().__init__(additional_imports, logger, allow_pickle)
        # Boot the microVM and wait until it's RUNNING (~2s).
        self.sandbox = Sandbox.create(**sandbox_kwargs)
        # Drop the kernel + client into /home/tenki and start the kernel daemon.
        self._put("/home/tenki/kernel.py", _KERNEL)
        self._put("/home/tenki/client.py", _CLIENT)
        self.sandbox.exec(
            "sh", "-c",
            "cd /home/tenki && nohup python3 kernel.py >/home/tenki/kernel.log 2>&1 & echo started",
        )
        self._await_kernel()
        self.installed_packages = self.install_packages(additional_imports)
        self.logger.log("Tenki sandbox is running", level=LogLevel.INFO)

    # -- Tenki plumbing ---------------------------------------------------------
    def _put(self, path: str, content: str):
        """Write a file into the sandbox (base64 to dodge shell/arg escaping)."""
        b64 = base64.b64encode(content.encode()).decode()
        self.sandbox.exec(
            "python3", "-c",
            "import base64,sys;open(sys.argv[1],'wb').write(base64.b64decode(sys.argv[2]))",
            path, b64, check=True,
        )

    def _call(self, code: str):
        """Send code to the in-sandbox kernel and return its result envelope."""
        b64 = base64.b64encode(code.encode()).decode()
        r = self.sandbox.exec("python3", "/home/tenki/client.py", b64)
        out = (r.stdout_text or "").strip()
        if not out:
            return None
        try:
            return json.loads(out)
        except json.JSONDecodeError:
            return {"error": {"name": "BadKernelResponse", "value": out, "traceback": r.stderr_text},
                    "logs": "", "output": None, "is_final_answer": False, "final": None}

    def _await_kernel(self, tries: int = 30):
        last = "no response"
        for _ in range(tries):
            env = self._call("pass")  # no-op ping
            if env is not None and env.get("error") is None:
                return
            last = json.dumps(env) if env else "no response"
        raise RuntimeError(f"Tenki kernel did not become ready: {last}")

    # -- RemotePythonExecutor contract -----------------------------------------
    def run_code_raise_errors(self, code: str) -> CodeOutput:
        env = self._call(code)
        if env is None:
            raise AgentError("No response from the Tenki kernel.", self.logger)
        logs = env.get("logs") or ""
        if env.get("is_final_answer"):
            answer = self._deserialize_final_answer(env.get("final"), self.allow_pickle)
            return CodeOutput(output=answer, logs=logs, is_final_answer=True)
        err = env.get("error")
        if err:
            raise AgentError(
                f"{logs}\nExecuting code yielded an error:\n"
                f"{err['name']}\n{err['value']}\n{err.get('traceback', '')}",
                self.logger,
            )
        return CodeOutput(output=env.get("output"), logs=logs, is_final_answer=False)

    def install_packages(self, additional_imports):
        """pip-install into the sandbox. Requires the microVM to have outbound
        network — create it with `allow_outbound=True`."""
        if not additional_imports:
            return []
        self.logger.log(f"Installing {', '.join(additional_imports)} …", level=LogLevel.INFO)
        r = self.sandbox.exec("python3", "-m", "pip", "install", "-q", *additional_imports)
        if r.exit_code != 0:
            raise AgentError(
                f"pip install failed (exit {r.exit_code}). Create the sandbox with "
                f"allow_outbound=True for network access.\n{r.stderr_text or r.stdout_text}",
                self.logger,
            )
        return list(additional_imports)

    def cleanup(self):
        """Terminate the microVM (the `TerminateSession` control call)."""
        try:
            if getattr(self, "sandbox", None) is not None:
                self.logger.log("Terminating Tenki sandbox…", level=LogLevel.INFO)
                self.sandbox.terminate()
                self.sandbox = None
                self.logger.log("Sandbox cleanup completed", level=LogLevel.INFO)
        except Exception as e:  # noqa: BLE001 -- cleanup is best-effort
            self.logger.log_error(f"Error during cleanup: {e}")

    def delete(self):
        self.cleanup()

    def __del__(self):
        try:
            self.cleanup()
        except Exception:
            pass
