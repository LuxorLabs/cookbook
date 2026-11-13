"""GRPO reward for code: run each completion against its tests in its own Tenki sandbox.

``tenki_code_reward`` follows TRL's reward-function contract: it receives the batch's
``completions`` plus every extra dataset column (here ``tests``) and returns one float per
completion, 1.0 when every test passes and 0.0 otherwise. It is ``async``, which TRL
supports natively: it runs the function on a background event loop, and this module fans out
one sandbox per completion on that loop, bounded by a semaphore.

The model's code never runs on the training machine. Each sandbox has outbound networking
off, a hard timeout on the exec, and is always terminated, even on timeout or error.

Auth comes from ``TENKI_API_KEY`` (or ``~/.config/tenki/config.yaml``).
"""

from __future__ import annotations

import asyncio
import os
import re
import uuid

from tenki import AsyncSandbox, QuotaExceededError, RateLimitedError

TAG = "trl-grpo"
# How many sandboxes run at once. Keep it under your workspace's concurrent sandbox limit;
# a GRPO batch is `per_device_train_batch_size * steps_per_generation` completions per step.
MAX_CONCURRENCY = int(os.environ.get("TENKI_REWARD_CONCURRENCY", "16"))
EXEC_TIMEOUT_SEC = 10  # per completion: an infinite loop ends here and scores 0.0
SANDBOX_LIFETIME_SEC = 120  # hard cap, so a crashed trainer can't leak a running sandbox
_FENCE = re.compile(r"```(?:python|py)?\s*\n(.*?)```", re.S)


def extract_code(completion) -> str:
    """The code to run: the first fenced block of the completion, else the whole text.

    TRL passes a string for plain prompts and a list of chat messages for conversational ones.
    """
    text = completion if isinstance(completion, str) else completion[-1]["content"]
    match = _FENCE.search(text)
    return (match.group(1) if match else text).strip()


async def _create_sandbox() -> AsyncSandbox:
    """Create a sandbox, backing off when the workspace is at its limit instead of scoring 0."""
    for attempt in range(5):
        try:
            return await AsyncSandbox.create(
                name="trl-reward",
                allow_outbound=False,  # generated code can't reach the network
                max_duration=SANDBOX_LIFETIME_SEC,
                tags=[TAG],
            )
        except (RateLimitedError, QuotaExceededError):
            if attempt == 4:
                raise
            await asyncio.sleep(2**attempt)


async def _run_one(sem: asyncio.Semaphore, code: str, tests: list[str]) -> float:
    # The tests end by printing a one-time marker. A completion that calls `sys.exit(0)` before
    # the tests run exits 0 too, so a clean exit alone isn't a pass: the marker must be printed.
    marker = uuid.uuid4().hex
    program = code + "\n\n" + "\n".join(tests) + f"\nprint({marker!r})\n"
    async with sem:
        sandbox = None
        try:
            sandbox = await _create_sandbox()
            # The program goes in on stdin: no file to write, nothing to escape in a shell.
            result = await sandbox.exec("python3", "-", input=program, timeout=EXEC_TIMEOUT_SEC)
            passed = result.exit_code == 0 and not result.timed_out and marker in result.stdout_text
            return 1.0 if passed else 0.0
        except Exception as exc:  # a sandbox that failed to run is a 0.0, not a crashed run
            print(f"tenki_code_reward: {type(exc).__name__}: {exc}")
            return 0.0
        finally:
            if sandbox is not None:
                try:
                    await sandbox.close_if_open()  # terminates the sandbox
                except Exception as exc:  # max_duration still ends it; don't lose the batch over it
                    print(f"tenki_code_reward: could not terminate {sandbox.id}: {exc}")


async def tenki_code_reward(completions, tests, **kwargs) -> list[float]:
    """One sandbox per completion; ``tests[i]`` is a list of ``assert`` lines (or one string)."""
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    jobs = [
        _run_one(sem, extract_code(c), [t] if isinstance(t, str) else list(t))
        for c, t in zip(completions, tests, strict=True)
    ]
    return list(await asyncio.gather(*jobs))
