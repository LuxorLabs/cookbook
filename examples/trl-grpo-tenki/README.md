# TRL GRPO with a sandboxed code reward

Train a small model with reinforcement learning to write Python, with each completion graded in its own Tenki sandbox. [TRL](https://github.com/huggingface/trl)'s `GRPOTrainer` runs on your GPU: it samples several solutions to each [MBPP](https://github.com/google-research/google-research/tree/master/mbpp) problem and updates a LoRA adapter. The reward function, [`reward.py`](reward.py), sends every completion to a fresh sandbox with outbound networking off, runs it against the problem's tests, and returns `1.0` if they pass and `0.0` if they don't. The model's code never runs on the training machine.

**No reward curve yet.** The reward is verified live on Tenki (step 3), and `train.py` has been run through the real `GRPOTrainer` on CPU with a tiny random model, scoring on Tenki, to check the wiring. We have not run a full training run on a GPU, so there is no learning curve and no trained model to show.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up GRPO training with a Tenki sandbox reward, following https://github.com/LuxorLabs/cookbook/tree/main/examples/trl-grpo-tenki.
1. Check that Python 3.12+ and uv are installed. Create a venv in that folder and install requirements.txt.
2. It needs TENKI_API_KEY (starts with tk_, from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
3. Run `node verify.mjs` and confirm it prints two check marks. It needs no model and no GPU.
4. Run `python reward_smoke.py` and confirm it prints [1.0, 0.0, 0.0].
5. Check whether this machine has an NVIDIA GPU. If it does, install requirements-train.txt (this pulls in PyTorch) and ask me before running train.py with --max-steps 2. If it doesn't, stop after step 4 and tell me to run training on a GPU machine.
6. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Python 3.12 or later and [uv](https://docs.astral.sh/uv/).
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An NVIDIA GPU, for the training run in step 4 only. Steps 1 to 3 need none.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/trl-grpo-tenki
uv venv --python 3.12 && uv pip install -r requirements.txt
source .venv/bin/activate
```

This installs the Tenki SDK, which is all the reward and `verify.py` need. Step 4 adds TRL and PyTorch.

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN also works
```

### 3. Check the reward with no model and no GPU

```bash
node verify.mjs        # or: python verify.py
```

```
✓ reward scored correct/wrong/infinite-loop [1.0, 0.0, 0.0], sys.exit(0) [0.0]
✓ all 4 reward sandboxes terminated
```

`verify.py` scores three hand-written completions of the same function: a correct one, a wrong one, and one that loops forever. It asserts `[1.0, 0.0, 0.0]`. It also scores a completion that calls `sys.exit(0)` before the tests run, which exits cleanly but must still get `0.0`. Then it lists the sandboxes the run tagged `trl-grpo` and checks that every one is terminated. It takes about 15 seconds. [`reward_smoke.py`](reward_smoke.py) prints the three scores on their own.

### 4. Train

```bash
uv pip install -r requirements-train.txt           # TRL, PyTorch and friends, at the versions train.py was checked against
python train.py --max-steps 2 --num-prompts 16     # a short first run
python train.py                                    # 50 steps on 256 problems
```

`train.py` trains `Qwen/Qwen2.5-0.5B-Instruct` with a LoRA adapter (`r=16`) on MBPP's `full` train split, with the reward from `reward.py`. Every step samples `--prompts-per-step` problems (default 2) and `--num-generations` completions of each (default 8), so a step grades 16 completions in 16 sandboxes at once. TRL logs `reward` (the mean over the batch) and `rewards/tenki_code_reward/mean` every step; a rising mean is the signal that it is learning. The adapter is saved to `outputs/`. The learning rate (`5e-5`) and the other settings are a starting point, not tuned.

The model comes from the Hugging Face Hub. Set `HF_TOKEN` if you hit rate limits.

## How a completion is graded

For each completion in a batch, `tenki_code_reward` does this:

1. Takes the first fenced code block from the completion, or the whole text if there isn't one. TRL passes either a string or a list of chat messages, and the reward accepts both.
2. Creates a sandbox with `allow_outbound=False`, a 120-second lifetime cap, and the tag `trl-grpo`. A semaphore keeps at most 16 of these running at once.
3. Runs `python3 -` in it with the program on stdin: the completion, then the problem's `assert` lines, then a `print` of a random marker. The exec has a 10-second hard timeout.
4. Returns `1.0` only if the exit code is 0, the exec didn't time out, and the marker was printed. Anything else is `0.0`.
5. Terminates the sandbox in a `finally`, however the run ended.

The function is `async`, which TRL supports directly: it runs the reward on a background event loop and hands it the batch's `completions` plus every other dataset column, here `tests`. That is how all of a batch's sandboxes run concurrently inside one reward call. Creating a sandbox took about half a second in our checks, and in one run all 48 of a random sample of MBPP's reference solutions scored `1.0` in under 3 seconds with 16 sandboxes at a time.

## Trust the reward

The grader has to run where the policy can't reach it. Here the policy has no shell at all: it only produces text. The text runs in a sandbox the policy never sees the output of, the tests and the marker are added after its code, and a clean `sys.exit(0)` doesn't score. Even so, a policy under pressure will try to exploit whatever it can, so read some of the completions that score `1.0` during a real run, for example with TRL's `log_completions=True`.

## What to know

| | |
| --- | --- |
| Concurrency | A step starts as many sandboxes as `per_device_train_batch_size` (16 by default) at once, capped by `TENKI_REWARD_CONCURRENCY` (default 16). Keep both under your workspace's sandbox limit. A create that hits a rate or quota error is retried with backoff up to five times. |
| Errors score `0.0` | A sandbox that fails to start or run after the retries scores `0.0` and prints a line starting `tenki_code_reward:`. A run of those lines means the reward is noise, not that the model got worse. |
| No network, so no `pip install` | `allow_outbound=False` turns outbound networking off (name lookups fail). The image has Python 3.12 and some common packages (`numpy` imports), but a completion can't install anything. MBPP only needs the standard library. |
| Exit code and marker | Tests are plain `assert` lines, so they raise on failure and the exit code is non-zero. The marker is what stops a completion that exits early from passing. |
| 10 seconds per completion | Slow but correct code scores `0.0` too. Raise `EXEC_TIMEOUT_SEC` in `reward.py` if your problems need more. |
| One sandbox per completion | Simple and clean, but each completion pays for a create. A warm pool, with N sandboxes created once and reused across steps, cuts per-step latency. This example doesn't implement one. |
| Binary reward | There's no partial credit for code that compiles but fails. Edit the return in `_run_one` if you want one. |
| Some MBPP problems can't be solved from the prompt | Task 601's tests build `Pair` objects that the problem text never mentions, so only a solution that happens to define `Pair` passes. Grade the dataset's own reference solutions through the reward before you trust a reward number. |
| TRL moves fast | `requirements-train.txt` pins TRL `1.17.1`, Transformers `5.22.1`, PEFT `0.21.2` and Datasets `5.1.0`. The async reward function and `reward` logging keys depend on the TRL version. |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | `verify.py` found no key. Export one or run `tenki login --api-key <key>`. |
| `ModuleNotFoundError: No module named 'tenki'` from `node verify.mjs` | Create the `.venv` here and install `requirements.txt`, or set `PYTHON`. |
| `ModuleNotFoundError: No module named 'trl'` from `train.py` | Install `requirements-train.txt`. |
| `tenki_code_reward: RateLimitedError` or `QuotaExceededError` repeatedly | You are over your workspace's sandbox limit. Lower `TENKI_REWARD_CONCURRENCY`, or `--prompts-per-step`. |
| Reward is `0` for every step | Run `python reward_smoke.py` first. If that passes, print one completion and its tests: the model may not be returning a code block, or `--max-completion-length` cuts it off. |
| A sandbox is still running after an interrupted run | List them with `tenki sandbox list --tags trl-grpo --state running`, and end each with `tenki sandbox terminate <id>`. They also stop on their own after 120 seconds. |

## Related

- [Run code with Python](../run-code-python/) and [Harbor](../harbor-tenki/): the Tenki SDK on its own, and agent evals with a sandbox per trial.
- [Pause, snapshot, and resume](../snapshots-pause-resume/): snapshots, the starting point for a warm pool.
- [TRL's GRPO trainer](https://huggingface.co/docs/trl/grpo_trainer) and its [reward function docs](https://huggingface.co/docs/trl/grpo_trainer#using-a-custom-reward-function)
- [Tenki Sandbox](https://tenki.cloud)
