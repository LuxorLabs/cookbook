"""GRPO on MBPP with TRL: the model writes Python, Tenki sandboxes run it against the tests.

    python train.py                                   # Qwen2.5-0.5B-Instruct + LoRA, 50 steps
    python train.py --max-steps 2 --num-prompts 16    # a short first run

The trainer runs wherever your GPU is. Only `tenki_code_reward` talks to Tenki, once per
completion, so the training machine never executes generated code.
"""
import argparse

import torch
from datasets import load_dataset
from peft import LoraConfig
from trl import GRPOConfig, GRPOTrainer

from reward import tenki_code_reward

parser = argparse.ArgumentParser()
parser.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
parser.add_argument("--num-prompts", type=int, default=256, help="MBPP problems to train on (374 max)")
parser.add_argument("--max-steps", type=int, default=50)
parser.add_argument("--num-generations", type=int, default=8, help="completions per prompt (the GRPO group)")
parser.add_argument("--prompts-per-step", type=int, default=2)
parser.add_argument("--max-completion-length", type=int, default=256)
parser.add_argument("--output-dir", default="outputs")
args = parser.parse_args()


def to_example(row):
    tests = ([row["test_setup_code"]] if row["test_setup_code"] else []) + row["test_list"]
    task = f"{row['text']}\nYour code should pass these tests:\n" + "\n".join(row["test_list"])
    return {
        "prompt": [{"role": "user", "content": task + "\nReply with the function in one ```python block."}],
        "tests": [t.replace("\r\n", "\n") for t in tests],  # the reward receives this column as `tests`
    }


dataset = load_dataset("google-research-datasets/mbpp", "full", split="train")
dataset = dataset.shuffle(seed=0).select(range(min(args.num_prompts, len(dataset))))
dataset = dataset.map(to_example, remove_columns=dataset.column_names)

on_gpu = torch.cuda.is_available()
bf16 = on_gpu and torch.cuda.is_bf16_supported()  # Colab's T4 has no bf16; it trains in fp16 instead
config = GRPOConfig(
    output_dir=args.output_dir,
    max_steps=args.max_steps,
    learning_rate=5e-5,  # LoRA tolerates a higher rate than full fine-tuning; not tuned
    num_generations=args.num_generations,
    # batch size counts completions: prompts per step x completions per prompt
    per_device_train_batch_size=args.prompts_per_step * args.num_generations,
    gradient_accumulation_steps=1,
    max_completion_length=args.max_completion_length,
    temperature=1.0,
    bf16=bf16,
    fp16=on_gpu and not bf16,
    use_cpu=not on_gpu,
    logging_steps=1,  # the log line carries `reward` (the mean over the batch)
    save_strategy="no",
    report_to="none",
)
trainer = GRPOTrainer(
    model=args.model,
    reward_funcs=[tenki_code_reward],
    args=config,
    train_dataset=dataset,
    peft_config=LoraConfig(r=16, lora_alpha=32, target_modules="all-linear", task_type="CAUSAL_LM"),
)
trainer.train()
trainer.save_model(args.output_dir)
