"""Score three hand-written completions with the reward. No model, no GPU.

    python reward_smoke.py      # needs TENKI_API_KEY or `tenki login`; prints [1.0, 0.0, 0.0]
"""
import asyncio
import time

from reward import tenki_code_reward

TESTS = ["assert add(2, 3) == 5", "assert add(-1, 1) == 0"]  # MBPP-style asserts
COMPLETIONS = {
    "correct": "```python\ndef add(a, b):\n    return a + b\n```",
    "wrong": "```python\ndef add(a, b):\n    return a - b\n```",
    "infinite loop": "```python\ndef add(a, b):\n    while True:\n        pass\n```",
}


async def score() -> list[float]:
    return await tenki_code_reward(list(COMPLETIONS.values()), tests=[TESTS] * len(COMPLETIONS))


if __name__ == "__main__":
    t0 = time.time()
    scores = asyncio.run(score())
    for name, s in zip(COMPLETIONS, scores):
        print(f"{name:>13}: {s}")
    print(f"{scores} in {time.time() - t0:.1f}s")
    assert scores == [1.0, 0.0, 0.0], scores
