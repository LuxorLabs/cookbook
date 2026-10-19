# LlamaIndex + Tenki (code interpreter)

Give a [LlamaIndex](https://github.com/run-llama/llama_index) agent a **code-execution tool** that runs in a disposable [Tenki](https://tenki.cloud) sandbox. The agent writes Python; the tool executes it in a real, isolated sandbox and returns the output.

## The integration

`tenki_tool.py` wraps a live Tenki sandbox as a LlamaIndex `FunctionTool`:

```python
from llama_index.core.tools import FunctionTool
from tenki import Sandbox

def make_code_tool(sandbox: Sandbox) -> FunctionTool:
    def run_python(code: str) -> str:
        result = sandbox.exec("python3", "-c", code)   # args pass through — no shell splitting
        return f"{result.stdout_text}{result.stderr_text}".strip()
    return FunctionTool.from_defaults(fn=run_python, name="run_python", description="…")
```

Attach it to a `FunctionAgent` (see `agent.py`) and the model's code runs on Tenki.

## Run it

```bash
# Python 3.10+; uv recommended
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt

# Verify the Tenki integration (no LLM key needed):
node verify.mjs        # or: .venv/bin/python verify.py

# Full agent (needs a model key):
export OPENAI_API_KEY=...
.venv/bin/python agent.py
```

`verify.py` calls the tool directly against a live sandbox and asserts the result — that's the CI-gated proof; the agent turn (which needs a model key) is not required in CI.

## Notes

- **Auth:** the SDK takes a `tk_` API key — set `TENKI_API_KEY`, or run `tenki login --api-key <key>` to store one in `~/.config/tenki/config.yaml` (the scripts read it from there).
- Tenki confines file I/O to `/home/tenki`; use relative paths.
- Outbound network is on by default (`allow_outbound=True`), so the agent's code can `pip install` — pass `allow_outbound=False` to lock the sandbox down.
- Products used: **Tenki Sandbox**. More at [tenki.cloud](https://tenki.cloud).
