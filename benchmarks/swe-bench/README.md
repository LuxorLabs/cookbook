# Run SWE-bench on Tenki

Run [SWE-bench](https://www.swebench.com) — the standard "can an agent fix a real GitHub issue?" benchmark — on disposable [Tenki](https://tenki.cloud) sandboxes, graded with the **official** `swebench` harness. No from-source reimplementation: each instance's canonical Docker image runs *inside* a Tenki sandbox, so the numbers are comparable to everyone else's.

## The idea: Docker in the sandbox

Tenki gives you a stock Ubuntu sandbox. It has no nested virtualization — but it doesn't need any, because Docker **containers are namespaces, not VMs**. `docker run` works inside a Tenki sandbox without `/dev/kvm`. So the recipe per instance is:

1. **create** a Tenki VM (`disk_size_gb=32` — one SWE-bench image is ~2–4 GB)
2. **install docker**, pull `swebench/sweb.eval.x86_64.<instance>` — the canonical image, repo checked out at `base_commit` in `/testbed`
3. **edit** `/testbed`: apply the gold patch (`--oracle`) or let an agent work
4. **grade** with the instance's own `eval_script`, parsed by `swebench`'s log parser → `FAIL_TO_PASS` / `PASS_TO_PASS` → `resolved`

Because the image and the eval script are the upstream ones, a `resolved` here means what it means on the official leaderboard.

## Setup (Python 3.10+)

```bash
uv venv                                # or: python3.11 -m venv .venv
uv pip install -r requirements.txt     # swebench + datasets + tenki-sandbox
export TENKI_AUTH_TOKEN=...             # see the auth note
```

**Auth note.** The Python SDK authenticates cleanly with a **`tk_` API key** (`export TENKI_AUTH_TOKEN=tk_…`). A `tenki login` browser session token also works, but — unlike the Node SDK — the Python SDK won't auto-detect it; pass it as **`cookie:<token>`**. `harness.py` does this for you.

## Verify it (no LLM needed)

```bash
node verify.mjs        # or: .venv/bin/python verify.py
```

`verify.py` oracles one real instance (`pallets__flask-4992`) on a live Tenki sandbox: boot → docker-in-VM → **apply the gold patch** → grade. The gold patch must turn its `FAIL_TO_PASS` test green (and keep all 18 `PASS_TO_PASS` green), which proves the whole pipeline works on Tenki **without a model key**. This is what CI runs (~1 min: a small image pull + the eval).

The same call, by hand:

```bash
.venv/bin/python harness.py --dataset lite --instances pallets__flask-4992 --oracle
```

**Why a Flask instance and not, say, `psf__requests-*`?** The verify has to be green *every* run. Flask's suite is hermetic; some repos' tests hit external services (requests calls httpbin), so their oracle passes one minute and fails the next — fine for a scored run you average, useless as a CI gate. Anchor a verify to a hermetic instance.

## Run a model

The oracle is the pipeline with the gold patch; swap in an agent and you have a real benchmark run. Bring any OpenAI-compatible endpoint (this uses [`mini-swe-agent`](https://github.com/SWE-agent/mini-swe-agent) as the scaffold — `pip install mini-swe-agent pyyaml`):

```bash
export OPENAI_API_KEY=sk-...
.venv/bin/python harness.py --dataset lite --limit 20 --workers 4 \
  --model gpt-5.6 --api-base https://api.openai.com/v1 --api-key-env OPENAI_API_KEY
```

Each instance gets its own sandbox, so `--workers N` fans out cleanly — that's the point of disposable sandboxes. Results (per-instance `resolved` + F2P/P2P + a `resolvedRate`) land in `swebench-tenki.json`.

> **Sanity check your scaffold.** Run `--empty` (no edit) first: every instance *must* come back `resolved=False`. If an empty run "resolves," your grader is being fed the wrong tests — fix that before trusting any score.

## Other SWE-bench datasets

Same harness, one flag — `princeton-nlp` ships the per-instance images for all three:

```bash
--dataset lite        # 300 instances (default)
--dataset verified    # 500, human-filtered
--dataset full        # 2,294
```

Other family benchmarks that publish `sweb.eval.x86_64.*`-style images (Multilingual, SWE-Gym, R2E-Gym, SWE-rebench, …) drop in by adding a row to `DATASETS` in `harness.py` — and, if their image names differ, a one-line `image_name()` variant.

## Notes

- **CI weight.** This example pulls a multi-GB image and runs a real eval, so its verify is minutes, not seconds — heavier than the JS examples. That's the cost of grading faithfully.
- Tenki confines host file I/O to `/home/tenki`; everything the benchmark touches lives *inside* the container, so paths there are the repo's own (`/testbed`).
- Licensing: [SWE-bench](https://github.com/princeton-nlp/SWE-bench) and `mini-swe-agent` are MIT; `datasets` is Apache-2.0.
- Official SDK + full API: [tenki.cloud/docs/sandbox/sdk](https://tenki.cloud/docs/sandbox/sdk).
