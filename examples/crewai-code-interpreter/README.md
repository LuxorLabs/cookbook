# How to give a CrewAI agent a code interpreter that runs in a Tenki sandbox

A CrewAI agent answers a question by calling a `run_python` tool. The tool executes that code in a disposable [Tenki](https://tenki.cloud) sandbox. A check of the tool passes with no model key.

About 10 minutes, most of it installing CrewAI's dependencies.

`tenki login` is enough for `verify.py`. `agent.py` leaves the key to the `tenki` SDK, which reads only `TENKI_API_KEY` or `TENKI_AUTH_TOKEN` from the environment, so export one of them before you run the crew.

## Why bother

CrewAI's own docs mark its built-in [`CodeInterpreterTool`](https://docs.crewai.com/en/tools/ai-ml/codeinterpretertool) as removed from `crewai-tools`, deprecate the `allow_code_execution` and `code_execution_mode` agent options, and point you to a dedicated sandbox service instead. Their tool catalog lists sandbox tools for E2B and Daytona. This example is the same pattern on Tenki sandboxes: a CrewAI `BaseTool` that runs the agent's Python in a Tenki sandbox and hands the output back. It uses the official [`tenki`](https://tenki.cloud/docs/sandbox/sdk) Python SDK, and the whole tool is one short file you can read and copy.

## Install

You need Python 3.10 to 3.13. The `tenki` SDK needs 3.10 or newer, and current CrewAI releases declare `>=3.10,<3.14`, so Python 3.14 can't install them. CI uses Python 3.12.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/crewai-code-interpreter
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
crewai>=0.80
```

`tenki` is the Tenki Python SDK. CrewAI pulls in `chromadb` and `lancedb` among its own dependencies, which is why the install is the slow step.

## Authenticate

Create a `tk_` API key at https://app.tenki.cloud and export it:

```bash
export TENKI_API_KEY=tk_...
```

That works for both scripts. The alternative is `tenki login --api-key <key>`, which stores the key in `~/.config/tenki/config.yaml`. `verify.py` reads it from there. `agent.py` does not, so you still need the `export` for the agent.

Tenki infers your workspace from the key. If you want a specific one, set `TENKI_WORKSPACE_ID`. Both scripts pass it through when it's set, and they also pick up a `current_workspace_id:` line from `~/.config/tenki/config.yaml` if one is there.

`agent.py` also needs a model key. It uses CrewAI's default model, which is OpenAI:

```bash
export OPENAI_API_KEY=sk-...
```

## Use it

Run the crew:

```bash
.venv/bin/python agent.py
```

This is the part of `agent.py` that builds the sandbox and the crew:

```python
opts = {"cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

with Sandbox.create(**opts) as sandbox:
    analyst = Agent(
        role="Data analyst",
        goal="Answer questions by running Python in a sandbox instead of guessing.",
        backstory="You verify every numeric answer by executing code.",
        tools=[TenkiCodeInterpreter(sandbox=sandbox)],
        verbose=True,
    )
    task = Task(
        description="What is the 20th Fibonacci number? Compute it in the sandbox.",
        expected_output="The number, plus a one-line note on how you got it.",
        agent=analyst,
    )
    print(Crew(agents=[analyst], tasks=[task]).kickoff())
```

One sandbox, with 1 CPU core and 1024 MB of memory, serves the whole crew run. Every `run_python` call the agent makes goes to that same sandbox. `verbose=True` prints the agent's steps, and the last line prints the crew's answer. When the `with` block exits, the SDK terminates the sandbox.

To use the tool in your own crew, copy `tenki_tool.py`, create a sandbox, and pass `TenkiCodeInterpreter(sandbox=sandbox)` in the agent's `tools` list, as above.

## How the tool runs code

The tool, from `tenki_tool.py`:

```python
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, Field, PrivateAttr
from tenki import Sandbox


class RunPythonInput(BaseModel):
    code: str = Field(..., description="The Python code to run.")


class TenkiCodeInterpreter(BaseTool):
    name: str = "run_python"
    description: str = (
        "Execute Python code in a secure, disposable sandbox and return its stdout/stderr. "
        "Use it for calculations, data work, or anything that needs real execution."
    )
    args_schema: Type[BaseModel] = RunPythonInput

    _sandbox: Sandbox = PrivateAttr()

    def __init__(self, sandbox: Sandbox, **kwargs):
        super().__init__(**kwargs)
        self._sandbox = sandbox

    def _run(self, code: str) -> str:
        result = self._sandbox.exec("python3", "-c", code)
        out = f"{result.stdout_text}{result.stderr_text}".strip()
        return out or f"(no output; exit code {result.exit_code})"
```

Three things to know:

- **No shell in between.** `exec(command, *args)` passes its arguments straight through, with no shell splitting, so multi-line, model-generated code goes across as one `-c` argument with no escaping surprises. If you need shell syntax, run it through a shell yourself, for example `exec("bash", "-c", command)`.
- **The model sees one argument.** `args_schema` exposes only `code`. The sandbox is a private attribute that your code passes in when it builds the tool.
- **The agent always gets text back.** The tool returns stdout followed by stderr, so a Python traceback reaches the agent as text. If the code printed nothing, it returns `(no output; exit code N)` instead of an empty string.

The SDK's file methods are confined to `/home/tenki`, which is the sandbox's working directory. Code that this tool runs goes through `exec`, so it can write anywhere, but relative paths land in `/home/tenki`, where the SDK's file methods can read them back.

## Check it works

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.mjs` is a shim so the cookbook's Node verify harness can run this Python example. It runs `verify.py` with `.venv/bin/python` if that exists, otherwise with `$PYTHON` or `python3`. On success it prints:

```
✓ crewai-code-interpreter: CrewAI tool executed Python in a Tenki sandbox → 55
```

The core of `verify.py`:

```python
    with Sandbox.create(**opts) as sb:
        tool = TenkiCodeInterpreter(sandbox=sb)
        # Drive the CrewAI tool exactly as an agent would.
        out = tool._run(code="print(sum(range(11)))")
        if str(out).strip() != "55":
            raise AssertionError(f"tool returned {out!r}")
```

This proves the Tenki-facing half of the example: the tool runs code in a live sandbox and returns its output. It needs no model key, so the CrewAI agent and the model turn aren't exercised. This is what CI runs, on Node 20 and Python 3.12 with only `TENKI_API_KEY` set.

## Troubleshooting

**❌ ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.``** `verify.py` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or the `auth_token` line of `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY`, or run `tenki login --api-key <key>`.

**❌ `missing auth token: set TENKI_AUTH_TOKEN or TENKI_API_KEY` from `agent.py`.** `agent.py` doesn't read `~/.config/tenki/config.yaml` for the key, and the SDK reads only those two environment variables. Export `TENKI_API_KEY=tk_...` in the shell that runs `agent.py`, even if you've run `tenki login`.

**❌ `invalid auth token: expected an API key or service token starting with tk_`.** The key isn't a `tk_` API key, and SDK 1.x accepts nothing else. In `verify.py` this shows up as `✗ InvalidAuthTokenError: …`. Create a key at https://app.tenki.cloud and use that.

**❌ `ModuleNotFoundError: No module named 'tenki'` (or `'crewai'`) from `node verify.mjs`.** There's no `.venv` in the example directory, so the shim fell back to `$PYTHON` or `python3`, which doesn't have the dependencies. Create the venv in this directory as shown in [Install](#install), or set `PYTHON` to the interpreter you installed into.

**❌ Installing `requirements.txt` can't resolve `crewai`.** Your Python is outside what CrewAI supports. Every CrewAI release since 0.80 requires Python 3.10 or newer and below 3.14. Recreate the venv with a supported version, for example `uv venv --python 3.12`.

**❌ `✗ AssertionError: tool returned '…'`.** The sandbox ran the check, but the tool returned something other than `55`. The quoted text is the sandbox's own stdout and stderr, or `(no output; exit code N)`, so read it for the actual error.

## FAQ

**Does the agent keep Python variables between tool calls?** No. Each call starts a new `python3 -c` process. The calls share one sandbox for the length of the crew run, so a file one call writes is still there for the next, but variables are not.

**Why did the tool return `(no output; exit code 0)`?** The code ran and printed nothing. The tool returns only what the code writes to stdout and stderr, so the agent's code has to `print` its answer.

**Can the sandbox reach the internet?** Yes. Outbound network is on by default in SDK 1.x, and this example doesn't change it. `Sandbox.create` takes `allow_outbound=False` if you want the agent's code cut off from the network.

**When shouldn't I use this?** When you need a notebook-style interpreter that keeps variables between calls, since every call here is a fresh process. When your project can't use Python 3.10 to 3.13, which CrewAI requires. When the model's code has to be isolated from the network and you haven't turned outbound access off. And if your agent is written in Node, start from a Node example such as [`langchain-code-interpreter`](../langchain-code-interpreter/) instead.

## Related

- CrewAI: https://crewai.com, docs at https://docs.crewai.com
- Tenki Python SDK and full API: [tenki.cloud/docs/sandbox/sdk](https://tenki.cloud/docs/sandbox/sdk), [`tenki` on PyPI](https://pypi.org/project/tenki/), source at https://github.com/LuxorLabs/tenki-sdk-python
- Tenki docs: https://tenki.cloud/docs
- [`langchain-python`](../langchain-python/): the same `run_python` tool for a LangChain Python agent
- [`run-code-python`](../run-code-python/): the bare Tenki Python SDK loop, with no agent framework
