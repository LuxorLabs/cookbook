"""Run Hermes' shell tool in a Tenki sandbox, end the session, then pick it up again.

    ./setup.sh && pip install -r requirements.txt && python run.py
"""

import uuid

from hermes_env import bootstrap, teardown

bootstrap()

from tools.environments.tenki import TenkiEnvironment  # noqa: E402

SIZE = dict(cpu=1, memory=2048, disk=10240, max_duration=600)


def show(env, command):
    # execute() is what Hermes' terminal tool calls for every shell command.
    result = env.execute(command)
    print(f"$ {command}\n  exit {result['returncode']}: {result['output'].strip()}")


task_id = f"demo-{uuid.uuid4().hex[:8]}"
try:
    # persistent_filesystem=True: cleanup() snapshots the filesystem, then terminates the VM.
    env = TenkiEnvironment(task_id=task_id, persistent_filesystem=True, **SIZE)
    try:
        print(f"Session 1, sandbox {env._sandbox.id}")
        show(env, "uname -srm && whoami && pwd")
        show(env, "python3 -c 'print(sum(range(100)))'")
        show(env, "echo 'notes from session one' > notes.txt")
    finally:
        env.cleanup()

    # Same task_id: the backend restores the snapshot into a new sandbox.
    env = TenkiEnvironment(task_id=task_id, persistent_filesystem=True, **SIZE)
    try:
        print(f"\nSession 2, sandbox {env._sandbox.id}")
        show(env, "cat notes.txt")
    finally:
        env.cleanup()
finally:
    print("\nCleaning up")
    teardown([task_id])
