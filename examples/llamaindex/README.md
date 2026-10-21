# LlamaIndex

Give a [LlamaIndex](https://github.com/run-llama/llama_index) `FunctionAgent` a `run_python` tool that executes the model's Python in a Tenki sandbox. The tool is an ordinary `FunctionTool`, so it attaches like any other tool. One sandbox serves the whole agent session.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "LlamaIndex" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/llamaindex, create a .venv there on Python 3.10 or later (uv venv --python 3.12 .venv if uv is installed), and install requirements.txt.
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) and, for agent.py, OPENAI_API_KEY. If either is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs first (no model call, expects 55), then .venv/bin/python agent.py.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then add tenki_tool.py to my own LlamaIndex agent: one sandbox per session in a with block, and make_code_tool(sandbox) in the agent's tools.
```

## Quick start

You need:

- Python 3.10 or later. [uv](https://docs.astral.sh/uv/) is optional.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An OpenAI API key, for the agent run only.

### 1. Install

Create the venv in the example directory as `.venv`; `verify.mjs` looks for it there.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/llamaindex
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

Without uv: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`. This installs `tenki`, `llama-index-core`, and `llama-index-llms-openai` (used only by `agent.py`).

### 2. Set your keys

```bash
export TENKI_API_KEY=tk_...
export OPENAI_API_KEY=sk-...
```

Both scripts check `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run the agent

```bash
.venv/bin/python agent.py
```

The agent computes the 20th Fibonacci number with `run_python` on `gpt-4o-mini` and prints its answer. Change the string passed to `agent.run` to ask something else.

### 4. Verify

```bash
node verify.mjs        # or: .venv/bin/python verify.py
```

```
✓ llamaindex: LlamaIndex FunctionTool executed Python in a Tenki sandbox → 55
```

`verify.py` calls the tool directly with `print(sum(range(11)))` and checks for `55`. It needs no OpenAI key. `verify.mjs` is a CI shim that runs it with `.venv/bin/python`, `$PYTHON`, or `python3`.

## The agent

The agent loop in `agent.py`:

```python
async def main():
    # One sandbox for the whole agent session, reused across every tool call.
    with Sandbox.create(**opts) as sandbox:
        agent = FunctionAgent(
            tools=[make_code_tool(sandbox)],  # the tool runs the agent's code in Tenki
            llm=OpenAI(model="gpt-4o-mini"),  # needs OPENAI_API_KEY
            system_prompt="You answer questions by writing and running Python in a sandbox.",
        )
        response = await agent.run("What is the 20th Fibonacci number? Compute it with Python.")
        print(response)
```

The sandbox is created with `cpu_cores=1, memory_mb=1024`, and the `with` block terminates it on exit, including on an exception.

To use another model, install its LlamaIndex LLM package and pass it as `llm=`. It must support function calling, or `FunctionAgent` raises `ValueError: LLM must be a FunctionCallingLLM`.

## The tool

`tenki_tool.py`:

```python
"""A LlamaIndex tool that runs Python in a disposable Tenki sandbox.

`make_code_tool(sandbox)` closes over a live Tenki sandbox and returns a
LlamaIndex `FunctionTool` an agent can call. `exec(command, *args)` passes args
straight through (no shell splitting), so model-generated, multi-line code goes
across as a single `-c` argument with no escaping surprises.

Uses the official `tenki` Python SDK (pip install tenki; Python 3.10+).
"""
from llama_index.core.tools import FunctionTool
from tenki import Sandbox


def make_code_tool(sandbox: Sandbox) -> FunctionTool:
    """Return a `run_python` LlamaIndex tool bound to a live Tenki sandbox."""

    def run_python(code: str) -> str:
        """Execute Python code in a secure, disposable sandbox and return its stdout/stderr.

        Use it for calculations, data work, or anything that needs real execution.
        """
        result = sandbox.exec("python3", "-c", code)
        out = f"{result.stdout_text}{result.stderr_text}".strip()
        return out or f"(no output; exit code {result.exit_code})"

    return FunctionTool.from_defaults(
        fn=run_python,
        name="run_python",
        description="Execute Python code in a secure, disposable Tenki sandbox; returns stdout/stderr.",
    )
```

Things to know:

- **No shell.** The code goes to `python3 -c` as one argument, so multi-line code needs no escaping.
- **Errors come back as text.** `exec` doesn't raise on a non-zero exit, so tracebacks reach the model. Code that prints nothing returns `(no output; exit code N)`.
- **No state between calls.** Each call is a new `python3` process. For a namespace that persists across calls, see [smolagents](../smolagents/).
- **Relative paths land in `/home/tenki`.** The SDK's `sandbox.fs` methods are confined there.
- **Outbound network is on.** The model's code can reach the internet and `pip install`. Pass `allow_outbound=False` to `Sandbox.create` to lock it down.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` | Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `ModuleNotFoundError: No module named 'tenki'` from `node verify.mjs` | There's no `.venv` here. Create it as in step 1, or set `PYTHON`. |
| `tenki>=1.4.1` won't resolve | Your venv's Python is older than 3.10. Recreate it with `uv venv --clear --python 3.12 .venv`. |
| OpenAI API key error from `agent.py` | Export `OPENAI_API_KEY`, or swap in another LLM. |
| `permission_denied … path outside workdir` | Use a relative path, or one under `/home/tenki`. |

## Related

- [smolagents](../smolagents/): a persistent Python executor for a `CodeAgent`
- [LangChain (Python)](../langchain-python/): the same tool for LangChain
- [LlamaIndex](https://github.com/run-llama/llama_index)
- [`tenki` SDK docs](https://tenki.cloud/docs/sandbox/sdk) and [LuxorLabs/tenki-sdk-python](https://github.com/LuxorLabs/tenki-sdk-python)
