# LangChain agent on Tenki — Python (code interpreter)

Give a [LangChain](https://www.langchain.com) **Python** agent a **code interpreter**, so it can answer questions that need real computation by running code. The agent calls a `run_python` tool, which executes its Python in a disposable [Tenki](https://tenki.cloud) sandbox (an isolated microVM) and hands the output back. One sandbox serves the whole agent session. This is the Python port of the JavaScript example [`langchain-code-interpreter`](../langchain-code-interpreter/), built on the official [`tenki`](https://tenki.cloud/docs/sandbox/sdk) SDK.

## The tool (`tenki_tool.py`)

```python
from langchain_core.tools import tool
from tenki import Sandbox

def make_code_tool(sandbox: Sandbox):
    @tool
    def run_python(code: str) -> str:
        """Execute Python in a secure, disposable sandbox and return its output."""
        result = sandbox.exec("python3", "-c", code)
        return f"{result.stdout_text}{result.stderr_text}".strip() or f"(exit {result.exit_code})"
    return run_python
```

`exec(command, *args)` passes args straight through (no shell splitting), so multi-line, model-generated code goes across as one `-c` argument with no escaping surprises.

## The agent (`agent.py`)

Create one sandbox, wire the tool into a LangGraph ReAct agent, ask something that needs real computation:

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

with Sandbox.create(**opts) as sandbox:
    agent = create_react_agent(
        ChatOpenAI(model="gpt-4o-mini"),
        tools=[make_code_tool(sandbox)],
    )
    result = agent.invoke(
        {"messages": [{"role": "user", "content": "What is the 20th Fibonacci number? Compute it with Python."}]}
    )
    print(result["messages"][-1].content)
```

## Setup (Python 3.10+)

```bash
uv venv                                   # or: python3.11 -m venv .venv
uv pip install -r requirements.txt        # the tenki SDK + langchain + langgraph
export TENKI_API_KEY=tk_...               # or: tenki login --api-key <key>
```

The SDK takes a `tk_` API key: set `TENKI_API_KEY`, or run `tenki login --api-key <key>` to store one in `~/.config/tenki/config.yaml` (the scripts read it from there).

## Verify it (no LLM needed)

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.py` creates a live sandbox, builds the tool on it, and calls the tool directly (`run_python.invoke({"code": ...})`) with no agent involved, then asserts the result. That tests the half of the example that talks to Tenki, without needing a model key. CI runs this check.

## Run the full agent

```bash
export OPENAI_API_KEY=sk-...
.venv/bin/python agent.py    # a LangChain agent computes an answer using the sandbox
```

## Notes

- **One sandbox per session, reused across tool calls** — cheaper than a sandbox per call; terminated when the `with` block exits.
- Requires **Python 3.10+** (a `tenki` SDK requirement); the rest of the cookbook is Node, so this example is verified via the `verify.mjs` → `verify.py` shim.
- The sandbox image ships a stdlib-only Python. Outbound network is on by default (`allow_outbound=True`), so the agent's code can `pip install` any other packages it needs. To lock the sandbox down, add `allow_outbound=False` to the options passed to `Sandbox.create`.
- Tenki confines file I/O to `/home/tenki` — write to relative paths.
- Official SDK + full API: [tenki.cloud/docs/sandbox/sdk](https://tenki.cloud/docs/sandbox/sdk). Same tool-backed-by-a-sandbox pattern as the [JS version](../langchain-code-interpreter/).
