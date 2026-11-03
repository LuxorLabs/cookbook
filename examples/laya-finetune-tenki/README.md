# Fine-tune a Laya decision model

Fine-tune [Laya](https://github.com/NandhaKishorM/laya), a 421M-parameter decision model that scores typed questions in one forward pass, on your own labelled data inside a Tenki sandbox. `run.mjs` uploads 60 labelled support tickets, installs CPU PyTorch and `laya`, runs `laya-train` to fine-tune the base checkpoint, scores the base and tuned checkpoints on 20 held-out tickets, and routes four new tickets with the result. It needs no GPU: on an 8-core sandbox the install takes about 10 seconds and the training about a minute. The sandbox is terminated when the script ends; pass `--keep` to snapshot it first so the checkpoint outlives it.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Fine-tune a Laya decision model" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo and cd into examples/laya-finetune-tenki.
2. Check that Node.js is 24 or later, then run npm install.
3. The scripts need a Tenki API key (starts with tk_) in TENKI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it to a file.
4. Run node run.mjs and confirm the held-out accuracy goes from 0.7000 to 0.8500, then run node verify.mjs.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then help me replace data/train.csv and data/eval.csv with my own labelled examples (a text column and a label column) and rerun it.
```

## Quick start

You need:

- Node.js 24 or later for `run.mjs`, which uses top-level `await using`. `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

Nothing installs on your machine besides the SDK. PyTorch, `laya` and the 843 MB checkpoint download inside the sandbox.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/laya-finetune-tenki
npm install
```

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`.

### 3. Run

```bash
node run.mjs
```

```
sandbox 01a19fa3-e3aa-72dc-8cd3-d7e29422c73e
.......
=== Evaluation (before vs after fine-tuning on 20 held-out items from data/eval.csv) ===
Metric                 Before         After          Delta
-----------------------------------------------------------------
Accuracy               0.7000         0.8500         +0.1500
Loss                   0.6618         1.4436         +0.7818
ECE                    0.2130         0.1163         -0.0967
Brier (multi-class)    0.3587         0.1743         -0.1844
Brier (top-1)          0.1499         0.0804         -0.0695
Mean Confidence        0.6642         0.9405         +0.2763
-----------------------------------------------------------------
billing    1.000  You charged my card for a plan I cancelled in May.
technical  1.000  The upload button does nothing on Firefox.
shipping   1.000  Our parcel never showed up and tracking is stuck.
account    1.000  How do I reset my password?
```

About 75 seconds in all. The numbers are the same on every run: the seed is fixed and training runs on CPU.

### 4. Verify

```bash
node verify.mjs
```

```
✓ laya-finetune-tenki: install → fine-tune on CPU → held-out accuracy 0.7 → 0.85 → 4/4 new tickets routed
```

`verify.mjs` runs the same training, then fails unless the report says the evaluation was held out, the tuned accuracy is at least 0.7 and no lower than the base, and at least three of the four new tickets go to the right team. It terminates the sandbox in a `finally` block.

## The code

`train.sh` runs inside the sandbox. `laya-train` reads a CSV with a `text` and a `label` column, builds one choice question from the distinct labels, and with `--eval` scores the base checkpoint on the held-out file before training and the tuned one after:

```sh
uv venv -q .venv --python 3.12
uv pip install -q --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cpu
uv pip install -q --python .venv/bin/python "laya>=0.4.21"
.venv/bin/laya-train \
  --data data/train.csv --eval data/eval.csv --out ckpt \
  --instructions "Which team should handle this support ticket?" \
  --epochs "${EPOCHS:-3}" --micro-batch 4 --grad-accum 2 \
  --max-len 128 --head-max-len 64 --device cpu --seed 1
```

`run.mjs` uploads the files, starts `train.sh` detached, and polls a sentinel file for its exit code, because a training run can outlast a single `exec`:

```js
await using sandbox = await tenki.createAndWait({ cpuCores: 8, memoryMb: 16384, diskSizeGb: 20 });
for (const f of ["data/train.csv", "data/eval.csv", "train.sh", "predict.py"]) {
  await sandbox.writeFile(`/home/tenki/laya/${f}`, readFileSync(new URL(f, import.meta.url)));
}
await sh(sandbox, "setsid sh -c 'sh ~/laya/train.sh > ~/laya/train.log 2>&1; echo $? > ~/laya/DONE' </dev/null >/dev/null 2>&1 &");
while ((code = (await sh(sandbox, "cat ~/laya/DONE 2>/dev/null")).out) === "") await sleep(10_000);
```

`predict.py` loads the result with `laya.load("ckpt")` and asks the question `laya-train` saved in `ckpt/questions.json`:

```python
agent = laya.load(sys.argv[1])
questions = json.load(open(f"{sys.argv[1]}/questions.json"))
answer = agent.predict(text, questions)["answers"]["label"]
print(answer["choice"], answer["probabilities"][answer["choice"]])
```

## Use your own data

Replace `data/train.csv` and `data/eval.csv` with your own rows. Each file needs a `text` column and a `label` column; the labels become the choices. Keep the evaluation rows out of the training file, or the report says `overlapping_eval` instead of `held_out`. The Laya authors suggest fifty to a hundred examples per label for production.

- **More data or longer texts.** Raise `--max-len` (the checkpoint reads up to 512 tokens) and the sandbox size. Training time grows with both.
- **More epochs.** `EPOCHS=6` in the environment of `train.sh`.
- **Several questions per ticket**, or `score` and `noul` questions, need JSONL rows of `{state, questions, gold}` instead of a CSV. See the [laya fine-tuning docs](https://github.com/NandhaKishorM/laya#fine-tuning).

## Keep the checkpoint

```bash
node run.mjs --keep
```

```
kept: snapshot a50ba54e-8b8a-4aad-a932-7546ba3334ef (READY) holds ~/laya/ckpt; create a sandbox with { snapshotId } to serve it
```

The snapshot holds the virtual environment and the 1.6 GB checkpoint directory. A sandbox created from it with `tenki.createAndWait({ snapshotId, cpuCores: 8, memoryMb: 16384 })` can run `predict.py` straight away, or serve the model with `pip install "laya[serve]"`. Delete the snapshot with `tenki.deleteSnapshot(id)` when you no longer need it. To publish the checkpoint instead, push `~/laya/ckpt` to the Hugging Face Hub from inside the sandbox.

## Things to know

- **The probabilities are not calibrated with this little data.** `laya-train` holds back a tenth of the training rows to fit a temperature and needs at least 10 of them; with 6 it leaves the temperature at 1.0 and warns, which is why every new ticket above scores 1.000. Train on 100 rows or more and the confidences become usable thresholds.
- **Accuracy is the number to watch, not loss.** Held-out loss rises here because the tuned model is confidently wrong on the three tickets it misses.
- **CPU only.** Tenki sandboxes have no GPU. A 421M-parameter encoder fine-tunes on CPU in minutes for hundreds of rows; for the authors' 30,000-question benchmark run, use their Kaggle notebook on GPUs.
- Outbound network is required: the sandbox downloads PyTorch, `laya` and the checkpoint from PyPI, download.pytorch.org and Hugging Face.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `SyntaxError` at `await using sandbox` | Use Node 24 or later, or run `verify.mjs`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `training failed (exit 1)` with `missing text column` or `missing label column` | Your CSV headers must be `text` and `label`, or change `--text-column` and `--label-column` in `train.sh`. |
| `training failed` with `Killed` in the log | The sandbox ran out of memory. Lower `--micro-batch`, or raise `memoryMb`. |
| `RuntimeWarning: ... fewer than 10, so the temperature stays 1.0` | Expected with 60 training rows. Add rows to calibrate. |
| `✗ held-out accuracy ...` from `verify.mjs` | A new `laya` release changed training. Pin the last good version in `train.sh` and report it upstream. |

## Related

- [Laya](https://github.com/NandhaKishorM/laya) on GitHub, the [`convaiinnovations/laya`](https://huggingface.co/convaiinnovations/laya) checkpoint, and the [demo Space](https://huggingface.co/spaces/convaiinnovations/laya-demo)
- [Golden image](../golden-image/): bake the PyTorch install into a snapshot so every training sandbox starts with it
- [Pause, snapshot, and resume](../snapshots-pause-resume/)
- [Run code with Python](../run-code-python/)
