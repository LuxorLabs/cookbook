#!/bin/sh
# Runs inside the sandbox: install CPU PyTorch and laya, then fine-tune on data/train.csv and
# score the base and tuned checkpoints on the held-out data/eval.csv. EPOCHS defaults to 3.
set -e
cd "$HOME/laya"
uv venv -q .venv --python 3.12
uv pip install -q --python .venv/bin/python torch --index-url https://download.pytorch.org/whl/cpu
uv pip install -q --python .venv/bin/python "laya>=0.4.21"
.venv/bin/laya-train \
  --data data/train.csv --eval data/eval.csv --out ckpt \
  --instructions "Which team should handle this support ticket?" \
  --epochs "${EPOCHS:-3}" --micro-batch 4 --grad-accum 2 \
  --max-len 128 --head-max-len 64 --device cpu --seed 1
