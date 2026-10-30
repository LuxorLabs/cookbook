# RL rollouts at scale

Prepare an environment once, snapshot it, then start every RL episode in its own sandbox from that snapshot. [`run_episodes.py`](run_episodes.py) builds a golden sandbox (clones a repo and installs its dependencies), snapshots it, and fans out N episodes in parallel. Each episode is a new sandbox with a new id that already has the repo and the installed dependencies. A scripted policy (a fixed command sequence, so no model is needed) acts in it, the repo's tests score it, and the sandbox is terminated. The script retries 429 and 503 errors with backoff, guarantees teardown, and prints latency and sandbox-seconds. It uses only the [Tenki Python SDK](https://pypi.org/project/tenki/); everything runs on Tenki sandboxes and nothing needs a GPU or a model key.

Tenki can create a new sandbox from a snapshot with `tenki>=1.4.1`: `client.create(snapshot_id=...)`. That is a real fork, not pause and resume of the same sandbox ([`snapshots-pause-resume`](../snapshots-pause-resume/) shows that one). We checked it on a live workspace; see "What to know".

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "RL rollouts at scale" example from https://github.com/LuxorLabs/cookbook/tree/main/examples/rl-rollouts-at-scale.
1. Check that Python 3.12+ and uv are installed. In that folder, create a venv and install requirements.txt.
2. It needs a Tenki API key (starts with tk_) in TENKI_API_KEY, or one saved by `tenki login`. If neither exists, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it to a file.
3. Run `node verify.mjs` and confirm it prints three check marks.
4. Run `python run_episodes.py -n 10` and tell me the restore and lifetime latencies it prints.
5. Ask me before running 50 or more episodes, and tell me my workspace's concurrency limit first.
6. If a step fails, use the Troubleshooting table in the example's README.md.
Afterwards, show me where to replace the scripted policy in `episode()` with a model.
```

## Quick start

You need:

- Python 3.12 or later and [uv](https://docs.astral.sh/uv/).
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- Node.js 20 or later, only for `verify.mjs`.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/rl-rollouts-at-scale
uv venv --python 3.12 && uv pip install -r requirements.txt
source .venv/bin/activate
```

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...
```

If you ran `tenki login`, the script reads the key it saved in `~/.config/tenki/config.yaml` instead.

### 3. Verify

```bash
node verify.mjs
```

```
✓ retry: two 429s retried with backoff, a permission error raised at once
✓ 3 episodes started from snapshot 25bff33f, all scored 1.0
✓ all 4 sandboxes terminated (listed by tag run-c7426a25)
```

It builds the golden sandbox, snapshots it, runs three episodes from the snapshot, and then lists the sandboxes by this run's tag to check that the golden sandbox and all three episodes are terminated. It also checks the retry helper against a stub that raises two rate-limit errors. It takes about 30 seconds. `python verify.py` does the same if you don't have Node.

### 4. Run a batch

```bash
python run_episodes.py -n 50
```

```
episodes 50  scored 50  failed 0  mean score 0.80  concurrency 50
prepare (once, not per episode): setup 13.6s, snapshot ready 4.7s, durable 46.7s
seconds                        p50     p95     max
restore (create->ready)        5.9     7.6     7.8
policy + scoring               0.7     0.9     1.0
sandbox lifetime               6.8     8.5     8.7
wall time 8.7s   sandbox-seconds 305 episodes + 18 prepare
each sandbox: 1 vCPU, 1 GiB, 5 GiB disk
cost: pass --vcpu-rate/--mem-rate/--disk-rate (see https://tenki.cloud/pricing)
```

The mean score is `0.80` on purpose: the scripted policy breaks the library on every fifth episode, so the scores are a mix of `1.0` and `0.0`.

Options: `-n` (episodes), `--concurrency` (default: the free slots in your workspace's active-sandbox limit), `--tag` (default `rl-rollouts`), and `--no-durable` (see "What to know").

### 5. Get a cost

Cost is billed per second, so it is the sandbox-seconds times your rate. The script doesn't carry a rate. Read the current per-second rates from [tenki.cloud/pricing](https://tenki.cloud/pricing) and pass them in, or export them once:

```bash
python run_episodes.py -n 50 --vcpu-rate <usd-per-vcpu-second> --mem-rate <usd-per-gib-second> --disk-rate <usd-per-gib-second>
# or: export TENKI_VCPU_RATE=... TENKI_MEM_RATE=... TENKI_DISK_RATE=...
```

It then adds a cost line, using each sandbox's own size (read from the snapshot) and counting disk beyond the free 5 GiB the way the pricing page describes. It leaves out snapshot storage, which is billed separately; the script deletes the snapshot when it finishes, so it is only held for the length of a run.

## How it works

1. `prepare()` creates a 1 vCPU, 1 GiB sandbox, runs a setup script (`git clone` of [pluggy](https://github.com/pytest-dev/pluggy) at tag `1.5.0`, a virtualenv, `pip install pytest -e ./repo`), and calls `client.snapshots.create_and_wait(...)`. It terminates the golden sandbox as soon as the snapshot is `READY`, then waits for the snapshot to be durable. The snapshot outlives the sandbox it came from.
2. `episode(i)` calls `client.create(snapshot_id=...)`, waits for the sandbox, and checks that no state from another episode is there (`episode.txt` doesn't exist yet). Then it runs the policy: write `episode.txt`, optionally break `repo/src/pluggy/_hooks.py` with `sed`, run `pytest`. Exit code 0 scores `1.0`, anything else `0.0`.
3. A `try/finally` in every episode terminates its sandbox whatever happened, and `max_duration` caps each sandbox's lifetime (600 seconds for episodes, 900 for the golden one) so even a killed process can't leave one running for long. An episode that raises is recorded as failed and doesn't stop the batch.
4. `main()` sizes an `asyncio.Semaphore` from the workspace's `max_concurrent_jobs` limit (`client.get_usage()`) and runs the episodes under it. Its own `finally` terminates anything still tagged with the run's tag and deletes the snapshot.
5. `retry()` wraps every create and terminate call. It waits `1s * 2^attempt` with jitter and tries up to six times on a rate limit (`RateLimitedError`, HTTP 429), on `UNAVAILABLE` (HTTP 503, a `SandboxError` with `retryable=True`), and on `QuotaExceededError`, which means the concurrency limit is full and a slot will free up. Other errors raise at once.

To train something, replace the policy lines in `episode()` with your model's tool calls and the `pytest` exit code with your reward. For a model that can run arbitrary commands, grade in a different sandbox than the one the policy acts in, so the policy can't touch the grader.

## Measured on Tenki

Everything below was measured on 2026-10-30 from a laptop, on one workspace whose active-sandbox limit is 100, with 1 vCPU, 1 GiB sandboxes. "Restore" and "create" are the time from the create request until the sandbox is ready.

One at a time, so nothing else is competing:

| | n | min | p50 | p95 |
| --- | --- | --- | --- | --- |
| Cold create, bare sandbox | 10 | 1.9 s | 3.0 s | 3.6 s |
| Cold create plus this example's setup script | 5 | 12.5 s | 13.1 s | 13.3 s |
| Restore from a snapshot that is `READY` | 10 | 1.8 s | 1.9 s | 2.1 s |
| Restore from a snapshot that is durable | 10 | 0.8 s | 0.85 s | 0.9 s |

Taking the snapshot took 4.7 to 5.8 seconds, and the snapshot became durable 30 to 60 seconds after that. Both are paid once per batch.

Batches (the same script, three runs):

| Episodes | Concurrency | Wall time | Restore p50 / p95 | Sandbox lifetime p50 | Sandbox-seconds | Episodes per second |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | 50 | 8.7 s | 5.9 / 7.6 s | 6.8 s | 305 | 5.7 |
| 90 | 90 | 17.3 s | 12.2 / 16.3 s | 13.2 s | 1045 | 5.2 |
| 50 | 10 | 14.5 s | 1.7 / 2.7 s | 2.6 s | 133 | 3.4 |

All 190 episodes scored; none failed and none needed a retry. The golden sandbox adds about 18 sandbox-seconds to a batch. Multiply the sandbox-seconds by the vCPU and memory rates on the [pricing page](https://tenki.cloud/pricing) to get the cost: with this size it is a fraction of a cent for 50 episodes.

What the numbers say: a snapshot start replaces a 13-second setup with a 1 to 2 second start. Cold-starting 50 sandboxes and running the setup in each would cost about 650 sandbox-seconds of setup alone, against 18 once. Throughput stays near 5 episodes per second as the batch widens, and the extra width goes into waiting: restore time grows with the number of sandboxes created at once (0.85 s alone, 1.7 s with 10 in flight, 5.9 s with 50, 12.2 s with 90). So don't read the 90-wide batch's lifetime as work being done; it is mostly queueing.

## What to know

| | |
| --- | --- |
| Fork from a snapshot works at `tenki>=1.4.1` | `client.snapshots.create_and_wait(sandbox.id)` then `client.create(snapshot_id=snap.id, ...)` gives a new sandbox with a new id. We checked, on a live sandbox, that the file we wrote before the snapshot was there and that a background process we had started was still running under the same pid. The source sandbox can be terminated first; the snapshot stays. |
| `READY` is not durable | A snapshot is `READY` and restorable a few seconds after the request, but its durability state stays `LOCAL_READY` for another 30 to 60 seconds until it becomes `DURABLE`. Restores in that window were more than twice as slow in our runs (1.9 s against 0.85 s). The script waits for `DURABLE` before the fan-out so every episode restores at the fast time. `--no-durable` skips the wait (`verify.py` does) for a faster first run. |
| Restore slows as the batch widens | See the batch table. If you care about latency per episode more than total time, run with a lower `--concurrency`. |
| Sandbox-seconds are an upper bound | The script measures each sandbox from its create request to the end of termination. Time spent queueing before the sandbox runs is probably not billed, so the real bill is at most this. |
| Forks inherit the snapshot's size | Every episode here is 1 vCPU, 1 GiB, 5 GiB disk because the golden sandbox was. Create the golden sandbox at the size you need. |
| Files live under `/home/tenki` | Relative paths in `exec` resolve there, and so does the repo. |
| Retries and outages | None of the 190 batch episodes needed a retry. We did see the API return `503` for over 30 seconds once, while developing `verify.py`. `retry()` backed off for about 30 seconds (six attempts) and then raised, which is longer than the default gives; pass a larger `attempts` if you need to ride out longer outages. The 429 path is only tested in `verify.py`, against a stub. Nothing was left running after the failed run. |
| One workspace measured | The numbers come from one workspace at one time of day. Run the script on yours before you plan around them. |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | The script found no key. Export one or run `tenki login --api-key <key>`. |
| `ModuleNotFoundError: No module named 'tenki'` | Create the `.venv` here and install `requirements.txt`, or set `PYTHON` for `node verify.mjs`. |
| `RuntimeError: setup failed: ...` | `prepare()` needs outbound network to reach github.com and PyPI, which sandboxes have by default. If you restricted egress, allow those hosts. |
| Episodes fail with a quota or rate-limit error after the retries | The batch is wider than your workspace allows. Lower `--concurrency`. By default it is your free slots, which assumes nothing else starts sandboxes during the run. |
| `AssertionError: state leaked between episodes` | `episode.txt` was already in the snapshot. Take the snapshot before any episode-specific file is written. |
| Restores are slow right after the snapshot | It is still `READY` and not durable. Leave out `--no-durable`. |
| A sandbox is still running after an interrupted run | List them with `tenki sandbox list --tags rl-rollouts --state running`, and end each with `tenki sandbox terminate <id>`. They also expire on their own: `max_duration` is 10 minutes. |

## Related

- [Pause, snapshot, and resume](../snapshots-pause-resume/): pause and resume the same sandbox, and the snapshot calls this example uses, in JavaScript.
- [Tenki pricing](https://tenki.cloud/pricing)
- [Tenki Sandbox](https://tenki.cloud)
- [`tenki` on PyPI](https://pypi.org/project/tenki/)
