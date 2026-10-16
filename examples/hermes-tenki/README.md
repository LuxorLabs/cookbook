# Hermes Agent on Tenki

Run [Hermes Agent](https://github.com/NousResearch/hermes-agent)'s shell tool inside a Tenki microVM instead of on your machine.

Hermes runs every shell command through a pluggable *terminal backend* (local, Docker, Modal, Daytona, SSH and others). This example drives the Tenki backend, `tools/environments/tenki.py`, directly: `TenkiEnvironment.execute()` is the call Hermes' terminal tool makes when `terminal.backend` is `tenki`. You need a `TENKI_API_KEY` and no model key, because this exercises the backend, not the agent loop.

> **Status: the backend isn't in a Hermes release.** Hermes 0.19.0 on PyPI has no Tenki backend, and the upstream PR that proposed one was closed. This example pins the backend from the fork [`opencolin/hermes-tenki`](https://github.com/opencolin/hermes-tenki) at commit `2890bd3` (branch `tenki-sdk-1.x`, [opencolin/hermes-tenki#6](https://github.com/opencolin/hermes-tenki/pull/6)), the commit that moved it to the `tenki` 1.x SDK. Upstream Hermes `main` has since added `register_terminal_environment_provider`, a plugin hook for terminal backends; once a Hermes release includes it, the Tenki backend can ship as a plugin instead of a fork.

## Quick start

Python 3.11 or later.

```bash
export TENKI_API_KEY=tk_...
./setup.sh                        # fetch the pinned Hermes checkout into ./hermes-agent
pip install -r requirements.txt   # tenki, PyYAML, requests
python run.py
```

`run.py` runs a few commands in a sandbox, ends the session, starts a new one with the same task ID, and reads back a file the first session wrote:

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

The two sandbox IDs differ. Session 2 is a new VM restored from session 1's snapshot.

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

- **Every `execute()` runs in the same VM.** The working directory carries across calls (`cd project`, then `pwd` prints `/home/tenki/project`), exit codes and stderr come back to the agent, and stdin is piped byte for byte.
- **Ephemeral sessions** (`persistent_filesystem=False`) terminate the VM on `cleanup()`.
- **Persistent sessions** snapshot the filesystem on `cleanup()`, wait until the snapshot is durable, record its ID in `$HERMES_HOME/tenki_snapshots.json`, and terminate the VM. The next `TenkiEnvironment` with the same `task_id` creates a new VM from that snapshot. If the snapshot fails, the backend pauses the VM instead of terminating it, so the files aren't lost.
- **Sandboxes are tagged `hermes-agent`**, and their metadata records `hermes_task_id` and a per-profile token, so two Hermes profiles on one Tenki account never pick up each other's sandboxes.
- **Your Hermes home stays on your machine.** The backend copies selected `~/.hermes` files into the VM only if you turn on `tenki_sync_hermes_home`.

`run.py` and `verify.py` also point `HERMES_HOME` at a temporary directory, so the run never touches your real `~/.hermes`, and both finish with `teardown()`, which terminates the run's sandboxes and deletes its snapshots.

## Use it from Hermes

With a Hermes install that includes the backend (this fork, for now):

```yaml
# ~/.hermes/config.yaml
terminal:
  backend: "tenki"
  cwd: "/home/tenki"            # a path inside the sandbox
  container_persistent: false   # true = snapshot on cleanup, restore next session
  tenki_max_duration: 3600      # seconds
  tenki_allow_outbound: true
```

`TERMINAL_ENV=tenki` overrides the configured backend. The full list of `tenki_*` keys is in the fork's [`cli-config.yaml.example`](https://github.com/opencolin/hermes-tenki/blob/2890bd33bee044a7b219b825cca8e656f5f3493c/cli-config.yaml.example).

## Check it works

```bash
node verify.mjs      # or: python verify.py
```

`verify.mjs` runs `setup.sh` if `./hermes-agent` is missing, then `verify.py`, which makes 12 checks against live Tenki and exits non-zero if any fails:

| Checks | What they prove |
|---|---|
| 1 | Hermes' own `check_terminal_requirements()` accepts the `tenki` backend |
| 2–9 | An ephemeral session: cwd is `/home/tenki`; output, exit codes and stderr come back; cwd carries across calls; stdin arrives byte for byte |
| 10 | `cleanup()` terminates the ephemeral VM |
| 11–12 | A persistent session saves a snapshot on `cleanup()`, and a new session with the same `task_id` reads back the file |

It takes about three minutes, mostly waiting for the snapshot to become durable, and leaves no sandbox or snapshot behind.

## Troubleshooting

- ❌ **`No Hermes checkout with the Tenki backend at …`.** Run `./setup.sh`, or set `HERMES_REPO` to an existing checkout of the fork.
- ❌ **`Feature 'terminal.tenki' unavailable: pip install failed … tenki-sandbox`.** Your checkout predates `2890bd3` and still pins the old `tenki-sandbox` package, which no longer installs. Delete `./hermes-agent` and run `./setup.sh` again.
- ❌ **`Set TENKI_API_KEY (tk_...)`.** This example reads the key from the environment only. Export `TENKI_API_KEY` (`TENKI_AUTH_TOKEN` also works). Inside Hermes itself, the backend also falls back to the credential `tenki login` saves.
- ❌ **A persistent session starts empty.** The task ID or the Hermes profile changed. Restores match on both.

## FAQ

**Does a persistent session keep a VM running between sessions?** No. `cleanup()` terminates it after the snapshot is durable. What persists is the snapshot, which is stored and billed until you delete it.

**Do old snapshots get cleaned up?** Not yet. When a restored session saves a new snapshot, the backend doesn't delete the one it replaced ([opencolin/hermes-tenki#6](https://github.com/opencolin/hermes-tenki/pull/6) describes the fix). `teardown()` in this example deletes every snapshot named for the run's task IDs.

**Why not `pip install hermes-agent`?** Hermes 0.19.0 picks terminal backends from a fixed list that doesn't include Tenki, and its plugin system can't add one. The plugin hook exists on upstream `main` but not in a release.

## Files

| File | Purpose |
|---|---|
| `setup.sh` | Fetch the pinned Hermes fork into `./hermes-agent` |
| `requirements.txt` | The SDK plus the two packages the backend's imports need |
| `hermes_env.py` | Puts the checkout on `sys.path`, isolates `HERMES_HOME`, and tears down sandboxes and snapshots |
| `run.py` | The two-session walkthrough above |
| `verify.py`, `verify.mjs` | The 12 live checks, and the shim the cookbook's CI runs |

## Related

- [`../openhermit-tenki/`](../openhermit-tenki/): sticky per-agent microVMs for an agent fleet
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/): snapshots and pause in the SDK directly
