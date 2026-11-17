"""Score one NeMo Gym rollout (one attempt by a model at a task) in a Tenki sandbox.

    uv sync && uv run python run.py
"""

import asyncio

from nemo_gym.sandbox.providers.base import SandboxSpec
from nemo_gym.sandbox.providers.registry import create_provider, list_providers

# Code a model might write during a rollout. Running it is how the attempt gets scored.
SOLUTION = """\
def fizzbuzz(n):
    return "FizzBuzz" if n % 15 == 0 else "Fizz" if n % 3 == 0 else "Buzz" if n % 5 == 0 else str(n)

assert [fizzbuzz(i) for i in (3, 5, 15, 7)] == ["Fizz", "Buzz", "FizzBuzz", "7"]
print("tests passed")
"""


async def main() -> None:
    print("providers:", ", ".join(list_providers()))

    # Pick the Tenki provider and size its VMs. In a NeMo Gym config file, the same
    # settings go under `sandbox_provider:`.
    provider = create_provider({"tenki": {"create": {"cpu_cores": 1, "memory_mb": 1024, "max_duration_s": 600}}})
    # Start a sandbox with the model's solution copied into /home/tenki/task.
    handle = await provider.create(SandboxSpec(workdir="/home/tenki/task", files={"solution.py": SOLUTION}))
    print(f"sandbox {handle.sandbox_id}")
    try:
        r = await provider.exec(handle, "python3 solution.py", cwd="/home/tenki/task")
        reward = 1.0 if r.return_code == 0 else 0.0  # tests passed: full reward
        print(f"exit {r.return_code}: {(r.stdout or r.stderr or '').strip()}")
        print(f"reward {reward}")
    finally:
        await provider.close(handle)  # terminates the sandbox
        await provider.aclose()


if __name__ == "__main__":
    asyncio.run(main())
