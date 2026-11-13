"""
Verify the snapshot-once, sandbox-per-episode pattern on live Tenki, with no model key:
  1. prepare() builds the golden environment and snapshots it,
  2. three episodes each start a NEW sandbox from the snapshot and are scored,
  3. every sandbox (the golden one and the three episodes) is terminated afterwards, and
  4. retry() backs off on a 429 (RateLimitedError) and gives up on a permission error.
"""
import asyncio
import uuid

from tenki import AsyncClient, PermissionDeniedError, RateLimitedError

from run_episodes import TERMINAL, episode, prepare, resolve_token, retry

N = 3


async def main():
    resolve_token()
    tags = ["rl-rollouts-verify", f"run-{uuid.uuid4().hex[:8]}"]

    calls = []

    async def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise RateLimitedError("rate limit exceeded")
        return "ok"

    assert await retry(flaky, base=0.01) == "ok" and len(calls) == 3, "429 was not retried"

    async def denied():
        raise PermissionDeniedError("no")

    try:
        await retry(denied, base=0.01)
        raise AssertionError("a non-retryable error was swallowed")
    except PermissionDeniedError:
        pass
    print("✓ retry: two 429s retried with backoff, a permission error raised at once")

    async with AsyncClient() as client:
        golden = await prepare(client, tags, durable=False)
        try:
            sem = asyncio.Semaphore(N)
            results = await asyncio.gather(*(episode(client, i, golden.snapshot.id, tags, sem) for i in range(N)))
        finally:
            await retry(lambda: client.snapshots.delete(golden.snapshot.id))
        assert all(r.score is not None for r in results), [r.error for r in results]
        assert len({r.sandbox_id for r in results} | {golden.sandbox_id}) == N + 1, "episodes reused a sandbox"
        assert [r.score for r in results] == [1.0, 1.0, 1.0], [r.score for r in results]
        print(f"✓ {N} episodes started from snapshot {golden.snapshot.id[:8]}, all scored 1.0")

        listed = await retry(lambda: client.list(tags=tags[1:], include_terminated=True))
        mine = {s.info.id: s.info.state for s in listed}
        expect = {golden.sandbox_id, *(r.sandbox_id for r in results)}
        assert set(mine) == expect and all(s in TERMINAL for s in mine.values()), mine
        print(f"✓ all {len(mine)} sandboxes terminated (listed by tag {tags[1]})")


asyncio.run(main())
