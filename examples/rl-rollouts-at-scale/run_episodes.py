"""Snapshot once, one sandbox per episode: the rollout pattern for RL on Tenki.

prepare()  builds the golden environment once (clone a repo, install deps) and snapshots it.
episode(i) creates a NEW sandbox from that snapshot, runs a scripted policy, scores it,
           and always terminates the sandbox.
main()     fans out N episodes under a semaphore, retries 429/503, and prints latency and cost.

Auth: TENKI_API_KEY (or TENKI_AUTH_TOKEN), else the token `tenki login` saved in
~/.config/tenki/config.yaml.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import random
import re
import statistics
import sys
import time
import uuid
from dataclasses import dataclass

from tenki import AsyncClient, QuotaExceededError, RateLimitedError, SandboxError

REPO, REF = "https://github.com/pytest-dev/pluggy.git", "1.5.0"
SETUP = f"""set -e
git clone -q --depth 1 --branch {REF} {REPO} repo
python3 -m venv venv
venv/bin/pip install -q pytest -e ./repo
"""
# The scripted policy: a fixed command sequence, so no model is needed. Every 5th episode
# "breaks" the library first, so the table shows scores of both 1.0 and 0.0.
TERMINAL = {"TERMINATING", "TERMINATED"}


def resolve_token() -> str:
    token = os.environ.get("TENKI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN")
    if not token:
        try:
            text = open(os.path.expanduser("~/.config/tenki/config.yaml")).read()
            token = re.search(r"^auth_token:\s*(.+)$", text, re.M).group(1).strip()
        except (OSError, AttributeError):
            sys.exit("No token. Set TENKI_API_KEY, or run `tenki login`.")
    os.environ["TENKI_API_KEY"] = token
    return token


async def retry(call, attempts: int = 6, base: float = 1.0):
    """Await call() again with exponential backoff and jitter on 429 and 503."""
    for n in range(attempts):
        try:
            return await call()
        except (RateLimitedError, QuotaExceededError, SandboxError) as e:
            # RateLimitedError is a 429; UNAVAILABLE (503) comes back as a retryable SandboxError.
            # QuotaExceededError means the workspace's concurrency limit is full; slots free up.
            retryable = isinstance(e, (RateLimitedError, QuotaExceededError)) or e.retryable
            if not retryable or n == attempts - 1:
                raise
            await asyncio.sleep(base * 2**n * random.uniform(0.5, 1.5))


@dataclass
class Golden:
    snapshot: object
    sandbox_id: str
    setup_s: float  # create -> ready, then the setup script
    snapshot_s: float  # snapshot request -> READY
    durable_s: float  # snapshot request -> DURABLE


async def prepare(client: AsyncClient, tags: list[str], durable: bool = True) -> Golden:
    t0 = time.perf_counter()
    sb = await retry(lambda: client.create(
        name="rl-golden", tags=tags, cpu_cores=1, memory_mb=1024, wait=False, max_duration=900))
    try:
        await sb.wait_ready()
        r = await sb.exec("bash", "-c", SETUP, timeout=300)
        if r.exit_code != 0:
            raise RuntimeError(f"setup failed: {r.stderr_text[-500:]}")
        setup_s = time.perf_counter() - t0
        t1 = time.perf_counter()
        # Retry the request and the wait separately: re-sending the request while one is in
        # progress is an error, and waiting is only polling, so it is safe to repeat.
        created = await retry(lambda: client.snapshots.create_async(sb.id, name="rl-golden"))
        snap = await retry(lambda: client.snapshots.wait_ready(created.id))
        snapshot_s = time.perf_counter() - t1
    finally:
        await retry(sb.close_if_open)  # the snapshot outlives the sandbox it came from
    # READY is restorable, but restores are about twice as fast once the snapshot is DURABLE
    # (about 30-60 s later). Wait for it so every episode gets the fast path.
    if durable:
        try:
            snap = await client.snapshots.wait_durable(snap.id)
        except BaseException:
            await client.snapshots.delete(snap.id)
            raise
    return Golden(snap, sb.id, setup_s, snapshot_s, time.perf_counter() - t1)


@dataclass
class Result:
    i: int
    sandbox_id: str = ""
    score: float | None = None
    restore_s: float = 0.0  # create request -> sandbox ready
    run_s: float = 0.0  # policy + scoring
    life_s: float = 0.0  # create request -> terminated: what you pay for
    error: str = ""


async def episode(client: AsyncClient, i: int, snap_id: str, tags: list[str], sem: asyncio.Semaphore) -> Result:
    res, sb = Result(i), None
    async with sem:
        t0 = time.perf_counter()
        try:
            sb = await retry(lambda: client.create(
                name=f"rl-ep-{i}", tags=tags, snapshot_id=snap_id, wait=False, max_duration=600))
            res.sandbox_id = sb.id
            await sb.wait_ready()
            res.restore_s = time.perf_counter() - t0
            t1 = time.perf_counter()
            run = lambda cmd: sb.exec("bash", "-c", cmd, timeout=120)  # noqa: E731
            # The snapshot holds the repo and nothing from any other episode.
            assert (await run("test ! -e episode.txt")).exit_code == 0, "state leaked between episodes"
            await run(f"echo {i} > episode.txt")
            if i % 5 == 4:
                await run("sed -i 's/def __call__/def __broken__/' repo/src/pluggy/_hooks.py")
            test = await run("cd repo && ../venv/bin/python -m pytest -q -x -p no:cacheprovider testing")
            res.score = 1.0 if test.exit_code == 0 else 0.0
            res.run_s = time.perf_counter() - t1
        except Exception as e:  # one bad episode must not sink the batch
            res.error = f"{type(e).__name__}: {e}"[:200]
        finally:
            if sb is not None:
                try:
                    await retry(sb.close_if_open)
                except Exception as e:
                    res.error += f" | TEARDOWN FAILED: {e}"
            res.life_s = time.perf_counter() - t0
    return res


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, round(p * (len(xs) - 1)))] if xs else 0.0


def report(results: list[Result], g: Golden, wall: float, conc: int, rates: tuple[float, float, float]):
    done = [r for r in results if r.score is not None]
    sb_s = sum(r.life_s for r in results)
    snap = g.snapshot
    print(f"\nepisodes {len(results)}  scored {len(done)}  failed {len(results) - len(done)}  "
          f"mean score {statistics.mean(r.score for r in done) if done else 0:.2f}  concurrency {conc}")
    print(f"prepare (once, not per episode): setup {g.setup_s:.1f}s, snapshot ready {g.snapshot_s:.1f}s, "
          f"durable {g.durable_s:.1f}s")
    print(f"{'seconds':<26}{'p50':>8}{'p95':>8}{'max':>8}")
    for name, xs in (("restore (create->ready)", [r.restore_s for r in done]),
                     ("policy + scoring", [r.run_s for r in done]),
                     ("sandbox lifetime", [r.life_s for r in results])):
        print(f"{name:<26}{pct(xs, .5):>8.1f}{pct(xs, .95):>8.1f}{max(xs, default=0):>8.1f}")
    prep_s = g.setup_s + g.snapshot_s  # the golden sandbox ends once the snapshot is READY
    print(f"wall time {wall:.1f}s   sandbox-seconds {sb_s:.0f} episodes + {prep_s:.0f} prepare")
    cpu, mem, disk = snap.cpu_cores, snap.memory_mb / 1024, max(0, snap.disk_size_gb - 5)
    per_s = cpu * rates[0] + mem * rates[1] + disk * rates[2]
    print(f"each sandbox: {cpu} vCPU, {mem:g} GiB, {snap.disk_size_gb} GiB disk")
    if per_s:
        print(f"cost at the rates you passed: ${(sb_s + prep_s) * per_s:.4f} total, "
              f"${sb_s / max(1, len(results)) * per_s:.5f} per episode (excludes snapshot storage)")
    else:
        print("cost: pass --vcpu-rate/--mem-rate/--disk-rate (see https://tenki.cloud/pricing)")


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("-n", "--episodes", type=int, default=50)
    ap.add_argument("--concurrency", type=int, help="default: free slots in the workspace's limit")
    ap.add_argument("--tag", default="rl-rollouts")
    ap.add_argument("--no-durable", action="store_true", help="start episodes once the snapshot is READY")
    for k in ("vcpu", "mem", "disk"):
        ap.add_argument(f"--{k}-rate", type=float, default=float(os.environ.get(f"TENKI_{k.upper()}_RATE", 0)),
                        help=f"USD per second ({'per GiB, ' if k != 'vcpu' else 'per vCPU, '}env TENKI_{k.upper()}_RATE)")
    a = ap.parse_args()
    resolve_token()
    async with AsyncClient() as client:
        limit = next((u for u in await client.get_usage() if u.key == "max_concurrent_jobs"), None)
        free = (limit.max - limit.current) if limit and limit.max else a.episodes
        conc = max(1, min(a.episodes, a.concurrency or free))
        tags = [a.tag, f"run-{uuid.uuid4().hex[:8]}"]  # the second tag is this run's alone
        golden = None
        try:
            golden = await prepare(client, tags, not a.no_durable)
            sem, t0 = asyncio.Semaphore(conc), time.perf_counter()
            results = await asyncio.gather(*(episode(client, i, golden.snapshot.id, tags, sem)
                                             for i in range(a.episodes)))
            wall = time.perf_counter() - t0
        finally:
            # Backstop: anything of ours still running (interrupt, failed teardown) ends here.
            for s in await retry(lambda: client.list(tags=tags[1:])):
                await retry(s.close_if_open)
            if golden:
                await retry(lambda: client.snapshots.delete(golden.snapshot.id))
        report(results, golden, wall, conc, (a.vcpu_rate, a.mem_rate, a.disk_rate))
        for r in results:
            if r.error:
                print(f"episode {r.i}: {r.error}")
    return 0 if all(r.score is not None for r in results) else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
