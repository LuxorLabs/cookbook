# How to give a LangChain Python agent a code interpreter that runs in a Tenki sandbox

**Audience:** Python developers building agents with [LangChain](https://www.langchain.com) and LangGraph who want the code their agent writes to run in an isolated sandbox, not on their own machine.
**Time:** ~5 minutes.
**Outcome:** a LangGraph ReAct agent that answers a question by calling a `run_python` tool, which executes its Python in a disposable [Tenki](https://tenki.cloud) microVM, plus a passing check of that tool that needs no model key.

> **Honesty note:** every `run_python` call starts a new `python3 -c` process. All the calls in a session share one sandbox, so a file one call writes is still there for the next, but Python variables are not.

## Why bother

This example gives a LangChain Python agent a code interpreter, so it can answer questions that need real computation by running code. The agent calls a `run_python` tool, which executes the agent's Python in a disposable Tenki sandbox (an isolated microVM) and hands the output back. One sandbox serves the whole agent session and is reused across tool calls, which is cheaper than a sandbox per call.

It is the Python port of the JavaScript example [`langchain-code-interpreter`](../langchain-code-interpreter/), built on the official [`tenki`](https://tenki.cloud/docs/sandbox/sdk) SDK. The tool is one short file you can copy into your own project.

## Install

You need Python 3.10 or newer. The `tenki` SDK, `langchain-core`, and `langgraph` all require it. CI uses Python 3.12.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/langchain-python
```

Every later command runs from this directory. Create the virtual environment here, as `.venv`, because `verify.mjs` looks for `.venv/bin/python`:

```bash
uv venv --python 3.12
uv pip install -r requirements.txt
```

Without `uv`:

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

The dependencies, from `requirements.txt`:

```
tenki>=1.4.1
langchain-core>=1.0
langgraph>=1.0
langchain-openai>=1.0
```

`tenki` is the Tenki Python SDK, and `langchain-core` supplies the `@tool` decorator the tool is built with. Only `agent.py` uses the other two: `langgraph` for `create_react_agent`, and `langchain-openai` for `ChatOpenAI`.

## Authenticate

Create a `tk_` API key at https://app.tenki.cloud and export it:

```bash
export TENKI_API_KEY=tk_...
```

Or run `tenki login --api-key <key>`, which stores the key in `~/.config/tenki/config.yaml`. Both scripts look for the key in `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then the `auth_token:` line of that file, so either way works for both.

Tenki infers your workspace from the key. If you want a specific one, set `TENKI_WORKSPACE_ID`. Both scripts pass it through when it's set, and they also pick up a `current_workspace_id:` line from `~/.config/tenki/config.yaml` if one is there.

`agent.py` also needs a model key. It uses OpenAI's `gpt-4o-mini` through `ChatOpenAI`:

```bash
export OPENAI_API_KEY=sk-...
```

To use another provider, swap `ChatOpenAI` for that provider's LangChain chat model, as the comment at the top of `agent.py` suggests. `verify.py` needs no model key.

## Use it

Run the agent:

```bash
.venv/bin/python agent.py
```

This is the part of `agent.py` that builds the sandbox and the agent:

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

One sandbox, with 1 CPU core and 1024 MB of memory, serves the whole agent session, and every `run_python` call the agent makes goes to it. LangGraph's `create_react_agent` wires the model and the tool into a ReAct loop. The script asks for the 20th Fibonacci number and prints the agent's final message. When the `with` block exits, including on an exception, the SDK terminates the sandbox.

To use the tool in your own agent, copy `tenki_tool.py`, create a sandbox, and pass `make_code_tool(sandbox)` in the agent's `tools` list, as above.

## How the tool runs code

The tool, from `tenki_tool.py`:

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

Three things to know:

- **It's an ordinary LangChain tool.** `@tool` turns `run_python` into a tool named after the function, with `code` as its one argument and the docstring as the description the model reads. `make_code_tool` closes over the live sandbox, so the model only ever supplies code.
- **No shell in between.** `exec(command, *args)` passes its arguments straight through, with no shell splitting, so multi-line, model-generated code goes across as one `-c` argument with no escaping surprises. If you need shell syntax, run it through a shell yourself, for example `exec("bash", "-c", command)`.
- **The agent always gets text back.** The tool returns stdout followed by stderr, so a Python traceback reaches the agent as text. If the code printed nothing, it returns `(no output; exit code N)` instead of an empty string.

The SDK's file methods are confined to `/home/tenki`, which is the sandbox's working directory. Code this tool runs goes through `exec`, so it can write anywhere, but write to relative paths: they land in `/home/tenki`, where the SDK's file methods can read them back.

## Check it works

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.mjs` is a shim so the cookbook's Node verify harness can run this Python example. It runs `verify.py` with `.venv/bin/python` if that exists, otherwise with `$PYTHON` or `python3`. On success it prints:

```
✓ langchain-python: LangChain tool executed Python in a Tenki sandbox → 55
```

The end of `verify.py`:

```python
try:
    with Sandbox.create(**opts) as sb:
        run_python = make_code_tool(sb)
        # Drive the LangChain tool exactly as an agent would.
        out = run_python.invoke({"code": "print(sum(range(11)))"})
        if str(out).strip() != "55":
            raise AssertionError(f"tool returned {out!r}")
    print("✓ langchain-python: LangChain tool executed Python in a Tenki sandbox → 55")
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
```

This proves the half of the example that talks to Tenki: the LangChain tool runs code in a live sandbox and returns its output. It calls the tool directly with no agent involved and needs no model key, so the LangGraph agent and the model's turn aren't exercised. This is what CI runs, on Node 20 and Python 3.12 with only `TENKI_API_KEY` set.

## Troubleshooting

**❌ ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.``** `verify.py` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or the `auth_token:` line of `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY`, or run `tenki login --api-key <key>`.

**❌ `missing auth token: set TENKI_AUTH_TOKEN or TENKI_API_KEY` from `agent.py`.** Same cause: `agent.py` looks in the same three places but doesn't check whether it found a key, so the SDK raises `MissingAuthTokenError` when `Sandbox.create` runs. Same fix.

**❌ `invalid auth token: expected an API key or service token starting with tk_`.** The key isn't a `tk_` API key, and SDK 1.x accepts nothing else. In `verify.py` this shows up as `✗ InvalidAuthTokenError: …`. Create a key at https://app.tenki.cloud and use that.

**❌ `ModuleNotFoundError: No module named 'tenki'` (or `'langchain_core'`) from `node verify.mjs`.** There's no `.venv` in the example directory, so the shim fell back to `$PYTHON` or `python3`, which doesn't have the dependencies. Create the venv in this directory as shown in [Install](#install), or set `PYTHON` to the interpreter you installed into.

**❌ `✗ AssertionError: tool returned '…'`.** The sandbox ran the check, but the tool returned something other than `55`. The quoted text is the sandbox's own stdout and stderr, or `(no output; exit code N)`, so read it for the actual error.

## FAQ

**Why does `agent.py` print a `LangGraphDeprecatedSinceV10` warning?** LangGraph 1.0 deprecated `langgraph.prebuilt.create_react_agent`. The warning says it has moved to `langchain.agents` as `create_agent` and is due for removal in LangGraph 2.0. It's a warning, so the agent still runs. This example still uses `create_react_agent`, `requirements.txt` asks for `langgraph>=1.0` with no upper bound, and the `langchain` package that provides `langchain.agents` isn't among its dependencies.

**Can the agent's code reach the internet or install packages?** The sandbox image ships a stdlib-only Python. Outbound network is on by default (`allow_outbound=True`), so the agent's code can `pip install` any other packages it needs. To lock the sandbox down, add `allow_outbound=False` to the options passed to `Sandbox.create`.

**What happens if the agent's code never finishes?** The tool call waits. `run_python` passes no `timeout` to `exec`, and SDK commands are unbounded by default. `exec` accepts a `timeout`, which the sandbox's guest agent enforces. A run that hits it comes back as an ordinary result with `timed_out` set, not as an exception.

**When shouldn't I use this?** When you need a notebook-style interpreter that keeps variables between calls, since every call here is a fresh process. When the model's code has to be cut off from the network and you haven't set `allow_outbound=False`. When you need a bound on how long the model's code can run, since the tool as written sets none. When your project can't use Python 3.10 or newer. And if your agent is written in Node, start from [`langchain-code-interpreter`](../langchain-code-interpreter/) instead.

## Related

- LangChain: https://www.langchain.com. LangGraph: https://github.com/langchain-ai/langgraph
- Tenki Python SDK and full API: [tenki.cloud/docs/sandbox/sdk](https://tenki.cloud/docs/sandbox/sdk), [`tenki` on PyPI](https://pypi.org/project/tenki/), source at https://github.com/LuxorLabs/tenki-sdk-python
- Tenki docs: https://tenki.cloud/docs
- [`langchain-code-interpreter`](../langchain-code-interpreter/): the JavaScript version, with the same tool-backed-by-a-sandbox pattern
- [`run-code-python`](../run-code-python/): the bare Tenki Python SDK loop, with no agent framework
