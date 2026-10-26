"""Check the Hermes Tenki terminal backend against the live Tenki API.

Prints a PASS or FAIL line per check and exits 0 only if every check passes.
Needs TENKI_API_KEY and a checkout from ./setup.sh. No model key: this drives
the terminal backend, not the agent loop.
"""

import json
import os
import sys
import traceback
import uuid
from pathlib import Path

from hermes_env import bootstrap, teardown

bootstrap()

from tools.environments.tenki import TenkiEnvironment  # noqa: E402
from tools.terminal_tool import check_terminal_requirements  # noqa: E402

FAILURES: list[str] = []
CHECKS = 0
# Small VMs with a hard 10-minute cap, so nothing outlives a crashed run.
SIZE = dict(cpu=1, memory=2048, disk=10240, max_duration=600)


def check(label, actual, expected, match="eq"):
    global CHECKS
    CHECKS += 1
    ok = actual == expected if match == "eq" else expected in actual
    print(f"  {'PASS' if ok else 'FAIL'}  {label}")
    if not ok:
        print(f"          expected ({match}): {expected!r}\n          actual: {actual!r}")
        FAILURES.append(label)


def run_checks(task_id: str, persistent_id: str) -> None:
    print("[1] Hermes offers the tenki backend")
    check("check_terminal_requirements() is True", check_terminal_requirements(), True)

    print("\n[2] Ephemeral sandbox")
    env = TenkiEnvironment(task_id=task_id, persistent_filesystem=False, **SIZE)
    try:
        sandbox_id = env._sandbox.id
        print(f"  sandbox {sandbox_id}")
        check("cwd is the sandbox home", env.cwd, "/home/tenki")
        r = env.execute("echo hello-from-tenki")
        check("command returns 0", r["returncode"], 0)
        check("stdout comes back", r["output"], "hello-from-tenki", match="in")
        check("exit 7 comes back as 7", env.execute("exit 7")["returncode"], 7)
        check("stderr is in the output", env.execute("echo oops >&2")["output"], "oops", match="in")
        env.execute("mkdir -p project && cd project")
        check("cwd carries across calls", env.execute("pwd")["output"].strip(), "/home/tenki/project")
        payload = "line-one\nline-two\n"
        check("stdin write returns 0", env.execute("cat > /home/tenki/stdin.txt", stdin_data=payload)["returncode"], 0)
        check("stdin arrives byte for byte",
              env.execute("wc -c < /home/tenki/stdin.txt")["output"].strip(), str(len(payload)))
    finally:
        env.cleanup()

    print("\n[3] cleanup() terminates an ephemeral sandbox")
    from tenki_sandbox import Client
    client = Client()
    try:
        check("state after cleanup", client.get(sandbox_id).state in ("TERMINATING", "TERMINATED"), True)
    finally:
        client.close()

    print("\n[4] Persistence: snapshot on cleanup, restore on the next session")
    first = TenkiEnvironment(task_id=persistent_id, persistent_filesystem=True, **SIZE)
    try:
        first_id = first._sandbox.id
        first.execute("echo survives-the-session > /home/tenki/notes.txt")
    finally:
        first.cleanup()
    store = Path(os.environ["HERMES_HOME"]) / "tenki_snapshots.json"
    saved = json.loads(store.read_text()) if store.is_file() else {}
    check("cleanup() saved a snapshot pointer", any(persistent_id in key for key in saved), True)

    second = TenkiEnvironment(task_id=persistent_id, persistent_filesystem=True, **SIZE)
    try:
        print(f"  first sandbox {first_id}, restored into {second._sandbox.id}")
        check("the file survived", second.execute("cat /home/tenki/notes.txt")["output"],
              "survives-the-session", match="in")
    finally:
        second.cleanup()


def main() -> int:
    task_id = f"verify-{uuid.uuid4().hex[:8]}"
    persistent_id = f"{task_id}-p"
    print(f"Hermes x Tenki terminal backend (task {task_id})\n")
    try:
        run_checks(task_id, persistent_id)
    except Exception:
        traceback.print_exc()
        FAILURES.append("raised before finishing")
    finally:
        print("\nCleaning up")
        teardown([task_id, persistent_id])

    print("\n" + "=" * 60)
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} of {CHECKS} checks")
        return 1
    print(f"OK: all {CHECKS} checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
