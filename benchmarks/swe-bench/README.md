# SWE-bench

Run [SWE-bench](https://www.swebench.com) on Tenki sandboxes, graded with the official `swebench` harness. Each instance's canonical Docker image runs inside its own Tenki sandbox, so a `resolved` here means what it means on the leaderboard.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Run SWE-bench on Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/next/benchmarks/swe-bench.
1. Clone https://github.com/LuxorLabs/cookbook, check out the next branch, and cd into benchmarks/swe-bench.
2. Create a venv with uv venv and run uv pip install -r requirements.txt.
3. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
4. Run node verify.mjs and confirm the ✓ line for pallets__flask-4992.
5. Before a model run, ask me which model, endpoint, and how many instances. Check the model key is exported (ask me to export it if not), install mini-swe-agent and pyyaml, run with --empty first and confirm nothing resolves, then run the harness with --model.
```

## Quick start

You need:

- Python 3.10 or later and [uv](https://docs.astral.sh/uv/) (or `venv` and pip).
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- For a model run: an OpenAI-compatible endpoint and key.

### 1. Install

```bash
git clone -b next https://github.com/LuxorLabs/cookbook.git
cd cookbook/benchmarks/swe-bench
uv venv
uv pip install -r requirements.txt   # swebench, datasets, tenki-sandbox
```

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY or a `tenki login` key also work
```

`harness.py` passes a `tenki login` session token to the SDK as `cookie:<token>` for you.

### 3. Run

Apply the gold patch to one instance and grade it, with no model:

```bash
.venv/bin/python harness.py --dataset lite --instances pallets__flask-4992 --oracle
```

### 4. Verify

```bash
node verify.mjs        # or: .venv/bin/python verify.py
```

`verify.py` runs the same oracle on `pallets__flask-4992` and fails unless the gold patch turns its `FAIL_TO_PASS` test green and keeps all 18 `PASS_TO_PASS` tests green. It prints `✓ swe-bench: oracle pallets__flask-4992 on Tenki → resolved` with the counts. It uses a Flask instance because its tests are hermetic; suites that call external services, like `psf__requests-*` (httpbin), flap from run to run.

## How each instance runs

1. Create a Tenki sandbox with `disk_size_gb=32`. One SWE-bench image is 2 to 4 GB.
2. Install Docker and pull `swebench/sweb.eval.x86_64.<instance>`, with the repo checked out at `base_commit` in `/testbed`. Docker containers need no nested virtualization, so this works in a stock sandbox.
3. Apply the gold patch (`--oracle`) or let an agent edit `/testbed`.
4. Grade with the instance's own `eval_script` and `swebench`'s log parser, giving `FAIL_TO_PASS`, `PASS_TO_PASS`, and `resolved`.

## Run a model

This uses [`mini-swe-agent`](https://github.com/SWE-agent/mini-swe-agent) as the scaffold (`pip install mini-swe-agent pyyaml`):

```bash
export OPENAI_API_KEY=sk-...
.venv/bin/python harness.py --dataset lite --limit 20 --workers 4 \
  --model gpt-5.6 --api-base https://api.openai.com/v1 --api-key-env OPENAI_API_KEY
```

Each instance gets its own sandbox, so `--workers N` runs them in parallel. Results, with per-instance `resolved`, F2P/P2P counts, and a `resolvedRate`, go to `swebench-tenki.json` (`--out` to change). `--keep` leaves VMs running for debugging.

Run with `--empty` (no edit) first. Every instance must come back `resolved=False`; if one resolves, the grader is getting the wrong tests.

## Datasets

```bash
--dataset lite        # 300 instances (default)
--dataset verified    # 500, human-filtered
--dataset full        # 2,294
```

Other benchmarks that publish `sweb.eval.x86_64.*`-style images (Multilingual, SWE-Gym, R2E-Gym, SWE-rebench) can be added as a row in `DATASETS` in `harness.py`, plus an `image_name()` variant if their image names differ.

## Things to know

- The CI check pulls a multi-GB image and runs a real eval, so it takes minutes.
- Everything the benchmark touches lives inside the container, so paths are the repo's own (`/testbed`).
- [SWE-bench](https://github.com/princeton-nlp/SWE-bench) and `mini-swe-agent` are MIT. `datasets` is Apache-2.0.

## Related

- [Harbor](../../examples/harbor-tenki/): Terminal-Bench and other agent evals, one sandbox per trial
- [Sandbox SDK guide](https://tenki.cloud/docs/sandbox/sdk)
