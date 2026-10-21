# CrewAI

Give a [CrewAI](https://crewai.com) agent a `run_python` code-interpreter tool that runs in a Tenki sandbox. CrewAI removed its built-in [`CodeInterpreterTool`](https://docs.crewai.com/en/tools/ai-ml/codeinterpretertool) and points users to a sandbox service. `tenki_tool.py` is that tool on Tenki: a CrewAI `BaseTool` that runs the agent's Python in one sandbox shared for the crew run.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "CrewAI" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/crewai-code-interpreter, create a .venv there on Python 3.10 to 3.13 (uv venv --python 3.12 if uv is installed), and install requirements.txt. The install takes a few minutes.
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) and, for agent.py, OPENAI_API_KEY. If either is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs first (no model call, expects 55), then .venv/bin/python agent.py.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then add tenki_tool.py to my own crew: one sandbox per run in a with block, and TenkiCodeInterpreter(sandbox=sandbox) in the agent's tools.
```

## Quick start

You need:

- Python 3.10 to 3.13. CrewAI doesn't support 3.14. [uv](https://docs.astral.sh/uv/) is optional.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An OpenAI API key (CrewAI's default model), for the crew run only.

### 1. Install

Create the venv in the example directory as `.venv`; `verify.mjs` looks for it there.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/crewai-code-interpreter
uv venv --python 3.12
uv pip install -r requirements.txt   # tenki, crewai
```

Without uv: `python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt`. CrewAI pulls in `chromadb` and `lancedb`, so the install takes a few minutes.

### 2. Set your keys

```bash
export TENKI_API_KEY=tk_...
export OPENAI_API_KEY=sk-...
```

`agent.py` needs the Tenki key in the environment (`TENKI_API_KEY` or `TENKI_AUTH_TOKEN`). `verify.py` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run the crew

```bash
.venv/bin/python agent.py
```

The agent computes the 20th Fibonacci number with `run_python`. `verbose=True` prints its steps, and the last line is the crew's answer.

### 4. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```
✓ crewai-code-interpreter: CrewAI tool executed Python in a Tenki sandbox → 55
```

`verify.py` calls the tool directly with `print(sum(range(11)))` and checks for `55`. It needs no OpenAI key. `verify.mjs` is a CI shim that runs it with `.venv/bin/python`, `$PYTHON`, or `python3`.

## The crew

The part of `agent.py` that builds the sandbox and the crew:

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

The `with` block terminates the sandbox when the crew finishes.

## The tool

`tenki_tool.py`:

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

Things to know:

- **The model only supplies `code`.** The sandbox is a private attribute you pass in.
- **No shell.** `exec(command, *args)` passes the code as one `-c` argument. For shell syntax, use `exec("bash", "-c", command)`.
- **Errors come back as text.** Tracebacks reach the agent. Code that prints nothing returns `(no output; exit code N)`, so the agent has to `print` its answer.
- **No state between calls.** Each call is a new `python3` process. Files persist in the shared sandbox; variables don't. Relative paths land in `/home/tenki`.
- **Outbound network is on.** Pass `allow_outbound=False` to `Sandbox.create` to cut the agent's code off.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` | Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `missing auth token: set TENKI_AUTH_TOKEN or TENKI_API_KEY` from `agent.py` | `agent.py` doesn't read the `tenki login` key. Export `TENKI_API_KEY`. |
| `invalid auth token: expected an API key or service token starting with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `ModuleNotFoundError: No module named 'tenki'` (or `'crewai'`) from `node verify.mjs` | There's no `.venv` here. Create it as in step 1, or set `PYTHON`. |
| `crewai` won't resolve | Use Python 3.10 to 3.13, for example `uv venv --python 3.12`. |
| `✗ AssertionError: tool returned '…'` | The quoted text is the sandbox's output. Read it for the error. |

## Related

- [LangChain (Python)](../langchain-python/): the same tool for a LangChain agent
- [Run code with Python](../run-code-python/): the bare SDK loop
- [CrewAI docs](https://docs.crewai.com)
- [`tenki` SDK docs](https://tenki.cloud/docs/sandbox/sdk) and [LuxorLabs/tenki-sdk-python](https://github.com/LuxorLabs/tenki-sdk-python)
