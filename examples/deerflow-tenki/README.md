# DeerFlow

Run [DeerFlow](https://github.com/bytedance/deer-flow)'s agent sandboxes on Tenki. DeerFlow, ByteDance's open-source SuperAgent harness, ships a Tenki sandbox provider, `deerflow.community.tenki`, so each agent thread's commands and files run in its own Tenki sandbox. This folder holds a check of the Tenki side, not DeerFlow itself.

## Quick start

You need:

- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- [uv](https://docs.astral.sh/uv/).
- For DeerFlow: Python 3.12 or later, Node.js 22 or later, pnpm, nginx, and an LLM provider key. DeerFlow's `make check` confirms these.

### 1. Install DeerFlow with the Tenki extra

```bash
git clone https://github.com/bytedance/deer-flow && cd deer-flow
make setup
cd backend && uv sync --all-packages --extra tenki && cd ..
```

`make setup` is DeerFlow's wizard: it has you pick an LLM provider and writes `config.yaml` and `.env` at the repo root. The `tenki` extra lives on the `deerflow-harness` workspace package, so `--all-packages` is required. If you run `make install`, run the `uv sync` line again afterwards, because `make install` removes the extra.

### 2. Set your API key

Add it to DeerFlow's repo-root `.env`, which `make dev` loads, or export it:

```bash
export TENKI_API_KEY=tk_...
```

### 3. Point DeerFlow's sandbox at Tenki

Set the `sandbox:` block in `config.yaml`:

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

If your key sees more than one workspace, also set `workspace_id`. The provider lists the IDs when it can't pick one.

### 4. Run

```bash
UV_EXTRAS=tenki make dev
```

`make dev` re-syncs the backend on every start and doesn't detect the Tenki extra, so `UV_EXTRAS=tenki` keeps the SDK installed. You can put it in `.env` instead. Setting `UV_EXTRAS` turns off DeerFlow's extra detection, so list all the extras you use, for example `UV_EXTRAS=postgres,tenki`.

Open http://localhost:2026 and start a thread that runs code. `logs/gateway.log` shows `Created Tenki sandbox <id> (name=deer-flow-tenki-<id>)`, and after the turn, `Released Tenki sandbox <id> to warm pool (sandbox still running)`.

### 5. Verify the Tenki side

This folder's check exercises the SDK calls the provider makes, against a live sandbox, without DeerFlow or a model key:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/deerflow-tenki
uv venv && uv pip install -r requirements.txt   # tenki>=1.4.1
node verify.mjs        # or: .venv/bin/python verify.py
```

```
✓ deerflow-tenki: create+wait_ready → sh -lc (deer 42) → fs streaming round-trip → find/grep → terminate
```

`verify.py` creates a sandbox with `wait=False` then `wait_ready()`, runs a command under `sh -lc`, round-trips a file through the `sandbox.fs` streaming API, runs `find` and `grep`, and terminates the sandbox in a `finally` block. It reads `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or a `tenki login` key. The provider's own tests, including path mapping and the warm pool, are upstream in [`test_tenki_provider.py`](https://github.com/bytedance/deer-flow/blob/main/backend/tests/test_tenki_provider.py).

## Provider settings

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

`sandbox.bash_command_timeout` (default 600 seconds) is the per-command deadline. The full template is DeerFlow's [`config.example.yaml`](https://github.com/bytedance/deer-flow/blob/main/config.example.yaml).

## How the provider works

- It implements DeerFlow's full `Sandbox` contract (`execute_command`, `read_file`, `write_file`, `update_file`, `download_file`, `list_dir`, `glob`, `grep`) on one Tenki sandbox per user and thread. Threads never share a sandbox.
- Sandboxes run as the unprivileged `tenki` user, so `/mnt/user-data` maps to `home_dir`. The provider also tries to symlink the path with `sudo` so shell commands that use it work.
- File reads, writes, and downloads use the `sandbox.fs` streaming API, so binary and Unicode content survive. `download_file` serves only `/mnt/user-data` and stops at 100 MB.
- Each command is a fresh `sh -lc`, so a `cd` or exported variable doesn't carry over. Commands aren't retried after a transport error.
- After each turn the sandbox stays running in an in-process warm pool. The same thread reclaims it after an `echo ok` health check. At the `replicas` cap the oldest warm sandbox is evicted, and the gateway's reaper terminates sandboxes idle past `idle_timeout`.
- Every sandbox carries `max_duration` server-side, so one left behind by a crashed gateway still stops. The pool doesn't survive a gateway restart.
- It uses only create, terminate, exec, and the filesystem API, so any base image works. There are no preview URLs, snapshots, or volumes yet.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` | `verify.py` found no key. Export one or run `tenki login`. |
| `ModuleNotFoundError: No module named 'tenki'` from `node verify.mjs` | Create the `.venv` in this folder and install `requirements.txt`. |
| `uv sync --extra tenki` fails with an unknown extra | Add `--all-packages`. |
| `ImportError: TenkiSandboxProvider requires the optional 'tenki' dependency …` | A re-sync removed it. Run `uv sync --all-packages --extra tenki` in `backend/` and start with `UV_EXTRAS=tenki make dev`. |
| `ValueError: Could not auto-select a Tenki workspace …` | Set `workspace_id` in the `sandbox:` block to one of the listed IDs. |
| `sandbox.project_id is ignored: Tenki 1.x removed projects.` | Delete `project_id` from `config.yaml`. |
| `Error: command timed out` with `Exit Code: 124` | Raise `bash_command_timeout`, or run long processes in the background. |

## Related

- [DeerFlow](https://github.com/bytedance/deer-flow), [deer-flow#4382](https://github.com/bytedance/deer-flow/pull/4382) (the PR that added the provider), and the provider's [README](https://github.com/bytedance/deer-flow/blob/main/backend/packages/harness/deerflow/community/tenki/README.md)
- [Run code with Python](../run-code-python/): the same `tenki` SDK loop on its own
- [Tenki docs](https://tenki.cloud/docs)
