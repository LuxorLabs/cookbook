"""
Verify the Tinker + Harbor example without a Tinker or model key. On a live Tenki VM:
  1. TenkiSandbox builds a task's Dockerfile and satisfies tinker-cookbook's SandboxInterface,
  2. commands, file writes and reads, exit codes and timeouts behave as the recipe expects, and
  3. the recipe's own HarborReward grades the task 0.0 before the fix and 1.0 after it,
and the VM is terminated at the end.
"""
import asyncio, os, re, sys, tempfile  # noqa: E401
from pathlib import Path

from tenki import AsyncClient
from tinker_cookbook.recipes.harbor_rl.harbor_tools import HarborReward
from tinker_cookbook.sandbox import SandboxInterface

from tinker_tenki import tenki_sandbox_factory


def cfg(key):
    try:
        text = open(os.path.expanduser("~/.config/tenki/config.yaml")).read()
        return re.search(rf"^{key}:\s*(.+)$", text, re.M).group(1).strip()
    except (OSError, AttributeError):
        return ""


token = os.environ.get("TENKI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN") or cfg("auth_token")
if not token:
    print("No token. Set TENKI_API_KEY, or run `tenki login`.")
    sys.exit(1)
os.environ["TENKI_API_KEY"] = token

TEST_SH = """#!/bin/bash
mkdir -p /logs/verifier
[ "$(cat /app/hello.txt 2>/dev/null)" = hello ] && echo 1 > /logs/verifier/reward.txt || echo 0 > /logs/verifier/reward.txt
"""


async def main():
    with tempfile.TemporaryDirectory() as tmp:
        # A Harbor-format task: environment/Dockerfile + tests/test.sh.
        env_dir, tests_dir = Path(tmp, "env"), Path(tmp, "tests")
        env_dir.mkdir(), tests_dir.mkdir()
        (env_dir / "Dockerfile").write_text("FROM python:3.12-slim\nWORKDIR /app\n")
        (tests_dir / "test.sh").write_text(TEST_SH)

        sb = await tenki_sandbox_factory(env_dir, 600)
        try:
            assert isinstance(sb, SandboxInterface), "not a SandboxInterface"
            assert (await sb.run_command("pwd")).stdout.strip() == "/app", "Dockerfile WORKDIR ignored"
            assert (await sb.run_command("exit 3")).exit_code == 3
            assert (await sb.run_command("sleep 30", timeout=3)).exit_code == -1, "timeout not reported"

            payload = b"x" * (3 * 1024 * 1024)
            await sb.write_file("/tmp/a dir/big.sh", payload, executable=True)
            assert (await sb.run_command("wc -c < '/tmp/a dir/big.sh'")).stdout.strip() == str(len(payload))
            assert (await sb.run_command("test -x '/tmp/a dir/big.sh'")).exit_code == 0
            assert (await sb.read_file("/tmp/a dir/big.sh", max_bytes=5)).stdout == "xxxxx"

            reward = HarborReward(tests_dir=tests_dir, sandbox=sb)
            before, _ = await reward([])
            await sb.run_command("echo hello > /app/hello.txt")  # the "oracle" action
            after, _ = await reward([])
            assert (before, after) == (0.0, 1.0), f"reward before/after = {before}/{after}"
            print(f"✓ built the task, ran commands, graded {before} -> {after} on sandbox {sb.sandbox_id}")
        finally:
            await sb.cleanup()

    sessions = await AsyncClient().list(tags=["tinker-rl"], include_terminated=True)
    state = next((s.info.state for s in sessions if s.info.id == sb.sandbox_id), None)
    assert state in {"TERMINATING", "TERMINATED"}, f"sandbox state after cleanup: {state}"
    print("✓ sandbox terminated")


asyncio.run(main())
