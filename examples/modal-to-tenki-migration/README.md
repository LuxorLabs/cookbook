# Modal to Tenki

Port a [Modal](https://modal.com) sandbox script to Tenki with the [`tenki`](https://pypi.org/project/tenki/) Python SDK. Both run the same loop: create a sandbox, run a command, read the output, dispose. This folder has a runnable Tenki port, an API map, and the differences that matter.

The change that needs thought: Modal's `exec` returns a live process you drain and wait on. Tenki's `exec` blocks and returns a finished result. See [`exec` returns a result](#exec-returns-a-result-not-a-live-process).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Help me move my Modal sandbox code to Tenki, using the guide at https://github.com/LuxorLabs/cookbook/tree/main/examples/modal-to-tenki-migration.
1. Clone https://github.com/LuxorLabs/cookbook and cd into examples/modal-to-tenki-migration. Create a Python 3.10+ virtualenv and install requirements.txt.
2. The scripts need a Tenki API key (starts with tk_) in TENKI_API_KEY. If it isn't set, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it to a file.
3. Run .venv/bin/python run.py and confirm it prints "42 · exit 0", then run node verify.mjs.
4. Read the API map and "Other differences" in that README.md. Then find every Modal sandbox call in my project and port it to the tenki SDK: drop modal.App, replace stdout.read()/wait() with the finished result's stdout_text/exit_code (or sb.start() where I stream output), switch file calls to relative paths with (path, data) order, and replace idle_timeout with max_duration.
5. Show me the diff before you change anything you're unsure about.
```

## Quick start

You need:

- Python 3.10 or later. [uv](https://docs.astral.sh/uv/) is optional.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud). You don't need a Modal account or the `modal` package.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/modal-to-tenki-migration
uv venv --python 3.12                      # or: python3.11 -m venv .venv
uv pip install -r requirements.txt         # tenki>=1.4.1
```

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...
```

Or run `tenki login --api-key <key>`. The SDK reads `TENKI_AUTH_TOKEN` and `TENKI_API_KEY` itself but not the CLI's `~/.config/tenki/config.yaml`; `run.py` and `verify.py` read that file with a small `cfg()` helper. Keep a helper like it in your port if you rely on `tenki login`.

### 3. Run the port

```bash
.venv/bin/python run.py
```

```
42 · exit 0
```

### 4. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```
✓ modal-to-tenki-migration: create (<id>…) → exec python3 + sh + fs round-trip → 42 → dispose
```

`verify.py` runs a bare binary, a shell one-liner, and a file round-trip in a live sandbox, asserts each result, and disposes of the sandbox. `verify.mjs` is a shim for CI that runs `verify.py` with `.venv/bin/python`, `$PYTHON`, or `python3`.

## The loop, side by side

Modal, from the docstring in `run.py`:

```python
    import modal
    app = modal.App.lookup("my-app", create_if_missing=True)  # auth via ~/.modal.toml
    sb = modal.Sandbox.create(app=app)                        # boots a container
    p = sb.exec("python", "-c", "print(6 * 7)")               # a *live* process
    print(p.stdout.read().strip(), "· exit", p.wait())        # 42 · exit 0
    sb.terminate()
```

Tenki, the end of `run.py`:

```python
# Modal reads ~/.modal.toml (or MODAL_TOKEN_ID / MODAL_TOKEN_SECRET) implicitly.
# Tenki takes an explicit tk_ API key, here from env (CI) or the CLI's config (local).
token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")

opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

# Modal: `Sandbox.create(app=app)` — everything hangs off an App. Tenki: no App
# object — a sandbox is placed by workspace_id. `create(...)` boots
# the sandbox and waits until it's RUNNING (~2s); the `with` block disposes it.
with Sandbox.create(**opts) as sandbox:
    # Modal's exec() returns a *live* process — you drain `p.stdout.read()` and call
    # `p.wait()` for the exit code. Tenki's exec() blocks until the command finishes
    # and returns a `CommandResult` with `.stdout_text` / `.exit_code` already set.
    result = sandbox.exec("python3", "-c", "print(6 * 7)")
    print(result.stdout_text.strip(), "· exit", result.exit_code)  # 42 · exit 0
```

Tenki has no `App` object. A sandbox goes into the workspace your key belongs to, or the `workspace_id` you pass.

## API map

| Concept | Modal (`modal`) | Tenki (`tenki`) |
| --- | --- | --- |
| Install | `pip install modal` | `pip install tenki` |
| Import | `import modal` | `from tenki import Sandbox` (also `Client`) |
| Auth | `modal token new` (`~/.modal.toml`), or `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` | `tk_` key in `TENKI_API_KEY` or `TENKI_AUTH_TOKEN`, or `Sandbox.create(auth_token=…)` |
| App handle | `modal.App.lookup("name", create_if_missing=True)` | None. `workspace_id=…` is optional. |
| Create | `modal.Sandbox.create(app=app)` | `Sandbox.create(auth_token=…, cpu_cores=1, memory_mb=1024)` |
| Run a command | `p = sb.exec("python", "-c", "…")` (live process) | `r = sb.exec("python3", "-c", "…")` (finished result) |
| stdout / stderr | `p.stdout.read()` / `p.stderr.read()` | `r.stdout_text` / `r.stderr_text` |
| Exit code | `p.wait()`; `p.returncode` after `wait()` | `r.exit_code` |
| CPU / memory | `create(app=app, cpu=1, memory=1024)` | `create(…, cpu_cores=1, memory_mb=1024)` |
| Env vars | `sb.exec(cmd, env={…})` | `sb.exec(cmd, env={…})` |
| Working dir | `sb.exec(cmd, workdir="…")` (absolute) | `sb.exec(cmd, cwd="…")` (relative to `/home/tenki`) |
| Write a file | `sb.filesystem.write_text(data, "/abs/path")` | `sb.fs.write_text(path, data)` |
| Read a file | `sb.filesystem.read_text("/abs/path")` | `sb.fs.read_text(path)` |
| Sandbox ID | `sb.object_id` | `sb.id` |
| Reconnect | `modal.Sandbox.from_id(id)` | `Client(auth_token=…).get(id)` |
| List sandboxes | `modal.Sandbox.list(app_id=…)` | `Client(auth_token=…).list()` |
| Networking | On; `create(block_network=True)` to disable | On; `create(allow_outbound=False)` to disable |
| Lifetime cap | `create(timeout=…)` seconds (default 300) | `create(max_duration=…)` seconds or `timedelta` |
| Dispose | `sb.terminate()` | `sb.terminate()`, or a `with` block |

The Modal file rows use `sb.filesystem`, added in Modal 1.4.0. Modal 1.6.0 removed `Sandbox.open()` and `modal.file_io.FileIO`; see Modal's [filesystem migration guide](https://modal.com/docs/guide/migrate-sandbox-filesystem) if your code still uses `sb.open(...)`.

## `exec` returns a result, not a live process

Tenki's `sb.exec(...)` blocks until the command finishes and returns a `CommandResult` with `.stdout_text`, `.stderr_text`, and `.exit_code` set. Drop the drain-then-wait steps.

Both SDKs run a bare binary with no shell, so `sb.exec("echo", "$HOME")` prints `$HOME` on either. For pipes, `&&`, globs, or variables, run a shell. From `verify.py`:

```python
        # Modal's exec() returns a live process (drain p.stdout.read(), p.wait()).
        # Tenki's exec() blocks and returns a finished CommandResult.
        r = sb.exec("python3", "-c", "print(6 * 7)")
        if not (r.exit_code == 0 and r.stdout_text.strip() == "42"):
            raise AssertionError(f"python3 exec: exit {r.exit_code}, stdout {r.stdout_text!r}")

        # Both run a bare binary + args (no shell). For shell syntax, ask for a shell
        # explicitly on either platform — same as Modal.
        sh = sb.exec("sh", "-c", "echo hello-from-tenki")
        if not (sh.exit_code == 0 and sh.stdout_text.strip() == "hello-from-tenki"):
            raise AssertionError(f"sh exec: exit {sh.exit_code}, stdout {sh.stdout_text!r}")
```

To read output while a command runs, use `sb.start(...)`, which returns a live process: iterate `proc.stdout`, then call `proc.wait()`. This example doesn't use it.

## Other differences

- **Files use relative paths, and the arguments swap.** SDK file methods are confined to `/home/tenki`. Modal's `write_text(data, remote_path)` becomes `write_text(path, data)`:

  ```python
          sb.fs.write_text("migrate.txt", "modal->tenki")
          back = sb.fs.read_text("migrate.txt")
  ```

  Commands run with `exec` can write anywhere.
- **Use `max_duration` for lifetime.** Don't map Modal's `idle_timeout` to `idle_timeout_minutes`: the SDK accepts it but ignores it, and Tenki doesn't pause idle sandboxes. Use `max_duration`, or call `sb.pause()` yourself. A paused sandbox is free and keeps its memory and disk.
- **Outbound network is on by default**, as on Modal. Pass `allow_outbound=False` to isolate a sandbox.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` or `missing auth token` | Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `invalid auth token: expected an API key or service token starting with tk_` | That's not a Tenki key (perhaps a Modal token ID). Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `permission_denied … path outside workdir` from `sb.fs` | Modal takes absolute paths; Tenki SDK file calls need paths under `/home/tenki`. Use a relative path. |
| `$HOME`, a pipe, or `&&` comes through literally | Wrap the command: `sb.exec("sh", "-c", "…")`. |

## Related

- [E2B to Tenki](../e2b-to-tenki-migration/) and [Daytona to Tenki](../daytona-to-tenki-migration/) (Node)
- [Run code with Python](../run-code-python/)
- [`tenki` SDK docs](https://tenki.cloud/docs/sandbox/sdk) and [LuxorLabs/tenki-sdk-python](https://github.com/LuxorLabs/tenki-sdk-python)
- [Modal `Sandbox` reference](https://modal.com/docs/sdk/py/latest/Sandbox)
