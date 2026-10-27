# Hugging Face smolagents

Run a [smolagents](https://github.com/huggingface/smolagents) `CodeAgent`'s generated Python in a Tenki sandbox. `TenkiExecutor` is a remote executor, like smolagents' own E2B, Docker, Modal, and Blaxel executors: one sandbox per agent session, a persistent Python namespace across steps, and cleanup when the agent finishes. The agent loop, model calls, and model key stay in your process.

`TenkiExecutor` lives in this example, not in smolagents. Copy `tenki_executor.py` into your project and pass it with `CodeAgent(executor=...)`. smolagents 1.26.0 has no `executor_type="tenki"`; [PR #2563](https://github.com/huggingface/smolagents/pull/2563) proposes one.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Hugging Face smolagents" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/smolagents, create a .venv there on Python 3.10 or later (uv venv --python 3.12 if uv is installed), and install requirements.txt. If I'm using OpenAI, also install 'smolagents[openai]'.
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) and, for agent.py, either OPENAI_API_KEY or HF_TOKEN. If they're missing, stop and ask me to export them. Never print the keys or write them to a file.
3. Run node verify.mjs first (no model call), then .venv/bin/python agent.py.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then wire tenki_executor.py into my own CodeAgent with executor=TenkiExecutor(...), keep outbound network on, and make sure executor.cleanup() always runs.
```

## Quick start

You need:

- Python 3.10 or later. [uv](https://docs.astral.sh/uv/) is optional.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An OpenAI API key or a Hugging Face token, for the agent run only.

### 1. Install

Create the venv in the example directory as `.venv`; `verify.mjs` looks for it there.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/smolagents
uv venv --python 3.12
uv pip install -r requirements.txt           # tenki, smolagents
uv pip install 'smolagents[openai]'          # only if you'll use an OpenAI model
```

Without uv: `python3.11 -m venv .venv && .venv/bin/pip install -r requirements.txt`. `tenki_executor.py` needs smolagents 1.25.0 or later; upgrade if you install into an environment with an older one.

### 2. Set your keys

```bash
export TENKI_API_KEY=tk_...
export OPENAI_API_KEY=sk-...    # or: export HF_TOKEN=hf_...
```

Both scripts check `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

`agent.py` picks the model from the keys it finds:

```python
def build_model():
    """Pick a model from whatever key is in the environment."""
    if os.environ.get("OPENAI_API_KEY"):
        from smolagents import OpenAIServerModel

        return OpenAIServerModel(model_id=os.environ.get("TENKI_DEMO_MODEL", "gpt-4o-mini"))
    from smolagents import InferenceClientModel

    return InferenceClientModel(model_id=os.environ.get("TENKI_DEMO_MODEL", "Qwen/Qwen2.5-Coder-32B-Instruct"))
```

Set `TENKI_DEMO_MODEL` to use a different model ID.

### 3. Run the agent

```bash
.venv/bin/python agent.py
```

The agent computes the 20th Fibonacci number. Each code step runs in the sandbox, and the sandbox is terminated at the end.

### 4. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```
✓ smolagents: TenkiExecutor ran CodeAgent Python in a Tenki sandbox (42), kept state across steps (55), caught final_answer (42), surfaced errors
```

`verify.py` drives the executor the way `CodeAgent` does: it runs `print(6 * 7)`, sets a variable in one call and reads it in the next, raises a final answer, and checks that a `ValueError` surfaces as `AgentError`. It needs no model key, so it doesn't run a `CodeAgent` turn, `send_tools`, or package installs.

## Use it in your agent

1. Copy `tenki_executor.py` and add `tenki>=1.4.1` and `smolagents>=1.25.0` to your dependencies.
2. Build a `TenkiExecutor` with `additional_imports`, an `AgentLogger`, and keyword arguments for `Sandbox.create(...)`:

   ```python
   # allow_outbound=True: CodeAgent patches its final_answer tool, and smolagents
   # then pip-installs that tool's inferred requirements (numpy, pillow) into the
   # sandbox at send_tools time — which needs outbound network.
   opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024, "allow_outbound": True}
   workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
   if workspace_id:
       opts["workspace_id"] = workspace_id
   ```

3. Pass it as `CodeAgent(..., executor=executor)` and call `executor.cleanup()` when you're done:

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

Things to know:

- **Keep outbound network on.** smolagents pip-installs the `final_answer` tool's requirements (`numpy`, `pillow`) into the sandbox at the start of each run.
- **List extra packages on the executor.** `TenkiExecutor(additional_imports=[...])` installs them at startup. `CodeAgent(additional_authorized_imports=...)` isn't forwarded to an executor you pass in.
- **Your tools run in the sandbox too.** `send_tools` sends each tool's class source and installs its requirements there, and `send_variables` sends `agent.state`. A tool's `forward()` sees the sandbox's files and environment, not yours.
- **Clean up explicitly.** `agent.run()` doesn't call `executor.cleanup()`. Leaving a `with CodeAgent(...)` block or calling `agent.cleanup()` does, and `__del__` is a last resort.
- **Size and lifetime** come from `Sandbox.create` arguments: `cpu_cores`, `memory_mb`, and `max_duration` (seconds or a `timedelta`).

## How the executor works

`CodeAgent` needs one namespace shared across steps, but `sandbox.exec()` starts a fresh `python3` each time. So `TenkiExecutor` starts a small persistent kernel inside the sandbox:

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

- **The kernel** (`kernel.py`) is stdlib-only and listens on `127.0.0.1:47000`, inside the sandbox only. It keeps one namespace, captures stdout and stderr, and returns a trailing expression as the step's output.
- **Each step** base64-encodes the code and runs `python3 /home/tenki/client.py <base64>` with `exec`, so multi-line code never needs escaping. The client relays it to the kernel and prints the result as JSON.
- **Final answers** arrive as `FinalAnswerException("safe:<json>")`, which the kernel catches by name.
- **Errors** become `AgentError`, which `CodeAgent` shows the model so it can retry.
- **Packages** install with `python3 -m pip install -q …`, since the kernel can't run `!pip` magics.
- **The sandbox is the security boundary.** The kernel has no import allowlist like `LocalPythonExecutor`.

The step itself:

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

`TenkiExecutor` calls `_deserialize_final_answer`, a private smolagents helper whose format changed in 1.25.0. Pin smolagents and re-run `verify.py` when you upgrade. Managed agents (multi-agent setups) aren't exercised by this example.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` | Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `ValueError: Unsupported executor type: tenki` | Pass `executor=TenkiExecutor(...)`, not `executor_type="tenki"`. |
| ``ModuleNotFoundError: Please install 'openai' extra …`` | Run `uv pip install 'smolagents[openai]'`. |
| `pip install failed (exit N). Create the sandbox with allow_outbound=True …` | Keep `allow_outbound=True`. If the network isn't the cause, pip's output follows the message. |
| `✗ RuntimeError: Tenki kernel did not become ready: …` | The kernel didn't answer within 30 pings. The text after the colon is the last reply: `no response`, `KernelUnreachable`, or `BadKernelResponse` with the client's output. |

## Related

- [LlamaIndex](../llamaindex/) and [CrewAI](../crewai-code-interpreter/): Python agents that use a tool instead of an executor
- [Run code with Python](../run-code-python/)
- [smolagents secure code execution](https://huggingface.co/docs/smolagents/tutorials/secure_code_execution) and [`remote_executors.py`](https://github.com/huggingface/smolagents/blob/main/src/smolagents/remote_executors.py)
- [`tenki` SDK docs](https://tenki.cloud/docs/sandbox/sdk)
