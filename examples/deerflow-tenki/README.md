# DeerFlow

Have DeerFlow run the code its agents write on Tenki cloud machines instead of the server DeerFlow runs on.

[DeerFlow](https://github.com/bytedance/deer-flow) is ByteDance's open-source agent app. You chat with it in a browser, and its agents plan multi-step tasks, research, and write and run code. Each conversation is a **thread**, and each thread gets a **sandbox**: the machine where the agent's commands run and its files live.

DeerFlow ships a Tenki **sandbox provider**, `deerflow.community.tenki`, so each thread's sandbox is its own Tenki VM. The steps below install DeerFlow and switch it to Tenki. This folder's `verify.py` is a quicker check that your Tenki key works and the provider's Tenki calls succeed, without installing DeerFlow.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up DeerFlow to run its agent sandboxes on Tenki, following https://github.com/LuxorLabs/cookbook/tree/main/examples/deerflow-tenki.
1. Clone https://github.com/bytedance/deer-flow (or use my existing checkout) and run make check. Ask me to run make setup myself, since it is an interactive wizard that asks for an LLM provider.
2. In backend/, run uv sync --all-packages --extra tenki.
3. DeerFlow needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud). If it isn't in my environment or DeerFlow's .env, stop and ask me to add it. Never print the key or write it to a file yourself.
4. Set the sandbox: block in config.yaml to the Tenki provider exactly as in the README, then start DeerFlow with UV_EXTRAS=tenki make dev.
5. Tell me to open http://localhost:2026 and start a thread that runs code, then check logs/gateway.log for "Created Tenki sandbox".
6. If a step fails, use the Troubleshooting table in the example's README.md.
```

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

`make setup` is DeerFlow's setup wizard: it has you pick an LLM provider and writes `config.yaml` and `.env` at the repo root. The `uv sync` line adds the Tenki SDK (the optional `tenki` extra). That extra belongs to one of several Python packages in DeerFlow's backend, so `--all-packages` is required. If you run `make install`, run the `uv sync` line again afterwards, because `make install` removes the extra.

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
  replicas: 3          # most sandboxes kept at once, in use or waiting for reuse
  idle_timeout: 600    # seconds an unused sandbox is kept before it's deleted
  max_duration: 14400  # Tenki deletes every sandbox after this many seconds, no matter what
  sticky: false
```

If your key sees more than one workspace, also set `workspace_id`. The provider lists the IDs when it can't pick one.

### 4. Run

```bash
UV_EXTRAS=tenki make dev
```

`make dev` reinstalls the backend's packages on every start and doesn't know about the Tenki extra, so `UV_EXTRAS=tenki` tells it to keep the Tenki SDK. You can put it in `.env` instead. Setting `UV_EXTRAS` turns off DeerFlow's extra detection, so list all the extras you use, for example `UV_EXTRAS=postgres,tenki`.

Open http://localhost:2026 and start a thread that runs code. DeerFlow's log, `logs/gateway.log`, shows `Created Tenki sandbox <id> (name=deer-flow-tenki-<id>)`. After the agent's reply, it shows `Released Tenki sandbox <id> to warm pool (sandbox still running)`: the sandbox is kept running for a while so the thread's next message can reuse it.

### 5. Verify

This folder's check makes the same Tenki calls the provider makes, against a live sandbox, without DeerFlow or a model key:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/deerflow-tenki
uv venv && uv pip install -r requirements.txt   # tenki>=1.4.1
node verify.mjs        # or: .venv/bin/python verify.py
```

```
✓ deerflow-tenki: create+wait_ready → sh -lc (deer 42) → fs streaming round-trip → find/grep → terminate
```

`verify.py` creates a sandbox and waits for it to start, runs a command through `sh -lc`, writes a file and reads it back with Tenki's file API (`sandbox.fs`), runs `find` and `grep`, and deletes the sandbox even if a step fails. It reads `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or a `tenki login` key. The provider's own tests, including path mapping and the warm pool, are upstream in [`test_tenki_provider.py`](https://github.com/bytedance/deer-flow/blob/main/backend/tests/test_tenki_provider.py).

## Provider settings

| Key | Default | What it does |
| --- | --- | --- |
| `use` | | `deerflow.community.tenki:TenkiSandboxProvider` selects the provider |
| `api_key` | `TENKI_API_KEY` / `TENKI_AUTH_TOKEN` env | Tenki `tk_` API key |
| `workspace_id` | auto-selected | Needed only when your key sees more than one workspace |
| `base_url` | SDK default | Tenki API endpoint |
| `image` | Tenki account default base image | Base image for every sandbox |
| `cpu_cores`, `memory_mb` | not sent | Per-sandbox vCPUs and memory |
| `replicas` | `3` | Most sandboxes kept at once, in use or waiting for reuse (a soft limit, per DeerFlow server process) |
| `idle_timeout` | `600` | Seconds an unused sandbox is kept for reuse before it's deleted; `0` disables |
| `max_duration` | `14400` (4 hours) | Server-side lifetime cap in seconds; `0` uses the Tenki account default |
| `sticky` | `false` | Pins the sandbox to its host, which only matters with pause/resume. Accepts an env reference such as `$TENKI_STICKY` and the strings `true`/`1`/`on`/`yes` or `false`/`0`/`off`/`no` |
| `home_dir` | `/home/tenki` | Writable directory that backs `/mnt/user-data` |
| `environment` | none | Map injected into every command and into the sandbox at create time. Keys must be valid POSIX variable names; the provider rejects others when it loads its config |

`sandbox.bash_command_timeout` (default 600 seconds) is the per-command deadline. The full template is DeerFlow's [`config.example.yaml`](https://github.com/bytedance/deer-flow/blob/main/config.example.yaml).

## How the provider works

- It supports every sandbox operation DeerFlow's agents use (`execute_command`, `read_file`, `write_file`, `update_file`, `download_file`, `list_dir`, `glob`, `grep`), on one Tenki sandbox per user and thread. Threads never share a sandbox.
- Sandboxes run as the unprivileged `tenki` user, so `/mnt/user-data` maps to `home_dir`. The provider also tries to symlink the path with `sudo` so shell commands that use it work.
- File reads, writes, and downloads use Tenki's file API (`sandbox.fs`), so binary and non-English text come through intact. `download_file` serves only `/mnt/user-data` and stops at 100 MB.
- Each command runs in a new `sh -lc`, so a `cd` or exported variable doesn't carry over to the next command. Commands aren't retried if the connection drops.
- After each reply the sandbox keeps running in a **warm pool**, a list of idle sandboxes kept in memory for reuse. The thread's next message gets the same sandbox back after a quick `echo ok` check. When the pool reaches `replicas`, the oldest idle sandbox is deleted, and sandboxes idle longer than `idle_timeout` are deleted too.
- Tenki enforces `max_duration` itself, so a sandbox left behind by a crashed DeerFlow server still stops. The warm pool is lost if DeerFlow restarts.
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
