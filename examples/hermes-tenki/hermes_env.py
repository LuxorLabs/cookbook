"""Shared setup for run.py and verify.py.

The Tenki terminal backend is tools/environments/tenki.py inside a Hermes
checkout (setup.sh fetches it). This module puts that checkout on sys.path,
gives the run a throwaway HERMES_HOME, and removes what the run leaves behind.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

CHECKOUT = Path(os.getenv("HERMES_REPO") or Path(__file__).resolve().parent / "hermes-agent")


def bootstrap() -> None:
    """Call before importing anything from Hermes."""
    if not (CHECKOUT / "tools" / "environments" / "tenki.py").is_file():
        raise SystemExit(f"No Hermes checkout with the Tenki backend at {CHECKOUT}. Run ./setup.sh first.")
    if not (os.getenv("TENKI_API_KEY") or os.getenv("TENKI_AUTH_TOKEN")):
        raise SystemExit("Set TENKI_API_KEY (tk_...). TENKI_AUTH_TOKEN also works.")
    sys.path.insert(0, str(CHECKOUT))
    # The backend writes snapshot pointers to $HERMES_HOME/tenki_snapshots.json.
    # A scratch home keeps this run away from your real ~/.hermes.
    os.environ["HERMES_HOME"] = tempfile.mkdtemp(prefix="hermes-tenki-")
    os.environ["TERMINAL_ENV"] = "tenki"


def teardown(task_ids: list[str]) -> None:
    """Terminate this run's sandboxes and delete the snapshots it saved.

    cleanup() on a persistent environment snapshots the filesystem and keeps the
    snapshot so the next session can restore it. A demo shouldn't leave either
    a sandbox or a stored snapshot behind.
    """
    from tenki_sandbox import Client

    client = Client()
    try:
        for sandbox in client.list(tags=["hermes-agent"]):
            metadata = getattr(sandbox.info, "metadata", None) or {}
            if metadata.get("hermes_task_id") in task_ids and sandbox.state not in ("TERMINATING", "TERMINATED"):
                sandbox.close()
                print(f"  terminated sandbox {sandbox.id}")
        # The pointer file holds only the latest snapshot per task; an earlier one
        # that a later session replaced is still stored, so match on the name too.
        # The backend names snapshots after the sandbox: hermes-<profile>-<task_id>.
        store = Path(os.environ["HERMES_HOME"]) / "tenki_snapshots.json"
        pointers = set(json.loads(store.read_text()).values()) if store.is_file() else set()
        for snapshot in client.snapshots.list():
            if snapshot.id in pointers or any((snapshot.name or "").endswith(f"-{t}") for t in task_ids):
                client.snapshots.delete(snapshot.id)
                print(f"  deleted snapshot {snapshot.id}")
    finally:
        client.close()
