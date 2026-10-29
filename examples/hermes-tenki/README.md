# Hermes Agent

Run [Hermes Agent](https://github.com/NousResearch/hermes-agent)'s shell tool in a Tenki sandbox instead of on your machine. Hermes runs every shell command through a pluggable terminal backend. This example drives the Tenki backend, `TenkiEnvironment`, directly, with snapshot-and-restore sessions, so it needs a Tenki key and no model key.

> **Status:** the Tenki backend isn't in a Hermes release. This example pins it from the fork [`opencolin/hermes-tenki`](https://github.com/opencolin/hermes-tenki) at commit `2890bd3` ([opencolin/hermes-tenki#6](https://github.com/opencolin/hermes-tenki/pull/6)), which uses the `tenki` 1.x SDK. Upstream Hermes `main` has a plugin hook for terminal backends (`register_terminal_environment_provider`); once a release includes it, the backend can ship as a plugin.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Run Hermes Agent's Tenki terminal backend, following https://github.com/LuxorLabs/cookbook/tree/main/examples/hermes-tenki.
1. Clone https://github.com/LuxorLabs/cookbook, cd into examples/hermes-tenki, and check that Python is 3.11 or later.
2. Run ./setup.sh to fetch the pinned Hermes fork, then pip install -r requirements.txt (in a virtualenv).
3. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
4. Run python run.py and confirm session 2 reads back "notes from session one", then run node verify.mjs and confirm all 12 checks pass.
5. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Python 3.11 or later, and git.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/hermes-tenki
./setup.sh                        # fetch the pinned Hermes checkout into ./hermes-agent
pip install -r requirements.txt   # tenki, PyYAML, requests
```

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN also works
```

This example reads the key from the environment only.

### 3. Run

```bash
python run.py
```

`run.py` runs commands in a sandbox, ends the session, starts a new one with the same task ID, and reads back a file the first session wrote:

```
Session 1, sandbox 01a14663-…
$ uname -srm && whoami && pwd
  exit 0: Linux … x86_64
tenki
/home/tenki
$ python3 -c 'print(sum(range(100)))'
  exit 0: 4950
$ echo 'notes from session one' > notes.txt
  exit 0:

Session 2, sandbox 01a14664-…
$ cat notes.txt
  exit 0: notes from session one

Cleaning up
  deleted snapshot …
  deleted snapshot …
```

The two sandbox IDs differ: session 2 is a new VM restored from session 1's snapshot.

### 4. Verify

```bash
node verify.mjs      # or: python verify.py
```

It ends with:

```text
============================================================
OK: all 12 checks passed
```

`verify.mjs` runs `setup.sh` if `./hermes-agent` is missing, then `verify.py`, which makes 12 checks against live Tenki:

| Checks | What they cover |
|---|---|
| 1 | Hermes' `check_terminal_requirements()` accepts the `tenki` backend |
| 2–9 | An ephemeral session: cwd is `/home/tenki`; output, exit codes, and stderr come back; cwd carries across calls; stdin arrives byte for byte |
| 10 | `cleanup()` terminates the ephemeral VM |
| 11–12 | A persistent session snapshots on `cleanup()`, and a new session with the same `task_id` reads back the file |

It leaves no sandbox or snapshot behind.

## How the backend works

```python
from tools.environments.tenki import TenkiEnvironment

env = TenkiEnvironment(
    task_id="my-task",           # keys persistence: same task_id, same filesystem
    persistent_filesystem=True,  # cleanup() snapshots, then terminates
    cpu=1, memory=2048,          # memory in MB
    disk=10240,                  # MB; the backend rounds up to whole GB
    max_duration=600,            # hard cap on the VM's lifetime, in seconds
)
result = env.execute("echo hello")   # {"output": "hello\n", "returncode": 0}
env.cleanup()
```

- **Every `execute()` runs in the same VM.** The working directory carries across calls, exit codes and stderr come back, and stdin is piped byte for byte.
- **Ephemeral sessions** (`persistent_filesystem=False`) terminate the VM on `cleanup()`.
- **Persistent sessions** snapshot on `cleanup()`, wait until the snapshot is durable, record its ID in `$HERMES_HOME/tenki_snapshots.json`, and terminate the VM. The next session with the same `task_id` starts from that snapshot. If the snapshot fails, the VM is paused instead, so files aren't lost.
- **Sandboxes are tagged `hermes-agent`**, with `hermes_task_id` and a per-profile token in metadata, so two Hermes profiles never share sandboxes.
- **Your `~/.hermes` stays local** unless you turn on `tenki_sync_hermes_home`.

`run.py` and `verify.py` point `HERMES_HOME` at a temporary directory and finish with `teardown()`, which terminates the run's sandboxes and deletes its snapshots.

## Use it from Hermes

With a Hermes install that includes the backend (the fork, for now):

```yaml
# ~/.hermes/config.yaml
terminal:
  backend: "tenki"
  cwd: "/home/tenki"            # a path inside the sandbox
  container_persistent: false   # true = snapshot on cleanup, restore next session
  tenki_max_duration: 3600      # seconds
  tenki_allow_outbound: true
```

`TERMINAL_ENV=tenki` overrides the configured backend. All the `tenki_*` keys are in the fork's [`cli-config.yaml.example`](https://github.com/opencolin/hermes-tenki/blob/2890bd33bee044a7b219b825cca8e656f5f3493c/cli-config.yaml.example).

## Things to know

- A persistent session keeps no VM running between sessions. The snapshot is stored and billed until you delete it.
- When a restored session saves a new snapshot, the backend doesn't yet delete the old one ([opencolin/hermes-tenki#6](https://github.com/opencolin/hermes-tenki/pull/6) describes the fix).
- `pip install hermes-agent` (0.19.0) can't use Tenki: its backend list is fixed and has no plugin hook.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `No Hermes checkout with the Tenki backend at …` | Run `./setup.sh`, or set `HERMES_REPO` to a checkout of the fork. |
| `Feature 'terminal.tenki' unavailable: pip install failed … tenki-sandbox` | Your checkout predates `2890bd3`. Delete `./hermes-agent` and run `./setup.sh` again. |
| `Set TENKI_API_KEY (tk_...)` | Export `TENKI_API_KEY`. Inside Hermes, the backend also reads the `tenki login` key. |
| A persistent session starts empty | The task ID or Hermes profile changed. Restores match on both. |

## Files

| File | Purpose |
|---|---|
| `setup.sh` | Fetch the pinned Hermes fork into `./hermes-agent` |
| `requirements.txt` | The SDK plus the packages the backend imports |
| `hermes_env.py` | Puts the checkout on `sys.path`, isolates `HERMES_HOME`, and tears down sandboxes and snapshots |
| `run.py` | The two-session walkthrough |
| `verify.py`, `verify.mjs` | The 12 live checks, and the shim CI runs |

## Related

- [OpenHermit](../openhermit-tenki/): sticky per-agent sandboxes for an agent fleet
- [Pause, snapshot, and resume](../snapshots-pause-resume/): snapshots in the SDK directly
