# Migrate from Modal to Tenki

Already running sandboxes on [Modal](https://modal.com)? Moving the sandbox loop to [Tenki](https://tenki.cloud) is a small, mechanical change. Both give you a disposable cloud sandbox with the same core loop — **create → run a command → capture output → dispose** — so most scripts port in a few minutes with the official [`tenki-sandbox`](https://tenki.cloud/docs/sandbox/sdk) Python SDK.

This example shows the two scripts side by side, an API map, and a `run.py` (plus a CI-runnable `verify.py`) you can run against live Tenki.

## The core loop, side by side

**Modal** (`modal`):

```python
import modal

# Everything hangs off an App; lookup() creates it if missing. Auth via ~/.modal.toml.
app = modal.App.lookup("my-sandbox-app", create_if_missing=True)

sb = modal.Sandbox.create(app=app)              # boots a container
p = sb.exec("python", "-c", "print(6 * 7)")     # returns a *live* process
out = p.stdout.read()                           # drain the stream → "42\n"
print(out.strip(), "· exit", p.wait())          # 42 · exit 0  (wait() returns the code)
sb.terminate()
```

**Tenki** (`tenki-sandbox`):

```python
from tenki_sandbox import Sandbox

# No App object — a sandbox is placed by workspace_id. `with` disposes it.
with Sandbox.create(
    auth_token=token,          # from `tenki login` (see the auth note below)
    workspace_id=workspace_id,
    cpu_cores=1,
    memory_mb=1024,
) as sb:
    # exec() blocks until the command finishes and returns a CommandResult —
    # no live process to drain, no wait() to call.
    r = sb.exec("python3", "-c", "print(6 * 7)")
    print(r.stdout_text.strip(), "· exit", r.exit_code)  # 42 · exit 0
```

## API map

| Concept | Modal (`modal`) | Tenki (`tenki-sandbox`) |
| --- | --- | --- |
| Install | `pip install modal` | `pip install tenki-sandbox` |
| Import | `import modal` | `from tenki_sandbox import Sandbox` |
| Auth | `modal token new` (writes `~/.modal.toml`), or `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET` | `Sandbox.create(auth_token=…)` + `workspace_id` (from `tenki login`) |
| App handle | `app = modal.App.lookup("name", create_if_missing=True)` (required first) | — none; placement is `workspace_id` |
| Create | `modal.Sandbox.create(app=app)` | `Sandbox.create(auth_token=…, workspace_id=…, cpu_cores=1, memory_mb=1024)` |
| Run a command | `p = sb.exec("python", "-c", "…")` → live process | `r = sb.exec("python3", "-c", "…")` → finished result |
| stdout / stderr | `p.stdout.read()` / `p.stderr.read()` (drain streams) | `r.stdout_text` / `r.stderr_text` (already captured) |
| Exit code | `p.wait()` (returns it) or `p.returncode` | `r.exit_code` |
| CPU / memory | `create(app=app, cpu=1, memory=1024)` | `create(…, cpu_cores=1, memory_mb=1024)` |
| Env vars | `sb.exec(cmd, env={…})` | `sb.exec(cmd, env={…})` |
| Working dir | `sb.exec(cmd, workdir="…")` | `sb.exec(cmd, cwd="…")` |
| Write a file | `with sb.open(path, "w") as f: f.write(data)` | `sb.fs.write_text(path, data)` |
| Read a file | `with sb.open(path) as f: f.read()` | `sb.fs.read_text(path)` |
| Sandbox ID | `sb.object_id` | `sb.id` |
| Reconnect | `modal.Sandbox.from_id(id)` | `Client(auth_token=…).get(id)` |
| List sandboxes | `modal.Sandbox.list(app_id=…)` | `Client(auth_token=…).list()` |
| Networking | on by default; `create(block_network=True)` to disable | on by default; `create(allow_outbound=False)` to disable |
| Dispose | `sb.terminate()` | `sb.terminate()` (or `with` auto-disposes) |

## The one gotcha: `exec` returns a result, not a live process

This is the change that bites most on a Modal port. Modal's `sb.exec(...)` hands you a **`ContainerProcess`** you drive yourself: drain `p.stdout.read()`, then call `p.wait()` (or read `p.returncode`) for the exit code. Tenki's `sb.exec(...)` **blocks until the command finishes** and returns a **`CommandResult`** with `.stdout_text`, `.stderr_text`, and `.exit_code` already populated. So the Modal stream-then-wait dance collapses to one line:

```python
# Modal — a live process: drain the stream, then wait for the code
p = sb.exec("python", "-c", "print(6 * 7)")
out  = p.stdout.read()     # "42\n"
code = p.wait()            # 0

# Tenki — a finished result, nothing to drain
r = sb.exec("python3", "-c", "print(6 * 7)")
out, code = r.stdout_text, r.exit_code   # "42\n", 0
```

What *doesn't* change: both run a **bare binary + its args** — no shell. `sb.exec("echo", "$HOME")` prints a literal `$HOME` on either platform. For shell syntax (pipes, `&&`, globs), ask for a shell explicitly — same on both:

```python
sb.exec("sh", "-c", "echo $HOME && ls /tmp")
```

## Setup (Python 3.10+)

```bash
uv venv --python 3.12                      # or: python3.11 -m venv .venv
uv pip install -r requirements.txt         # just tenki-sandbox
export TENKI_AUTH_TOKEN=...                 # see the auth note below
```

## Run it

```bash
python run.py                              # 42 · exit 0
```

`run.py` falls back to `~/.config/tenki/config.yaml` (written by `tenki login`) for the token and workspace, so with the CLI logged in you can just run it.

**Auth note.** Modal authenticates from `~/.modal.toml` (or `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET`) implicitly; Tenki takes an explicit `auth_token` plus a `workspace_id` for placement. The Python SDK authenticates cleanly with a **`tk_` API key** (`export TENKI_AUTH_TOKEN=tk_…`). A `tenki login` browser session token also works, but — unlike the Node SDK — the Python SDK won't auto-detect it; it must be sent as a cookie, so pass it as **`cookie:<token>`** (`run.py` and `verify.py` add that prefix for you). It's an SDK gap, not yours.

## Verify it

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

`verify.py` runs the whole loop against a live sandbox — create → `exec` a bare binary and a shell one-liner → a `sb.fs` file round-trip → assert each result → dispose — proving the Tenki-facing path with no model key, and exiting non-zero on any failure. `verify.mjs` is a thin shim so the cookbook's Node CI harness can run the Python: it invokes `.venv/bin/python verify.py` (falling back to `python3`) and exits with its status. This is what CI runs.

```bash
node verify.mjs   # ✓ create → exec python3 + sh + fs round-trip → 42 → dispose
```

## Notes

- **No `App` object.** Modal ties every sandbox to a `modal.App` (`modal.App.lookup(...)` first). Tenki has no app concept — a sandbox is placed directly by `workspace_id` (from `tenki login`).
- **`exec` blocks and returns a result.** Modal's `ContainerProcess` (drain `p.stdout.read()`, `p.wait()`) becomes Tenki's `CommandResult` (`r.stdout_text`, `r.exit_code`) — see the gotcha above.
- **Disposal.** `sb.terminate()` maps 1:1 to Modal's `sandbox.terminate()`. Because `Sandbox` is a context manager, `with Sandbox.create(...) as sb:` disposes it for you at scope end. Either way the microVM is billed per second and self-reaps on its idle / lifetime caps.
- **Networking is on by default** in the Python SDK (`allow_outbound=True`), matching Modal's default. Pass `create(..., allow_outbound=False)` to lock a sandbox down.
- Tenki confines file I/O to `/home/tenki` — write to relative paths.
- Requires **Python 3.10+**; the rest of the cookbook is Node, so this example is verified via the `verify.mjs` → `verify.py` shim (the same pattern as [`run-code-python`](../run-code-python/) and [`crewai-code-interpreter`](../crewai-code-interpreter/)).

Built with the official [`tenki-sandbox`](https://tenki.cloud/docs/sandbox/sdk) SDK. Learn more at [tenki.cloud](https://tenki.cloud).
