"""
Verify the Harbor walkthrough without a model key:
  1. `tenki_harbor.TenkiEnvironment` imports and is a Harbor environment, and
  2. a real Harbor trial runs on Tenki: Harbor's hello-world task with the
     `oracle` agent (the task's reference solution), graded by the task's own
     tests -> reward 1.0, and the trial's Tenki session is terminated after.
"""
import asyncio, glob, json, os, re, shutil, subprocess, sys, tempfile  # noqa: E401

from harbor.environments.base import BaseEnvironment
from tenki import AsyncClient
from tenki_harbor import TenkiEnvironment


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
# tenki-harbor only reads the environment (its preflight checks TENKI_API_KEY).
os.environ["TENKI_API_KEY"] = token


async def session_state(trial_name):
    sessions = await AsyncClient().list(tags=["harbor"], include_terminated=True)
    for s in sessions:
        # Harbor names the environment session `<trial>__env`.
        sid = s.info.metadata.get("harbor_session_id", "")
        if sid == trial_name or sid.startswith(trial_name + "__"):
            return s.info.state
    return None


try:
    assert issubclass(TenkiEnvironment, BaseEnvironment) and TenkiEnvironment.type() == "tenki"

    harbor = os.path.join(os.path.dirname(sys.executable), "harbor")
    if not os.path.exists(harbor):
        harbor = shutil.which("harbor") or "harbor"
    with tempfile.TemporaryDirectory() as jobs:
        cmd = [harbor, "run", "-t", "hello-world/hello-world",
               "-e", "tenki_harbor:TenkiEnvironment", "--agent", "oracle", "-o", jobs]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        if r.returncode != 0:
            raise RuntimeError(f"harbor run exited {r.returncode}:\n{(r.stdout + r.stderr)[-2000:]}")

        trials = glob.glob(os.path.join(jobs, "*", "hello-world__*", "result.json"))
        if len(trials) != 1:
            raise AssertionError(f"expected 1 trial result, found {len(trials)}")
        with open(trials[0]) as f:
            trial = json.load(f)
        reward = ((trial.get("verifier_result") or {}).get("rewards") or {}).get("reward")
        if trial.get("exception_info") or reward != 1.0:
            raise AssertionError(f"reward {reward!r} (expected 1.0), exception_info: {trial.get('exception_info')}")

    state = asyncio.run(session_state(trial["trial_name"]))
    if state not in {"TERMINATING", "TERMINATED"}:
        raise AssertionError(f"Tenki session for {trial['trial_name']} is {state!r}, expected terminated")

    print(f"✓ harbor-tenki: TenkiEnvironment loads → harbor run hello-world (oracle) on a Tenki VM → reward {reward} → session {state.lower()}")
except Exception as e:  # noqa: BLE001
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
