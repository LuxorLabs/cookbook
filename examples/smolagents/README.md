# smolagents CodeAgent on Tenki (the `remote_executors` seam)

Hugging Face [**smolagents**](https://github.com/huggingface/smolagents) `CodeAgent` writes Python *as its actions* and runs it through a **`RemotePythonExecutor`** — the exact seam its E2B / Docker / Modal / Blaxel executors plug into (`smolagents/remote_executors.py`). This example adds a **`TenkiExecutor`** that runs that generated code in a disposable [Tenki](https://tenki.cloud) microVM **Sandbox** — one line to swap in: `CodeAgent(..., executor=TenkiExecutor(...))`.

## The executor (`tenki_executor.py`)

`CodeAgent` needs a **stateful** namespace: it defines the tools once (`send_tools`), then every step's code shares variables with the last. Tenki's `exec()` starts a fresh `python3` each call, so `TenkiExecutor` runs a tiny **persistent kernel inside the sandbox** — a stdlib-only daemon on sandbox-loopback TCP that holds one namespace and executes the code sent to it (no outbound network, no extra packages). That's the same reason smolagents' own remote executors all talk to a live kernel.

```python
from smolagents.remote_executors import RemotePythonExecutor
from smolagents.local_python_executor import CodeOutput
from tenki_sandbox import Sandbox

class TenkiExecutor(RemotePythonExecutor):
    def __init__(self, additional_imports, logger, allow_pickle=False, **sandbox_kwargs):
        super().__init__(additional_imports, logger, allow_pickle)
        self.sandbox = Sandbox.create(**sandbox_kwargs)   # boot a microVM (~2s)
        self._start_kernel()                              # persistent namespace inside it
        self.installed_packages = self.install_packages(additional_imports)

    def run_code_raise_errors(self, code: str) -> CodeOutput:
        env = self._call(code)                            # send code to the in-sandbox kernel
        if env["is_final_answer"]:
            return CodeOutput(self._deserialize_final_answer(env["final"], self.allow_pickle),
                              env["logs"], is_final_answer=True)
        ...                                               # errors -> AgentError; else CodeOutput
```

The executor implements the three-method `RemotePythonExecutor` contract — `run_code_raise_errors`, `install_packages`, `cleanup` — plus final-answer detection: `CodeAgent`'s `final_answer` tool is patched to raise `FinalAnswerException("safe:<json>")`, and the kernel catches it by name so the executor can deserialize the result.

## The agent (`agent.py`)

Pass the executor straight into `CodeAgent`; everything the model writes now runs on Tenki:

```python
from smolagents import CodeAgent

executor = TenkiExecutor(additional_imports=[], logger=logger, allow_outbound=True, **opts)
agent = CodeAgent(tools=[], model=build_model(), executor=executor)
print(agent.run("What is the 20th Fibonacci number? Compute it in Python."))
executor.cleanup()   # terminate the microVM
```

## Setup (Python 3.10+)

```bash
uv venv --python 3.12                      # or: python3.11 -m venv .venv
uv pip install -r requirements.txt         # tenki-sandbox + smolagents
export TENKI_AUTH_TOKEN=...                 # see the auth note below
```

The scripts fall back to `~/.config/tenki/config.yaml` (written by `tenki login`) for the token and workspace.

**Auth note.** The Python SDK authenticates cleanly with a **`tk_` API key** (`export TENKI_AUTH_TOKEN=tk_…`). A `tenki login` browser session token also works, but — unlike the Node SDK — the Python SDK won't auto-detect it; pass it as **`cookie:<token>`** so it's sent as a cookie (`verify.py` and `agent.py` do this for you). It's an SDK gap, not yours.

## Verify it (no LLM needed)

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.py` builds the executor against a live sandbox and drives it exactly as `CodeAgent` does — **runs Python (`42`), proves state persists across steps (`55`), catches `final_answer(...)` (`42`), and surfaces an error as `AgentError`** — then terminates the microVM. It proves the whole Tenki-facing seam with no model key. This is what CI runs (via the `verify.mjs` → `verify.py` shim, same pattern as [`run-code-python`](../run-code-python/)).

## Run the full agent

```bash
export OPENAI_API_KEY=sk-...   # OpenAIServerModel (pip install 'smolagents[openai]')
#   or: export HF_TOKEN=hf_... # InferenceClientModel (Hugging Face Inference, core dep)
.venv/bin/python agent.py
```

## Notes

- **The persistent kernel is what makes `CodeAgent` work** — it keeps tool definitions and intermediate variables alive across steps. It listens on sandbox **loopback only** (never exposed) and is pure stdlib, so it needs no outbound network and no image changes.
- **One microVM per agent session**, reused across every step and terminated by `executor.cleanup()` (a real `TerminateSession`). smolagents calls `cleanup()` for you when the agent is done.
- **`allow_outbound=True` for real runs.** A live `CodeAgent` patches its `final_answer` tool, and smolagents then pip-installs that tool's inferred requirements (numpy, pillow) into the sandbox at `send_tools` time — which needs network. The **verify** doesn't (it stays fully offline). Give any extra packages your agent needs to `TenkiExecutor(additional_imports=[...])`.
- `exec(command, *args)` passes args straight through (no shell splitting); this example base64-encodes code across that boundary, so multi-line model output never hits an escaping surprise.
- Tenki confines file I/O to `/home/tenki` — use relative paths.
- Requires **Python 3.10+** (a `tenki-sandbox` requirement); the rest of the cookbook is Node, so this example is verified via the `verify.mjs` → `verify.py` shim.
- Official SDK + full API: [tenki.cloud/docs/sandbox/sdk](https://tenki.cloud/docs/sandbox/sdk). Same executor seam as smolagents' [E2B / Docker executors](https://github.com/huggingface/smolagents/blob/main/src/smolagents/remote_executors.py).
