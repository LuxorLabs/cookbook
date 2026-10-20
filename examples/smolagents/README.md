# How to run a smolagents CodeAgent's generated Python in a Tenki sandbox

A `CodeAgent` runs every code step in one [Tenki](https://tenki.cloud) sandbox and terminates that sandbox when the agent finishes. A check of the executor passes with no model key.

About 10 minutes.

`TenkiExecutor` is code in this example. It is not part of smolagents. Copy `tenki_executor.py` into your project and pass it with `CodeAgent(executor=...)`. As of smolagents 1.26.0 there is no `executor_type="tenki"`. [smolagents PR #2563](https://github.com/huggingface/smolagents/pull/2563) proposes one and has not been merged.

## Why bother

`CodeAgent` writes Python as its actions and runs it. By default it runs that code with smolagents' `LocalPythonExecutor`, inside your own Python process, and smolagents' docs warn that "no local python sandbox can ever be completely secure". Their answer is a remote executor. The E2B, Docker, Modal and Blaxel executors all subclass `RemotePythonExecutor` in [`smolagents/remote_executors.py`](https://github.com/huggingface/smolagents/blob/main/src/smolagents/remote_executors.py), and `TenkiExecutor` subclasses it too:

- One sandbox per agent session, reused across every step and terminated by `executor.cleanup()`.
- The model's code runs in the sandbox, along with your tools and `agent.state`, which smolagents sends at the start of each run (`send_tools`, `send_variables`). The agent loop, the model calls and your model key stay in your process.
- Swapping it in is one argument: `CodeAgent(..., executor=TenkiExecutor(...))`.

## Install

You need Python 3.10 or newer. Both `tenki` and `smolagents` require it.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/smolagents
```

Every later command runs from this directory. Create the virtual environment here, as `.venv`, because `verify.mjs` looks for `.venv/bin/python`:

```bash
uv venv --python 3.12
uv pip install -r requirements.txt         # the tenki SDK + smolagents
```

Without `uv`:

```bash
python3.11 -m venv .venv                   # any Python 3.10+
.venv/bin/pip install -r requirements.txt
```

The dependencies, from `requirements.txt`:

```
tenki>=1.4.1
smolagents>=1.20
```

**`requirements.txt` allows `smolagents>=1.20`, but `tenki_executor.py` needs 1.25.0 or newer.** It passes `allow_pickle` to `RemotePythonExecutor` and calls its `_deserialize_final_answer`, and both first appear in smolagents 1.25.0. A fresh `.venv` installs the newest release, so this only matters if you install into an environment that already has an older smolagents. Upgrade it.

`requirements.txt` installs core smolagents, which includes `InferenceClientModel` (Hugging Face Inference). To run the agent on an OpenAI model instead, add the extra:

```bash
uv pip install 'smolagents[openai]'        # or: .venv/bin/pip install 'smolagents[openai]'
```

## Authenticate

The `tenki` SDK takes a `tk_` API key. Create one at https://app.tenki.cloud, then export it or store it with the Tenki CLI:

```bash
export TENKI_API_KEY=tk_...                # or: tenki login --api-key <key>
```

`tenki login --api-key` stores the key in `~/.config/tenki/config.yaml`. Both `agent.py` and `verify.py` look for the key in `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then that file. From `agent.py`:

```python
# A tk_ API key, from env or ~/.config/tenki/config.yaml (`tenki login --api-key`).
token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")
```

You don't need a workspace ID. Tenki infers the workspace from a workspace API key. To pick one explicitly, set `TENKI_WORKSPACE_ID`. The scripts also read a `current_workspace_id:` line from `~/.config/tenki/config.yaml` if one is there, but `tenki login` itself stores only the key.

## Use it

### Run the example agent

`agent.py` needs a model as well as Tenki. It picks one from whichever key is in the environment. From `agent.py`:

```python
def build_model():
    """Pick a model from whatever key is in the environment."""
    if os.environ.get("OPENAI_API_KEY"):
        from smolagents import OpenAIServerModel

        return OpenAIServerModel(model_id=os.environ.get("TENKI_DEMO_MODEL", "gpt-4o-mini"))
    from smolagents import InferenceClientModel

    return InferenceClientModel(model_id=os.environ.get("TENKI_DEMO_MODEL", "Qwen/Qwen2.5-Coder-32B-Instruct"))
```

Set `TENKI_DEMO_MODEL` to use a different model ID. If `OPENAI_API_KEY` isn't set, `InferenceClientModel` uses `HF_TOKEN`, or the token stored by the Hugging Face CLI. Then run it:

```bash
export OPENAI_API_KEY=sk-...   # OpenAIServerModel (pip install 'smolagents[openai]')
#   or: export HF_TOKEN=hf_... # InferenceClientModel (Hugging Face Inference, core dep)
.venv/bin/python agent.py
```

The agent is asked for the 20th Fibonacci number. Each piece of Python the model writes runs in the sandbox, `agent.py` prints the answer, and the `finally` block terminates the sandbox. The end of `agent.py`:

```python
# The executor boots one sandbox and reuses it for every step of the agent's
# reasoning; `CodeAgent(executor=...)` swaps it in for the default local one.
executor = TenkiExecutor(additional_imports=[], logger=AgentLogger(LogLevel.INFO), **opts)
try:
    agent = CodeAgent(tools=[], model=build_model(), executor=executor)
    answer = agent.run("What is the 20th Fibonacci number? Compute it in Python.")
    print(answer)
finally:
    executor.cleanup()  # terminate the sandbox
```

No model key yet? [Check it works](#check-it-works) exercises the executor without one.

### Add it to your own agent

1. Copy `tenki_executor.py` next to your code, and add `tenki>=1.4.1` and `smolagents>=1.25.0` to your dependencies.
2. Build a `TenkiExecutor` from `additional_imports`, a smolagents `AgentLogger`, and any keyword arguments for `Sandbox.create(...)`, which it passes straight through. `agent.py` builds them like this:

   ```python
   # allow_outbound=True: CodeAgent patches its final_answer tool, and smolagents
   # then pip-installs that tool's inferred requirements (numpy, pillow) into the
   # sandbox at send_tools time — which needs outbound network.
   opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024, "allow_outbound": True}
   workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
   if workspace_id:
       opts["workspace_id"] = workspace_id
   ```

3. Pass it as `CodeAgent(..., executor=executor)`, and call `executor.cleanup()` when you're done.

A few things to know when you do:

- A live run needs outbound network, as the comment above explains. Outbound network is on by default in the Tenki SDK, and `agent.py` also sets `allow_outbound=True` explicitly.
- Extra packages go to the executor. List them in `TenkiExecutor(additional_imports=[...])`, and it pip-installs them into the sandbox when it starts. smolagents forwards `CodeAgent(additional_authorized_imports=...)` only to executors it builds itself, not to one you pass in with `executor=`.
- Tools you pass to `CodeAgent(tools=[...])` run inside the sandbox too. At the start of each run, smolagents' `send_tools` pip-installs each tool's requirements there, sends the tool's class source, class attributes included, and instantiates the class there with no arguments. A tool's `forward()` sees the sandbox's files and environment variables, not your machine's.
- `executor.cleanup()` terminates the sandbox with a real `TerminateSession` call to Tenki. `agent.run()` doesn't call it. smolagents does call it when a `CodeAgent` used as a context manager leaves its `with` block, or when you call `agent.cleanup()`. `TenkiExecutor.__del__` calls it as a last resort.
- The SDK's file methods only reach `/home/tenki`. This example doesn't use them: it writes its two helper files with a `python3` one-liner over `exec`, and starts the kernel in `/home/tenki`, so relative paths in the agent's code land there.

## How the executor works: a persistent kernel inside the sandbox

`CodeAgent` needs a stateful namespace. It defines the tools once (`send_tools`), then every step's code shares variables with the step before. Tenki's `sandbox.exec()` starts a fresh `python3` on each call, so `TenkiExecutor` runs a small persistent kernel inside the sandbox. smolagents' own E2B, Docker, Modal and Blaxel executors also keep a live kernel. Setup happens in the constructor, from `tenki_executor.py`:

```python
    def __init__(self, additional_imports, logger, allow_pickle=False, **sandbox_kwargs):
        super().__init__(additional_imports, logger, allow_pickle)
        # Boot the sandbox and wait until it's RUNNING (~2s).
        self.sandbox = Sandbox.create(**sandbox_kwargs)
        # Drop the kernel + client into /home/tenki and start the kernel daemon.
        self._put("/home/tenki/kernel.py", _KERNEL)
        self._put("/home/tenki/client.py", _CLIENT)
        self.sandbox.exec(
            "sh", "-c",
            "cd /home/tenki && nohup python3 kernel.py >/home/tenki/kernel.log 2>&1 & echo started",
        )
        self._await_kernel()
        self.installed_packages = self.install_packages(additional_imports)
        self.logger.log("Tenki sandbox is running", level=LogLevel.INFO)
```

- The kernel (`kernel.py`) is pure stdlib. It listens on `127.0.0.1:47000`, the sandbox's loopback only, so it's never exposed and needs no outbound network and no image changes. It holds one namespace, runs the code sent to it, and captures stdout and stderr. A trailing expression becomes the step's output, as in Jupyter.
- On each step, the executor base64-encodes the code and runs `python3 /home/tenki/client.py <base64>` with `sandbox.exec`. Tenki's `sandbox.exec(command, *args)` passes args straight through with no shell splitting, and the base64 means multi-line model output never hits an escaping surprise. The client relays the code to the kernel over loopback and prints the result as JSON.
- `CodeAgent`'s `final_answer` tool is patched to raise `FinalAnswerException("safe:<json>")`. The kernel catches it by name, and the executor deserializes the value.
- Errors come back as `AgentError`, which `CodeAgent` shows the model so it can retry.
- `install_packages` runs `python3 -m pip install -q …` with `exec`. The base class's default sends `!pip install`, a Jupyter magic this plain kernel can't run.
- The sandbox is the security boundary. The kernel runs code as ordinary Python, with no import allowlist like the one `LocalPythonExecutor` enforces.

`TenkiExecutor` implements three `RemotePythonExecutor` methods: `run_code_raise_errors`, `install_packages` and `cleanup`. The step itself, from `tenki_executor.py`:

```python
    def run_code_raise_errors(self, code: str) -> CodeOutput:
        env = self._call(code)
        if env is None:
            raise AgentError("No response from the Tenki kernel.", self.logger)
        logs = env.get("logs") or ""
        if env.get("is_final_answer"):
            answer = self._deserialize_final_answer(env.get("final"), self.allow_pickle)
            return CodeOutput(output=answer, logs=logs, is_final_answer=True)
        err = env.get("error")
        if err:
            raise AgentError(
                f"{logs}\nExecuting code yielded an error:\n"
                f"{err['name']}\n{err['value']}\n{err.get('traceback', '')}",
                self.logger,
            )
        return CodeOutput(output=env.get("output"), logs=logs, is_final_answer=False)
```

## Check it works

```bash
.venv/bin/python verify.py      # or: node verify.mjs
```

It prints:

```
✓ smolagents: TenkiExecutor ran CodeAgent Python in a Tenki sandbox (42), kept state across steps (55), caught final_answer (42), surfaced errors
```

`verify.py` builds the executor against a live sandbox and drives it the way `CodeAgent` does. It runs `print(6 * 7)` (`42`), sets a variable in one call and reads it in the next (`55`), raises the `FinalAnswerException("safe:<json>")` shape by hand and checks the executor returns `42` as a final answer, and checks that a `ValueError` surfaces as `AgentError`. Then it terminates the sandbox. With no model key, it exercises `run_code_raise_errors` and `cleanup` against a live sandbox, but not a `CodeAgent` turn, smolagents' `send_tools`, or `install_packages` with any packages, all of which a live run triggers.

On failure it prints a `✗` line and exits non-zero. `verify.mjs` is a Node shim that runs `verify.py` with `.venv/bin/python` if it exists, otherwise `$PYTHON` or `python3`. CI runs this example through `node verify.mjs` (the same pattern as [`run-code-python`](../run-code-python/)), on Node 20 and Python 3.12, with only `TENKI_API_KEY` set.

## Troubleshooting

- ❌ **``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.``** `verify.py` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or an `auth_token:` line in `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.
- ❌ **`ValueError: Unsupported executor type: tenki`.** You passed `executor_type="tenki"`, and released smolagents has no Tenki executor type. Build a `TenkiExecutor` from this example and pass it with `executor=`.
- ❌ **``ModuleNotFoundError: Please install 'openai' extra to use OpenAIModel: `pip install 'smolagents[openai]'` ``.** `OPENAI_API_KEY` is set, so `agent.py` picks `OpenAIServerModel`, but `requirements.txt` installs only core smolagents. Run `uv pip install 'smolagents[openai]'`, or `.venv/bin/pip install 'smolagents[openai]'`.
- ❌ **`pip install failed (exit N). Create the sandbox with allow_outbound=True for network access.`** The sandbox couldn't pip-install packages: your `additional_imports` at startup, or the `numpy` and `pillow` smolagents asks for when it sends the `final_answer` tool. The message points at the network: check that the sandbox wasn't created with `allow_outbound=False`, and leave it at `True`. If the network isn't the cause, pip's own output follows the message.
- ❌ **`✗ RuntimeError: Tenki kernel did not become ready: …`.** The in-sandbox kernel didn't answer the executor's no-op ping in 30 tries. `kernel.py` writes its output to `/home/tenki/kernel.log` inside the sandbox, but you can't read it: the constructor raises before you get the executor, and the half-built executor's `__del__` terminates the sandbox when Python collects it. Start from the text after the colon instead. It is the ping's last reply: `no response`, a `KernelUnreachable` error when nothing was listening on `127.0.0.1:47000`, or a `BadKernelResponse` that carries the client's raw output and stderr.

## FAQ

**Does this run my whole agent on Tenki, or only the code?** The code the model writes, plus your tools and `agent.state`. At the start of each run, smolagents' `send_tools` sends each tool's source into the sandbox and pip-installs its requirements there, so a tool's `forward()` runs in the sandbox, and `send_variables` sends `agent.state`. The `CodeAgent` loop and the model calls run in your Python process, and your model key stays there. The options in `opts` (the Tenki key, size, network and workspace) go to `Sandbox.create(...)`, which runs in your process.

**How do I change the VM size or cap its lifetime?** `TenkiExecutor` passes its extra keyword arguments to `Sandbox.create(...)`. `cpu_cores` and `memory_mb` set the size (`agent.py` uses 1 core and 1024 MB). `max_duration`, in seconds or as a `timedelta`, caps the sandbox's lifetime.

**When shouldn't I use this?**
- When you want an executor smolagents maintains. This one is a file you own, and it calls `_deserialize_final_answer`, an underscore-prefixed helper whose wire format changed in 1.25.0. Pin smolagents and re-run `verify.py` when you upgrade.
- For multi-agent setups. `CodeAgent` refuses managed agents with the remote executors it builds ("Managed agents are not yet supported with remote code execution."), and smolagents' docs say the run-snippets-in-a-sandbox approach doesn't support multi-agents. Passing `TenkiExecutor` with `executor=` skips that check, and smolagents then passes the managed agents to `send_tools` along with the tools, but this example doesn't exercise managed agents.
- When the agent's code must have no network access. As written, a live run pip-installs `numpy` and `pillow` into the sandbox, which needs outbound network.
- When you need Jupyter behavior. The kernel is plain Python: there are no `!` magics, and a step's trailing value comes back as JSON or its `repr()`, not rich output.

## Related

- [smolagents](https://github.com/huggingface/smolagents) and its executor seam, [`remote_executors.py`](https://github.com/huggingface/smolagents/blob/main/src/smolagents/remote_executors.py), home of the E2B, Docker, Modal and Blaxel executors
- [smolagents: secure code execution](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution)
- [smolagents PR #2563](https://github.com/huggingface/smolagents/pull/2563), the proposed built-in Tenki executor
- [Tenki docs](https://tenki.cloud/docs), the [Python SDK and full API](https://tenki.cloud/docs/sandbox/sdk), and [`tenki` on PyPI](https://pypi.org/project/tenki/)
- [`run-code-python`](../run-code-python/): the core Tenki loop in Python, with the same `verify.mjs` → `verify.py` shim
- [`crewai-code-interpreter`](../crewai-code-interpreter/): a CrewAI agent that runs its Python on Tenki through a tool instead of an executor
