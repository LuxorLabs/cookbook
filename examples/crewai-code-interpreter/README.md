# CrewAI agent with a Tenki code interpreter

Give a [CrewAI](https://crewai.com) agent a **code interpreter** — a tool that runs Python in a disposable [Tenki](https://tenki.cloud) sandbox and hands the output back. The same pattern E2B and Daytona ship for CrewAI, on Tenki sandboxes. Python, on the official [`tenki`](https://tenki.cloud/docs/sandbox/sdk) SDK.

## The tool (`tenki_tool.py`)

```python
from crewai.tools import BaseTool
from tenki import Sandbox

class TenkiCodeInterpreter(BaseTool):
    name = "run_python"
    description = "Execute Python in a secure, disposable sandbox and return its output."
    # ...args_schema + a sandbox passed in...
    def _run(self, code: str) -> str:
        result = self._sandbox.exec("python3", "-c", code)
        return f"{result.stdout_text}{result.stderr_text}".strip()
```

`exec(command, *args)` passes args straight through (no shell splitting), so multi-line, model-generated code goes across as one `-c` argument with no escaping surprises.

## Setup (Python 3.10+)

```bash
uv venv                                   # or: python3.11 -m venv .venv
uv pip install -r requirements.txt        # the tenki SDK + crewai
export TENKI_API_KEY=tk_...               # or: tenki login --api-key <key>
```

The SDK takes a `tk_` API key: set `TENKI_API_KEY`, or run `tenki login --api-key <key>` to store one in `~/.config/tenki/config.yaml` (the scripts read it from there).

## Verify it (no LLM needed)

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.py` builds the tool over a live sandbox and calls it directly (`tool._run(code=...)`), asserting the result — proving the Tenki-facing half without a model key. This is what CI runs.

## Run the full agent

```bash
export OPENAI_API_KEY=sk-...
.venv/bin/python agent.py    # a CrewAI agent computes an answer using the sandbox
```

## Notes

- Requires **Python 3.10+** (a CrewAI requirement); the rest of the cookbook is Node, so this example is verified via the `verify.mjs` → `verify.py` shim.
- Tenki confines file I/O to `/home/tenki` — write to relative paths.
- Official SDK + full API: [tenki.cloud/docs/sandbox/sdk](https://tenki.cloud/docs/sandbox/sdk).
