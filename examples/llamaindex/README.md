# How to run a LlamaIndex agent's Python in a Tenki sandbox

A LlamaIndex `FunctionAgent` gets a `run_python` tool that executes the model's Python in a disposable [Tenki](https://tenki.cloud) sandbox. The verify script prints `✓` after running the tool against a live sandbox.

About 5 minutes.

`run_python` runs whatever Python the model writes. Outbound network is on by default (`allow_outbound=True`), so that code can reach the internet and `pip install` packages. Pass `allow_outbound=False` to `Sandbox.create` to lock the sandbox down.

## Why bother

A code-interpreter tool runs code nobody has reviewed. This example sends that code to an isolated Tenki sandbox instead of your own process: the agent writes Python, `run_python` executes it in the sandbox, and the output goes back to the model as the tool result. The tool is an ordinary LlamaIndex `FunctionTool`, so it attaches to an agent like any other tool.

## Install

Get the example:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/llamaindex
```

Every later command runs from this directory.

You need Python 3.10 or newer, because `tenki` 1.4.1 requires it (current `llama-index-core` releases do too). [uv](https://docs.astral.sh/uv/) is recommended. Node is only needed if you run the check with `node verify.mjs`.

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

Without uv, use a `python3` that is 3.10 or newer:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Both routes create the `.venv/bin/python` that `verify.mjs` looks for. Either one installs `requirements.txt`:

```
tenki>=1.4.1
llama-index-core>=0.12
llama-index-llms-openai>=0.3
```

`tenki` is the official Tenki Python SDK. `llama-index-llms-openai` is used only by `agent.py`; the verify script doesn't import it.

## Authenticate

### Tenki

The Tenki SDK takes a `tk_` API key. Create one at https://app.tenki.cloud, then either export it:

```bash
export TENKI_API_KEY=tk_...
```

or run `tenki login --api-key <key>`, which stores the key in `~/.config/tenki/config.yaml`. The scripts read it from there. Both `agent.py` and `verify.py` look for the key in this order (from `agent.py`):

```python
# A tk_ API key, from env or ~/.config/tenki/config.yaml (`tenki login --api-key`).
token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace:
    opts["workspace_id"] = workspace
```

`TENKI_WORKSPACE_ID` is optional. Tenki infers the workspace from the key; set the variable only if you want to pin one. The `opts` above also size the sandbox at 1 CPU core and 1024 MB of memory.

### Model

`agent.py` uses OpenAI's `gpt-4o-mini`, so it needs a model key:

```bash
export OPENAI_API_KEY=...
```

The verify script doesn't call a model and doesn't need this key.

## Use it

```bash
.venv/bin/python agent.py
```

This is the agent loop in `agent.py`:

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

The script creates one sandbox, hands it to the tool, asks the agent a question, and prints the agent's answer. Every tool call during the run reuses that sandbox. When the `with` block exits, including when an exception escapes it, the SDK terminates the sandbox. To ask something else, change the string passed to `agent.run`.

## How `run_python` works

The whole integration is `tenki_tool.py`:

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

Four things to know about it:

- No shell in the way. `sandbox.exec("python3", "-c", code)` passes its arguments straight to `python3` with no shell splitting, so multi-line code from the model arrives as one `-c` argument and needs no quoting or escaping.
- Errors come back as text. The tool returns stdout followed by stderr, trimmed. `exec` doesn't raise on a non-zero exit by default, so a traceback from the model's code reaches the model as the tool result. If the code prints nothing, the tool returns `(no output; exit code N)`.
- **Each call is a new process.** Every call starts a fresh `python3` in the same sandbox, so variables and imports don't carry over from one call to the next. The sandbox itself stays up until the `with` block exits.
- Where files go. Relative paths in the model's code resolve under `/home/tenki`, the sandbox's working directory. The SDK's own file methods (`sandbox.fs`) are confined to `/home/tenki`, so use relative paths if you add a step that reads results back with them. Code run through `exec`, like this tool's, can write anywhere.

## Check it works

```bash
node verify.mjs        # or: .venv/bin/python verify.py
```

`verify.mjs` is a shim for the cookbook's Node verify harness. It runs `verify.py` with `.venv/bin/python` if that exists, otherwise with `$PYTHON` or `python3`. On success it prints:

```
✓ llamaindex: LlamaIndex FunctionTool executed Python in a Tenki sandbox → 55
```

The check calls the tool directly instead of going through an agent (from `verify.py`):

```python
try:
    with Sandbox.create(**opts) as sb:
        run_python = make_code_tool(sb)
        # Drive the LlamaIndex FunctionTool exactly as an agent would.
        out = run_python.call(code="print(sum(range(11)))")
        if str(out).strip() != "55":
            raise AssertionError(f"tool returned {out!r}")
    print("✓ llamaindex: LlamaIndex FunctionTool executed Python in a Tenki sandbox → 55")
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
```

This proves the `run_python` `FunctionTool` ran Python in a live Tenki sandbox and returned the right output. It doesn't exercise the agent turn: no model key is needed, so `FunctionAgent` and the OpenAI call aren't tested. This is the check CI gates on, with only `TENKI_API_KEY` set. On failure the script prints `✗ <ErrorType>: <message>` and exits 1.

## Troubleshooting

**``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.``** `verify.py` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY`, or run `tenki login --api-key <key>`.

