# How to port a Modal sandbox script to Tenki

**Audience:** Python developers who run sandboxes on [Modal](https://modal.com) with `modal.Sandbox` and want the same loop on [Tenki](https://tenki.cloud).
**Time:** ~5 minutes to install, run and verify the example.
**Outcome:** `run.py` prints `42 · exit 0` from a Tenki sandbox, `verify.py` passes, and you have a Modal-to-Tenki API map for porting the rest of your script.

> **Honesty note:** Nothing in this example calls Modal. The Modal code appears only as reference, in `run.py`'s docstring and in comments. `run.py` and `verify.py` exercise the Tenki side: create, `exec`, a file round-trip, and dispose. The other rows of the API map below come from the two SDKs' sources and are not run here.

## Why bother

Modal and Tenki both give you a disposable cloud sandbox with the same core loop: create → run a command → capture output → dispose. Moving that loop to Tenki is a small, mechanical change with the official [`tenki`](https://tenki.cloud/docs/sandbox/sdk) Python SDK. The one change that needs thought is `exec`: Modal hands you a live process, Tenki hands you a finished result.

## Install

You need Python 3.10 or newer. Get the example:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/modal-to-tenki-migration
```

Every later command runs from this directory. Create a virtual environment and install the SDK:

```bash
uv venv --python 3.12                      # or: python3.11 -m venv .venv
uv pip install -r requirements.txt         # or: .venv/bin/pip install -r requirements.txt
```

`requirements.txt` has one line, `tenki>=1.4.1`. You don't need the `modal` package.

## Authenticate

Tenki takes a `tk_` API key. Create one at https://app.tenki.cloud, then either export it:

```bash
export TENKI_API_KEY=tk_...
```

or store it with the Tenki CLI:

```bash
tenki login --api-key <key>
```

`tenki login` writes the key to `~/.config/tenki/config.yaml`. The SDK reads `TENKI_AUTH_TOKEN` or `TENKI_API_KEY` from the environment by itself, but it does not read that file: `run.py` and `verify.py` fall back to it with their own small `cfg()` helper. If you port your script and rely on `tenki login`, keep a helper like that or set the environment variable.

The workspace is inferred from the key, so you don't need a workspace ID. Set `TENKI_WORKSPACE_ID` only if you want to choose one explicitly.

For comparison, Modal authenticates implicitly from `~/.modal.toml` (written by `modal token new`) or from `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`.

## Use it

```bash
.venv/bin/python run.py                    # 42 · exit 0
```

`run.py` creates a sandbox with 1 CPU core and 1024 MB of memory. `create()` boots the sandbox and waits until it is running (about 2 seconds, per the script's comment). The script then runs `python3 -c "print(6 * 7)"`, prints the output and exit code, and disposes the sandbox when the `with` block ends.

## Port your Modal script

### The loop, side by side

Modal, from the docstring at the top of `run.py`:

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

There is no `App` object on Tenki. Modal ties every sandbox to a `modal.App`, so `modal.App.lookup(...)` comes first. A Tenki sandbox goes straight into the workspace your key belongs to, or the one you pass as `workspace_id`.

### API map

| Concept | Modal (`modal`) | Tenki (`tenki`) |
| --- | --- | --- |
| Install | `pip install modal` | `pip install tenki` |
| Import | `import modal` | `from tenki import Sandbox` |
| Auth | `modal token new` (writes `~/.modal.toml`), or `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` | a `tk_` API key: `TENKI_API_KEY` or `TENKI_AUTH_TOKEN`, or `Sandbox.create(auth_token=…)` |
| App handle | `app = modal.App.lookup("name", create_if_missing=True)` (required first) | none; the key's workspace holds the sandbox (`workspace_id=…` is optional) |
| Create | `modal.Sandbox.create(app=app)` | `Sandbox.create(auth_token=…, cpu_cores=1, memory_mb=1024)` |
| Run a command | `p = sb.exec("python", "-c", "…")` → live process | `r = sb.exec("python3", "-c", "…")` → finished result |
| stdout / stderr | `p.stdout.read()` / `p.stderr.read()` (drain streams) | `r.stdout_text` / `r.stderr_text` (already captured) |
| Exit code | `p.wait()` returns it; `p.returncode` works only after `wait()` | `r.exit_code` |
| CPU / memory | `create(app=app, cpu=1, memory=1024)` | `create(…, cpu_cores=1, memory_mb=1024)` |
| Env vars | `sb.exec(cmd, env={…})` | `sb.exec(cmd, env={…})` |
| Working dir | `sb.exec(cmd, workdir="…")` (must be absolute) | `sb.exec(cmd, cwd="…")` (relative paths resolve under `/home/tenki`) |
| Write a file | `sb.filesystem.write_text(data, "/abs/path")` | `sb.fs.write_text(path, data)` |
| Read a file | `sb.filesystem.read_text("/abs/path")` | `sb.fs.read_text(path)` |
| Sandbox ID | `sb.object_id` | `sb.id` |
| Reconnect | `modal.Sandbox.from_id(id)` | `Client(auth_token=…).get(id)` |
| List sandboxes | `modal.Sandbox.list(app_id=…)` | `Client(auth_token=…).list()` |
| Networking | on by default; `create(block_network=True)` to disable | on by default; `create(allow_outbound=False)` to disable |
| Lifetime cap | `create(timeout=…)`, in seconds (default 300) | `create(max_duration=…)`, in seconds or a `timedelta` |
| Dispose | `sb.terminate()` | `sb.terminate()`, or let `with` dispose it |

`Client` is also importable from `tenki`. The Modal file rows use `sb.filesystem`, added in Modal 1.4.0. Modal 1.6.0 (2026-09-28) removed `Sandbox.open()` and `modal.file_io.FileIO`, so if your Modal code still uses `with sb.open(path, "w") as f:`, it has to change on Modal too; see Modal's [filesystem migration guide](https://modal.com/docs/guide/migrate-sandbox-filesystem).

### `exec` returns a result, not a live process

This is the change that bites most on a Modal port. Modal's `sb.exec(...)` returns a `ContainerProcess` that you drive yourself: drain `p.stdout.read()`, then call `p.wait()` for the exit code. Tenki's `sb.exec(...)` **blocks until the command finishes** and returns a `CommandResult` with `.stdout_text`, `.stderr_text` and `.exit_code` already set. The stream-then-wait steps collapse into reading attributes.

What doesn't change: both run a bare binary and its arguments, with no shell. `sb.exec("echo", "$HOME")` prints a literal `$HOME` on either platform. For pipes, `&&`, globs or variables, ask for a shell explicitly, the same as on Modal. From `verify.py`:

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

If your Modal code reads output while the command is still running, `exec` is the wrong port. The Tenki SDK's `sb.start(...)` returns a live process instead (iterate `proc.stdout`, then `proc.wait()`). This example doesn't use it.

### Files: relative paths, and the arguments swap

Tenki confines the SDK's file methods to `/home/tenki`, the sandbox's working directory, so write to relative paths. Modal's `sb.filesystem` methods want absolute paths. The argument order also flips: Modal's `write_text(data, remote_path)` becomes Tenki's `write_text(path, data)`. From `verify.py`:

```python
        sb.fs.write_text("migrate.txt", "modal->tenki")
        back = sb.fs.read_text("migrate.txt")
```

Shell commands run with `exec` can still write anywhere in the sandbox.

### Disposal and lifetime

`sb.terminate()` maps 1:1 to Modal's `sb.terminate()`. `Sandbox` is also a context manager, so `with Sandbox.create(...) as sb:` disposes it for you when the block ends. Either way, the sandbox is billed per second, and it terminates itself when it reaches its lifetime cap. Set the cap with `max_duration`.

Don't map Modal's `idle_timeout` to Tenki's `idle_timeout_minutes`: the SDK accepts it but ignores it, and Tenki sandboxes don't auto-pause on idle. Use `max_duration`, or call `sb.pause()` yourself. Pausing is free, and a paused sandbox keeps its memory and disk.

## Check it works

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

On success it prints one line, where the part in parentheses is the first 8 characters of the sandbox ID:

```
✓ modal-to-tenki-migration: create (<id>…) → exec python3 + sh + fs round-trip → 42 → dispose
```

`verify.py` runs the whole loop against a live sandbox: create, `exec` a bare binary, `exec` a shell one-liner, a `sb.fs` file round-trip, and dispose. It asserts each result and exits non-zero with a `✗ <ErrorType>: <message>` line on any failure after the key check (a missing key prints the `No API key` line below). `verify.mjs` is a thin shim so the cookbook's Node CI harness can run the Python: it invokes `.venv/bin/python verify.py` if `.venv/bin/python` exists (otherwise `$PYTHON`, then `python3`) and exits with its status. This is what CI runs.

A pass proves your key works and the Tenki side of the port behaves as shown, with no Modal account and no model key. It doesn't run `run.py`, touch Modal, or exercise the API map's `env`, `cwd`, reconnect and list rows.

## Troubleshooting

**❌ ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` from `verify.py`, or `missing auth token: set TENKI_AUTH_TOKEN or TENKI_API_KEY` from `run.py`.** No key was found in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY` or `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY=tk_...` or run `tenki login --api-key <key>`.

**❌ `invalid auth token: expected an API key or service token starting with tk_`.** The key you passed isn't a Tenki API key, for example a Modal token ID. Create a `tk_` key at https://app.tenki.cloud and use that.

**❌ `permission_denied … path outside workdir` from `sb.fs`.** You passed an absolute path outside `/home/tenki`, which is easy to do when porting Modal code, since Modal's filesystem calls take absolute paths. Use a relative path, or write the file with a shell command through `exec`.

**❌ `$HOME`, a pipe or `&&` comes through literally.** `exec` runs the binary directly, with no shell. Wrap the command: `sb.exec("sh", "-c", "…")`.

## FAQ

**When shouldn't I use this?**
When your Modal code depends on reading a command's output while it runs: Tenki's `exec` returns only after the command finishes, so you'd port to `sb.start(...)` instead, which this example doesn't cover. When you rely on Modal's `idle_timeout`: Tenki ignores `idle_timeout_minutes` and doesn't auto-pause idle sandboxes, so bound the sandbox with `max_duration` instead. When you're on Python older than 3.10, which the `tenki` SDK requires. And when you need more than the sandbox loop: this example covers create, `exec`, file read and write, and dispose, and nothing more.

**Do I need a Modal account or the `modal` package?**
No. `requirements.txt` installs only `tenki`, and the Modal code lives in docstrings and comments.

**Do I need a workspace ID?**
No. Tenki infers the workspace from your API key, and `tenki login` stores only the key. `run.py` and `verify.py` pass `workspace_id` only if they find one, in `TENKI_WORKSPACE_ID` or in a `current_workspace_id` line in `~/.config/tenki/config.yaml`; otherwise the key's workspace is used.

**Is outbound network on?**
Yes, as on Modal. The Python SDK defaults to `allow_outbound=True`. Pass `create(..., allow_outbound=False)` to lock a sandbox down.

**Why is there a `verify.mjs` in a Python example?**
The rest of the cookbook is Node, and CI runs every example's verify script on Node 20 and Python 3.12 with only `TENKI_API_KEY` set. `verify.mjs` hands off to `verify.py`, the same pattern as [`run-code-python`](../run-code-python/) and [`crewai-code-interpreter`](../crewai-code-interpreter/).

## Related

- [`tenki` Python SDK docs](https://tenki.cloud/docs/sandbox/sdk), the package on [PyPI](https://pypi.org/project/tenki/), and its source at [LuxorLabs/tenki-sdk-python](https://github.com/LuxorLabs/tenki-sdk-python)
- [Tenki docs](https://tenki.cloud/docs) and [tenki.cloud](https://tenki.cloud)
- [Modal `Sandbox` reference](https://modal.com/docs/sdk/py/latest/Sandbox)
- [`e2b-to-tenki-migration`](../e2b-to-tenki-migration/) and [`daytona-to-tenki-migration`](../daytona-to-tenki-migration/): the same port from E2B and Daytona, in Node
