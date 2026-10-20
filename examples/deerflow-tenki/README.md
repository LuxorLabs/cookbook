# How to run DeerFlow's sandboxes on Tenki

`node verify.mjs` prints a `✓` line from a live Tenki sandbox. With DeerFlow's `config.yaml` selecting the Tenki provider, each agent thread's commands and files run in its own Tenki sandbox.

About 5 minutes for the Tenki check in this folder, which itself runs in a few seconds. DeerFlow's own setup comes on top: its setup wizard takes about 2 minutes, plus its dependency install.

This folder does not contain DeerFlow. The Tenki provider ships inside DeerFlow. `verify.py` exercises the Tenki SDK surface the provider is built on, against a live sandbox, without installing DeerFlow. A passing check means your key and the Tenki side work.

[DeerFlow](https://github.com/bytedance/deer-flow), ByteDance's open-source SuperAgent harness, runs the code its agents write inside pluggable sandboxes. Since [deer-flow#4382](https://github.com/bytedance/deer-flow/pull/4382), Tenki ships as a community-supported sandbox provider, `deerflow.community.tenki`, alongside providers such as E2B and AIO. If your team already runs agent infrastructure on [Tenki](https://tenki.cloud) sandboxes, you can point DeerFlow at that same Tenki workspace instead of provisioning a parallel sandbox vendor.

## Prerequisites

- A Tenki `tk_` API key. Create one at https://app.tenki.cloud.
- `uv`, and Python 3.10 or newer for the check (the `tenki` package requires it).
- Node, only to run the verify shim (`node verify.mjs`). You can run `verify.py` with Python instead.
- For DeerFlow itself: its backend needs Python 3.12 or newer, its `make check` verifies Node.js 22+, pnpm, uv and nginx, and it needs an LLM provider, which its `make setup` wizard configures.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/deerflow-tenki
```

Steps 2 to 4 run from this directory. Step 5 leaves it to clone DeerFlow next to the cookbook, and Steps 5 to 7 run in that DeerFlow checkout.

## Step 2 — Install the check's dependencies

```bash
uv venv && uv pip install -r requirements.txt
```

`requirements.txt` is one line, the Tenki Python SDK:

```
tenki>=1.4.1
```

## Step 3 — Authenticate

```bash
export TENKI_API_KEY=tk_...
```

Or store the key once with `tenki login --api-key <key>`, which writes it to `~/.config/tenki/config.yaml`. `verify.py` uses the first key it finds in `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then that file.

You don't need a workspace ID: Tenki infers the workspace from a workspace API key. Set `TENKI_WORKSPACE_ID` only to pin the check to one workspace. DeerFlow's provider gets its key and workspace separately, in Step 6.

## Step 4 — Check it works

```bash
node verify.mjs        # or: .venv/bin/python verify.py
```

`verify.mjs` is a shim for the cookbook's Node harness. It runs `verify.py` with `.venv/bin/python` if that exists, else `$PYTHON` or `python3`. On success it prints:

```
✓ deerflow-tenki: create+wait_ready → sh -lc (deer 42) → fs streaming round-trip → find/grep → terminate
```

From [`verify.py`](verify.py):

```python
opts = {"auth_token": token, "cpu_cores": 1, "memory_mb": 1024, "wait": False}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    opts["workspace_id"] = workspace_id

sb = None
error = None
try:
    sb = Sandbox.create(**opts)
    sb.wait_ready()

    r = sb.exec("sh", "-lc", 'echo "deer $(python3 -c \'print(6*7)\')"')
    out = r.stdout_text.strip()
    if not (r.ok and out == "deer 42"):
        raise AssertionError(f"exec: ok={r.ok}, stdout={out!r}, stderr={r.stderr_text!r}")

    sb.fs.mkdir("/home/tenki/reports")
    sb.fs.write_stream("/home/tenki/reports/note.md", iter([b"# from deerflow\n"]))
    if sb.fs.read_text("/home/tenki/reports/note.md") != "# from deerflow\n":
        raise AssertionError("fs round-trip mismatch")
    if sb.fs.stat("/home/tenki/reports/note.md").size == 0:
        raise AssertionError("fs.stat reports empty file")

    r = sb.exec("sh", "-lc", "find /home/tenki/reports -name '*.md' | xargs grep -l deerflow")
    if "note.md" not in r.stdout_text:
        raise AssertionError(f"find/grep: {r.stdout_text!r}")
```

Each step matches how the provider uses Tenki. It creates with `wait=False` and then calls `wait_ready()`, which is how the provider boots every sandbox, so a sandbox that never becomes ready is still in hand to terminate. It runs a command under `sh -lc`, as the provider runs every command. It round-trips a file through Tenki's native `sandbox.fs` streaming API (`mkdir`, `write_stream`, `read_text`, `stat`), which the provider uses for file transport. It runs busybox-portable `find` and `grep`, which the provider uses for `glob` and `grep`. A `finally` block then terminates the sandbox, even when a check fails.

It doesn't test anything on the DeerFlow side: it never imports DeerFlow, needs no model key, and doesn't exercise path mapping, the warm pool or eviction. The provider's upstream test suite, [`backend/tests/test_tenki_provider.py`](https://github.com/bytedance/deer-flow/blob/main/backend/tests/test_tenki_provider.py), covers those, and its `test_integration_real_sandbox` runs against a live sandbox when `TENKI_API_KEY` is set.

## Step 5 — Install DeerFlow with the Tenki extra

```bash
cd ../../..
git clone https://github.com/bytedance/deer-flow && cd deer-flow
make setup
cd backend && uv sync --all-packages --extra tenki
```

`cd ../../..` leaves the cookbook checkout, so DeerFlow isn't cloned inside it. `make setup` is DeerFlow's interactive setup wizard: it has you choose an LLM provider and writes `config.yaml` and `.env` at the DeerFlow repo root, in about 2 minutes per DeerFlow's [README](https://github.com/bytedance/deer-flow#readme). `make dev` won't start without a `config.yaml`; it exits with `✗ No DeerFlow config file found.`

If you already have a DeerFlow checkout with a `config.yaml`, run only the `uv sync` line, in its `backend/` directory.

The provider's Tenki SDK dependency is an optional extra (`tenki>=1.4.0`). It isn't installed by default, and the provider imports it lazily, only when `sandbox.use` selects it, so DeerFlow behaves as before until you do. `--all-packages` matters: the `tenki` extra lives on the `deerflow-harness` workspace package, so a bare `uv sync --extra tenki` fails with an unknown-extra error.

**DeerFlow's own scripts can remove the extra.** `make install` runs `uv sync --locked` in `backend/`, which uninstalls it, so run the sync above after `make install`, not before. `make dev` re-syncs on every start, and Step 7 covers that.

## Step 6 — Point DeerFlow's sandbox at Tenki

Open the `config.yaml` that `make setup` wrote at the DeerFlow repo root, which is where DeerFlow reads it. Set its `sandbox:` block to the Tenki provider:

```yaml
sandbox:
  use: deerflow.community.tenki:TenkiSandboxProvider
  api_key: $TENKI_API_KEY
  cpu_cores: 2
  memory_mb: 2048
  replicas: 3          # active + warm sandbox cap per gateway process
  idle_timeout: 600    # seconds before an idle sandbox is evicted
  max_duration: 14400  # hard server-side lifetime cap
  sticky: false
```

`$TENKI_API_KEY` resolves from the environment DeerFlow runs in, so export it, or put it in the repo-root `.env`, which `make dev` loads. If you leave `api_key` out, the SDK falls back to the `TENKI_API_KEY` or `TENKI_AUTH_TOKEN` environment variable.

**Workspace:** with no `workspace_id` set, the provider looks up the workspaces your key can see and uses the only one. If it finds more than one, it raises when it creates its first sandbox and lists the choices. In that case, set `workspace_id` in the `sandbox:` block to one of the listed IDs.

The provider's keys (see [`config.example.yaml`](https://github.com/bytedance/deer-flow/blob/main/config.example.yaml) upstream for the full template):

| Key | Default | What it does |
| --- | --- | --- |
| `use` | | `deerflow.community.tenki:TenkiSandboxProvider` selects the provider |
| `api_key` | `TENKI_API_KEY` / `TENKI_AUTH_TOKEN` env | Tenki `tk_` API key |
| `workspace_id` | auto-selected | Needed only when your key sees more than one workspace |
| `base_url` | SDK default | Tenki API endpoint |
| `image` | Tenki account default base image | Base image for every sandbox |
| `cpu_cores`, `memory_mb` | not sent | Per-sandbox vCPUs and memory |
| `replicas` | `3` | Soft cap on active plus warm sandboxes per gateway process |
| `idle_timeout` | `600` | Seconds before the provider terminates an unused warm sandbox; `0` disables |
| `max_duration` | `14400` (4 hours) | Server-side lifetime cap in seconds; `0` uses the Tenki account default |
| `sticky` | `false` | Pins the sandbox to its host, which only matters with pause/resume. Accepts an env reference such as `$TENKI_STICKY` and the strings `true`/`1`/`on`/`yes` or `false`/`0`/`off`/`no` |
| `home_dir` | `/home/tenki` | Writable directory that backs `/mnt/user-data` |
| `environment` | none | Map injected into every command and into the sandbox at create time. Keys must be valid POSIX variable names; the provider rejects others when it loads its config |

`sandbox.bash_command_timeout` (default 600 seconds) also applies: it's the per-command deadline the provider passes to Tenki.

## Step 7 — Start DeerFlow

From the DeerFlow repo root (`cd ..` if you're still in `backend/` from Step 5):

```bash
UV_EXTRAS=tenki make dev
```

`make dev` re-syncs the backend on every start with only the extras named in `UV_EXTRAS` or detected from `config.yaml`, and the detector doesn't map the Tenki provider to its extra. Without `UV_EXTRAS=tenki`, a start removes the SDK again. You can put `UV_EXTRAS=tenki` in the repo-root `.env` instead.

**Setting `UV_EXTRAS` turns off DeerFlow's detection from `config.yaml`.** If you use other extras, list them all, for example `UV_EXTRAS=postgres,tenki`.

DeerFlow serves at http://localhost:2026. Under `make dev`, the gateway's output goes to `logs/gateway.log` at the DeerFlow repo root, not to your terminal. When an agent thread first gets its sandbox, the provider creates a sandbox named `deer-flow-tenki-<id>` and logs `Created Tenki sandbox <id> (name=deer-flow-tenki-<id>)` there at INFO level. After the turn it logs `Released Tenki sandbox <id> to warm pool (sandbox still running)`.

## What the provider does

- The full DeerFlow `Sandbox` contract: `execute_command`, `read_file`, `write_file` (including append), `update_file`, `download_file`, `list_dir`, `glob` and `grep`, mapped onto one Tenki sandbox per user and thread.
- Virtual path mapping: Tenki sandboxes run as the unprivileged `tenki` user and `/mnt` is root-owned, so DeerFlow's `/mnt/user-data` namespace translates to `home_dir` on the way in and back to `/mnt/user-data` on the way out. At create time the provider also tries to symlink `/mnt/user-data` to `home_dir` with `sudo`, so shell commands that use the literal path work too. Without `sudo`, the file tools still work through the remap.
- Native file transport: reads, writes and downloads use Tenki's `sandbox.fs` streaming API rather than shell pipes, so binary and Unicode content survive untouched. `download_file` serves only paths under `/mnt/user-data` and stops at 100 MB, counted on the bytes actually received.
- Shell semantics: each command is a fresh `sh -lc` exec, so no shell state, such as a `cd` or an exported variable, carries over to the next command. `list_dir`, `glob` and `grep` delegate to busybox-portable `find` and `grep` inside the VM.
- No automatic retries: a command isn't re-run after a transport error, because it may already have run and re-running could double its side effects.
- Warm-pool lifecycle: after each agent turn the sandbox goes into an in-process warm pool, still running. The same user and thread reclaim it on the next turn after an `echo ok` health check, and a failed check replaces it. When active plus warm sandboxes reach `replicas`, the oldest warm one is evicted; active ones never are. `idle_timeout` is enforced by the provider's own reaper thread in the gateway, not by Tenki. A terminal session error or a dropped connection evicts the sandbox rather than poisoning the pool, including during a download, and the next acquire builds a new one.
- Lifetime cap: every sandbox carries `max_duration` server-side, so a long research thread doesn't lose its sandbox to a shorter default lifetime, and a sandbox left behind by a crashed gateway still stops at the cap.
- Stable surface only: sandbox create and terminate, exec and the filesystem API. Volumes, snapshots and template builds aren't used, so any stock base image works.

## Troubleshooting

**❌ ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.``** `verify.py` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY` or `~/.config/tenki/config.yaml`. Create a `tk_` key at https://app.tenki.cloud and export it, or store it with `tenki login --api-key <key>`.

**❌ `ModuleNotFoundError: No module named 'tenki'` from `node verify.mjs`.** There's no `.venv` in `examples/deerflow-tenki` (Step 2 was skipped or ran elsewhere), so `verify.mjs` fell back to `$PYTHON` or `python3`, which doesn't have the SDK. Run Step 2 in that folder.

**❌ `uv sync --extra tenki` fails with an unknown-extra error.** The `tenki` extra lives on the `deerflow-harness` workspace package, not on the backend's root project. Add `--all-packages`.

**❌ `ImportError: TenkiSandboxProvider requires the optional 'tenki' dependency …`.** DeerFlow's backend environment doesn't have the Tenki SDK, usually because `make install` or a `make dev` start without `UV_EXTRAS=tenki` re-synced it away. Run `uv sync --all-packages --extra tenki` in `backend/` again, and start DeerFlow as in Step 7.

**❌ `ValueError: Could not auto-select a Tenki workspace; set sandbox.workspace_id in config.yaml. Found: [...]`.** No `workspace_id` is set, and your key doesn't see exactly one workspace. The message lists each workspace's ID and name. Set `workspace_id` in the `sandbox:` block to one of them.

**❌ Warning: `sandbox.project_id is ignored: Tenki 1.x removed projects.`** Your `config.yaml` still has a `project_id` key. Tenki scopes sandboxes by workspace alone. Delete the key, and set `workspace_id` if your key sees more than one workspace.

**❌ A tool result ends with `Error: command timed out` and `Exit Code: 124`.** The command ran past `sandbox.bash_command_timeout` (default 600 seconds). Its output up to that point is kept, it isn't retried, and the sandbox stays usable. Raise `bash_command_timeout`, or start long-running processes in the background with their output redirected.

## FAQ

**When shouldn't I use this?**
When sandboxes must survive a gateway restart: the warm pool lives in the gateway process, and the provider doesn't adopt sandboxes a previous process left behind (upstream lists cross-process orphan reconciliation as a follow-up), so those keep running until `max_duration`. When your agents need preview URLs for servers they start, since the provider has no preview-URL surface yet. When you want DeerFlow to use Tenki snapshots, volumes or template builds, which the provider deliberately leaves out. When an agent depends on shell state persisting between commands. And when downloads can exceed 100 MB.

**Does a sandbox keep running between agent turns?**
Yes. A released sandbox stays running in the warm pool until the same thread reclaims it, `idle_timeout` passes, the `replicas` cap evicts it, the gateway shuts down, or it reaches `max_duration`. With `idle_timeout: 0`, nothing reaps it for being idle.

**Do threads share a sandbox?**
No. The provider derives each sandbox's ID from the user and thread, and only that user's thread reclaims it from the warm pool.

## Related

- [DeerFlow](https://github.com/bytedance/deer-flow), and [deer-flow#4382](https://github.com/bytedance/deer-flow/pull/4382), the PR that added the provider
- The provider's upstream [README](https://github.com/bytedance/deer-flow/blob/main/backend/packages/harness/deerflow/community/tenki/README.md)
- DeerFlow's [`config.example.yaml`](https://github.com/bytedance/deer-flow/blob/main/config.example.yaml), with every sandbox key
- [Tenki docs](https://tenki.cloud/docs)
- [`../run-code-python/`](../run-code-python/): the same `tenki` Python SDK loop on its own
- [`../files-in-a-sandbox/`](../files-in-a-sandbox/): the SDK's file API, in Node
