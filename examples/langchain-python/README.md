# LangChain (Python)

Give a LangChain Python agent a `run_python` code-interpreter tool that runs in a Tenki sandbox. The agent writes Python, the tool runs it in one sandbox shared for the session, and the output goes back to the agent. The tool is one file, `tenki_tool.py`, built on the [`tenki`](https://pypi.org/project/tenki/) SDK. For Node, see [LangChain (JavaScript)](../langchain-code-interpreter/).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "LangChain (Python)" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/langchain-python, create a .venv there on Python 3.10 or later (uv venv --python 3.12 if uv is installed), and install requirements.txt.
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) and, for agent.py, OPENAI_API_KEY. If either is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs first (no model call, expects 55), then .venv/bin/python agent.py.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then add tenki_tool.py to my own LangChain agent: one sandbox per session in a with block, make_code_tool(sandbox) in the tools list, and a timeout on exec.
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
cd cookbook/examples/langchain-python
uv venv --python 3.12
uv pip install -r requirements.txt
```

Without uv: `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt`. This installs `tenki`, `langchain-core`, `langgraph`, and `langchain-openai`.

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

A LangGraph ReAct agent on `gpt-4o-mini` computes the 20th Fibonacci number with `run_python` and prints its answer. LangGraph 1.0 prints a `LangGraphDeprecatedSinceV10` warning for `create_react_agent`; the agent still runs.

### 4. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```
✓ langchain-python: LangChain tool executed Python in a Tenki sandbox → 55
```

`verify.py` calls the tool directly with `print(sum(range(11)))` and checks for `55`. It needs no OpenAI key. `verify.mjs` is a CI shim that runs it with `.venv/bin/python`, `$PYTHON`, or `python3`.

## The agent

The part of `agent.py` that builds the sandbox and the agent:

```python
# A tk_ API key, from env or ~/.config/tenki/config.yaml (`tenki login --api-key`).
token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

# One sandbox for the whole agent session, reused across every tool call.
with Sandbox.create(**opts) as sandbox:
    agent = create_react_agent(
        ChatOpenAI(model="gpt-4o-mini"),  # needs OPENAI_API_KEY
        tools=[make_code_tool(sandbox)],  # the tool runs the agent's code in Tenki
    )
    result = agent.invoke(
        {"messages": [{"role": "user", "content": "What is the 20th Fibonacci number? Compute it with Python."}]}
    )
    print(result["messages"][-1].content)
```

The `with` block terminates the sandbox when the agent finishes or raises. To use another model provider, swap `ChatOpenAI` for its LangChain chat model.

## The tool

`tenki_tool.py`:

```python
from langchain_core.tools import tool
from tenki import Sandbox


def make_code_tool(sandbox: Sandbox):
    """Return a `run_python` LangChain tool bound to a live Tenki sandbox."""

    @tool
    def run_python(code: str) -> str:
        """Execute Python code in a secure, disposable sandbox and return its stdout/stderr.

        Use it for calculations, data work, or anything that needs real execution.
        """
        result = sandbox.exec("python3", "-c", code)
        out = f"{result.stdout_text}{result.stderr_text}".strip()
        return out or f"(no output; exit code {result.exit_code})"

    return run_python
```

Things to know:

- **It's an ordinary LangChain tool.** `@tool` names it after the function and uses the docstring as its description. The model only supplies `code`.
- **No shell.** `exec(command, *args)` passes the code as one `-c` argument. For shell syntax, use `exec("bash", "-c", command)`.
- **Errors come back as text.** Tracebacks reach the agent. Code that prints nothing returns `(no output; exit code N)`.
- **No state between calls.** Each call is a new `python3` process. Files persist in the shared sandbox; variables don't. Write to relative paths, which land in `/home/tenki`.
- **No time limit.** `exec` is unbounded by default. Pass `timeout` to `exec` to cap it; a timed-out run returns a normal result with `timed_out` set.
- **Standard library only.** Outbound network is on, so the code can `pip install`. Add `allow_outbound=False` to the `Sandbox.create` options to cut it off.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` or `missing auth token` | Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `invalid auth token: expected an API key or service token starting with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `ModuleNotFoundError: No module named 'tenki'` from `node verify.mjs` | There's no `.venv` here. Create it as in step 1, or set `PYTHON`. |
| `✗ AssertionError: tool returned '…'` | The quoted text is the sandbox's output. Read it for the error. |

## Related

- [LangChain (JavaScript)](../langchain-code-interpreter/)
- [Run code with Python](../run-code-python/): the bare SDK loop
- [LangChain](https://www.langchain.com) and [LangGraph](https://github.com/langchain-ai/langgraph)
- [`tenki` SDK docs](https://tenki.cloud/docs/sandbox/sdk) and [LuxorLabs/tenki-sdk-python](https://github.com/LuxorLabs/tenki-sdk-python)
