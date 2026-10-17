"""
Smoke-verify the Prefect example without a Prefect server:
  1. `prefect-tenki` imports and registers the "tenki" worker type, and
  2. `TenkiWorker.run()` drives the real per-flow-run infrastructure lifecycle
     against live Tenki — create microVM → run command → teardown — exit 0.

We deliberately do NOT execute a full flow run: the guest must reach the
Prefect API, and a localhost `prefect server` is unreachable from inside the
microVM. Driving run() directly is the upstream repo's own smoke pattern
(tests/live_worker_smoke.py) and exercises everything Tenki-specific.

Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
"""
import logging
import os
import sys
import tempfile

# Keep ~/.prefect untouched — prefect writes its profile/db under PREFECT_HOME.
os.environ.setdefault("PREFECT_HOME", tempfile.mkdtemp(prefix="prefect-tenki-verify-"))

import anyio
from tenki import AsyncClient

from prefect_tenki import TenkiCredentials, TenkiWorker, TenkiWorkerJobConfiguration

assert TenkiWorker.type == "tenki", TenkiWorker.type  # the work-pool type name


def cfg(key):
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return ""


token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or cfg("auth_token")
if not token:
    print("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.")
    sys.exit(1)

# SDK auth gap: a bare `tenki login` session token is sent as Bearer (rejected);
# prefix it `cookie:` so it goes as a cookie. A `tk_` API key works as-is.
if not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"


async def main():
    credentials = TenkiCredentials(api_key=token)

    workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
    if not workspace_id:
        async with AsyncClient(**credentials.get_client_options()) as client:
            workspaces = list((await client.who_am_i()).workspaces)
        if len(workspaces) != 1:
            raise RuntimeError(f"{len(workspaces)} workspaces accessible; set TENKI_WORKSPACE_ID.")
        workspace_id = workspaces[0].id

    # Same shape a `prefect worker start` builds per flow run, minus the
    # Prefect-prepared `prefect flow-run execute` command.
    configuration = TenkiWorkerJobConfiguration(
        name="prefect-tenki-verify",
        command="set -eu; test \"$(python3 -c 'print(6*7)')\" = \"42\"; echo ok",
        credentials=credentials,
        workspace_id=workspace_id,
        cpu_cores=1,
        memory_mb=1024,
        allow_inbound=False,
        allow_outbound=False,
        max_duration_seconds=120,
        create_timeout_seconds=180,
        command_timeout_seconds=60,
        stream_output=True,
    )
    worker = TenkiWorker(work_pool_name="prefect-tenki-verify")
    result = await worker.run(object(), configuration)
    if result.status_code != 0:
        raise AssertionError(f"exit {result.status_code} (sandbox {result.identifier})")
    print("✓ prefect-tenki: TenkiWorker.run() → live microVM → flow command exit 0 → teardown")


logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
try:
    anyio.run(main)
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
