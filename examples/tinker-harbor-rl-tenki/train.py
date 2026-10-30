"""
Train on Terminal-Bench with tinker-cookbook's Harbor RL recipe, with every rollout in a Tenki sandbox.

    uvx harbor datasets download terminal-bench@2.0 -o ~/.cache/harbor/tasks/terminal-bench-2.0/
    export TENKI_API_KEY=tk_... TINKER_API_KEY=...
    TB_TASKS=fix-git,cobol-modernization python train.py model_name=Qwen/Qwen3-8B max_steps=10

Every `key=value` argument is a field of the recipe's CLIConfig (model_name, group_size,
groups_per_batch, learning_rate, max_steps, ...). TB_TASKS picks tasks by name; unset trains on all 89.
"""
import asyncio, os  # noqa: E401

import chz
from tinker_cookbook.recipes.harbor_rl.harbor_env import load_harbor_tasks
from tinker_cookbook.recipes.harbor_rl.train import CLIConfig, cli_main

from tinker_tenki import tenki_sandbox_factory

DATASET = "terminal-bench-2.0/terminal-bench"  # under ~/.cache/harbor/tasks/


if __name__ == "__main__":
    cli_config = chz.entrypoint(CLIConfig)
    tasks = load_harbor_tasks(DATASET)
    if names := [n for n in os.environ.get("TB_TASKS", "").split(",") if n]:
        missing = set(names) - {t.task_name for t in tasks}
        if missing:
            raise SystemExit(f"Unknown TB_TASKS: {sorted(missing)}")
        tasks = [t for t in tasks if t.task_name in names]
    print(f"Training on {len(tasks)} task(s); rollouts run on Tenki.")
    asyncio.run(cli_main(cli_config, tasks, sandbox_factory=tenki_sandbox_factory))