**`ModuleNotFoundError: No module named 'tenki'` from `node verify.mjs`.** There's no `.venv` in this directory, so the shim fell back to `$PYTHON` or `python3`, and that interpreter doesn't have the requirements installed. Create the venv here as shown in Install, or set `PYTHON` to an interpreter that has them.

**Installing `requirements.txt` fails to resolve `tenki>=1.4.1`.** The venv uses a Python older than 3.10, and `tenki` 1.4.1 requires 3.10 or newer. Recreate it with `uv venv --clear --python 3.12 .venv`, then rerun `uv pip install --python .venv/bin/python -r requirements.txt`. Without uv, run `python3 -m venv --clear .venv` with a `python3` that is 3.10 or newer, then rerun `.venv/bin/pip install -r requirements.txt`.

**`agent.py` fails with an OpenAI API key error.** `OpenAI(model="gpt-4o-mini")` needs `OPENAI_API_KEY`. Export it, or swap in another LLM (see the FAQ). The verify script doesn't need it.

**`permission_denied … path outside workdir`.** A call to the SDK's file methods used a path outside `/home/tenki`. Use a relative path, or one under `/home/tenki`.

## FAQ

**When shouldn't I use this?**
When you need interpreter state to persist: each tool call is a fresh `python3 -c` process, so variables from one call are gone by the next. For a namespace that persists across calls, see [`../smolagents/`](../smolagents/), which runs a persistent kernel inside the sandbox. When you need languages other than Python: the tool runs only `python3 -c`. When the sandbox has to outlive the script: the `with` block terminates it on exit. And if the model's code must not reach the network, pass `allow_outbound=False`, because outbound access is on by default.

**Can I use a model other than OpenAI?**
Yes. `agent.py` says to swap the LLM for your provider. Three things are OpenAI-specific: the `from llama_index.llms.openai import OpenAI` import, `llm=OpenAI(model="gpt-4o-mini")`, and the `llama-index-llms-openai` requirement. The tool and the sandbox code don't depend on the model. Install your provider's LlamaIndex LLM package and pass its LLM as `llm=`. It must support function calling, because `FunctionAgent` raises `ValueError: LLM must be a FunctionCallingLLM` otherwise.

## Related

- [LlamaIndex](https://github.com/run-llama/llama_index)
- [`tenki` on PyPI](https://pypi.org/project/tenki/), the official Tenki Python SDK ([source](https://github.com/LuxorLabs/tenki-sdk-python), [SDK guide](https://tenki.cloud/docs/sandbox/sdk))
- [Tenki docs](https://tenki.cloud/docs). Product used: Tenki Sandbox. More at [tenki.cloud](https://tenki.cloud).
- [`../langchain-python/`](../langchain-python/): the same `run_python` code-execution tool for a LangChain Python agent
- [`../smolagents/`](../smolagents/): Tenki as the remote Python executor for a smolagents `CodeAgent`
