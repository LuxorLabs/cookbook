"""
Proves the Tenki-facing half of this example: the `TenkiExecutor` runs
CodeAgent-style Python in a live Tenki sandbox, keeps state across steps, and
detects `final_answer(...)` — the whole `RemotePythonExecutor` seam, asserted
with no LLM. (The full `CodeAgent`, which needs a model key, is in agent.py.)

Needs Python 3.10+ and the deps in requirements.txt. Token/workspace from env (CI)
or ~/.config/tenki/config.yaml (local `tenki login`). Exits non-zero on failure.
"""
import os
import sys

from smolagents.monitoring import AgentLogger, LogLevel
from smolagents.utils import AgentError

from tenki_executor import TenkiExecutor


def cfg(key):
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except FileNotFoundError:
        pass
    return ""


token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")
if not token:
    print("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.")
    sys.exit(1)

# Python SDK auth gap: a bare `tenki login` session token must be sent as a
# cookie (prefix `cookie:`); a `tk_` API key works as-is. (Node SDK auto-detects.)
if not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
if os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id"):
    opts["workspace_id"] = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")

executor = None
try:
    # Build the executor exactly as `CodeAgent(executor=...)` would.
    # LogLevel.OFF keeps CI output to just the ✓/✗ line (step 4 raises on purpose).
    executor = TenkiExecutor(additional_imports=[], logger=AgentLogger(LogLevel.OFF), **opts)

    # 1) Real execution in the microVM.
    out = executor.run_code_raise_errors("print(6 * 7)")
    if out.logs.strip() != "42":
        raise AssertionError(f"exec: expected logs '42', got {out.logs!r}")

    # 2) State persists across separate steps — the reason CodeAgent needs a
    #    live kernel, not a fresh `python3` per call.
    executor.run_code_raise_errors("n = sum(range(11))")
    out = executor.run_code_raise_errors("print(n)")
    if out.logs.strip() != "55":
        raise AssertionError(f"state: expected logs '55', got {out.logs!r}")

    # 3) Final-answer detection. CodeAgent patches its `final_answer` tool to raise
    #    `FinalAnswerException("safe:<json>")`; the executor must catch that and
    #    deserialize the value. We raise that exact wire contract in the sandbox
    #    (no LLM, no tool-package install) and assert the executor surfaces it.
    fa_code = (
        "class FinalAnswerException(BaseException):\n"
        "    def __init__(self, value): self.value = value\n"
        "import json\n"
        "raise FinalAnswerException('safe:' + json.dumps(6 * 7))\n"
    )
    out = executor.run_code_raise_errors(fa_code)
    if not (out.is_final_answer and out.output == 42):
        raise AssertionError(f"final_answer: expected 42, got is_final={out.is_final_answer}, output={out.output!r}")

    # 4) Errors surface as AgentError — what CodeAgent shows the model to retry.
    try:
        executor.run_code_raise_errors("raise ValueError('boom')")
        raise AssertionError("expected AgentError, none raised")
    except AgentError as e:
        if "boom" not in str(e):
            raise AssertionError(f"error path: unexpected message {e!r}")

    print("✓ smolagents: TenkiExecutor ran CodeAgent Python in a Tenki sandbox (42), "
          "kept state across steps (55), caught final_answer (42), surfaced errors")
except Exception as e:  # noqa: BLE001
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
finally:
    if executor is not None:
        executor.cleanup()
