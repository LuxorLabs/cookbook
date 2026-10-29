"""
Proves the two-sandbox setup against live Tenki, with no model key:
  1. the judge installs hills, freezes circle-packing and serves judge.py on a preview URL;
  2. the climber has no hills install, state or key;
  3. an /eval without the bearer token is refused;
  4. the climber's submit.sh scores the hill's example packing: PASSED, sum_radii 2.5414,
     signed for the frozen tree hash, tied to the submission's git commit, with the key
     on the judge only;
  5. the judge confirms that report's signature, and rejects it once the score is edited.
Both sandboxes are terminated either way.
"""
import json
import secrets
import sys
import urllib.error
import urllib.request

from climb import HILL, auth, create, seed_climber, start_judge

if not auth()["auth_token"]:
    print("No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.")
    sys.exit(1)


def post(url, data, token=None):
    req = urllib.request.Request(url, data=data, method="POST")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.load(e)


token = secrets.token_urlsafe(24)
try:
    with create("judge", 0.5, cpu_cores=2, memory_mb=4096) as judge, \
         create("climber", 0.5, cpu_cores=2, memory_mb=4096) as climber:
        url, tree_hash = start_judge(judge, token)
        print(f"  judge: {HILL} @ {tree_hash[:12]} on {url}")
        seed_climber(climber, judge, url, token)

        assert climber.shell("test -e ~/.autolab || command -v hills").exit_code != 0, "climber can see hills state"

        status, _ = post(f"{url}/eval", b"")
        assert status == 401, f"/eval without a token answered {status}, expected 401"

        r = climber.shell("cd climb && ./submit.sh submission")
        assert r.exit_code == 0, f"submit.sh failed: {r.stderr_text[-800:]}"
        report = json.loads(r.stdout_text)
        score = {m["name"]: m["value"] for m in report["metrics"]}
        assert report["passed"] and abs(score["sum_radii"] - 2.5414) < 1e-3, f"unexpected report: {report}"
        assert report["tree_hash"] == tree_hash and report["official"], f"not an official score for {tree_hash}"
        head = climber.shell("git -C climb/submission rev-parse --short HEAD").stdout_text.strip()
        assert head in (report["submission_git"] or ""), f"submission_git {report['submission_git']!r}, HEAD {head}"
        # hills creates its signing key at the first eval; it never leaves the judge.
        assert judge.shell("test -s ~/.autolab/hills/key").exit_code == 0, "judge has no signing key"
        print(f"  climber: submit.sh → {r.stderr_text.strip()}")

        status, ok = post(f"{url}/verify", json.dumps(report).encode(), token)
        assert status == 200 and ok["valid"], f"signature rejected: {ok}"
        report["metrics"][0]["value"] = 2.9
        status, bad = post(f"{url}/verify", json.dumps(report).encode(), token)
        assert status == 200 and not bad["valid"], f"edited report still verified: {bad}"

    print(f"✓ hills-tenki: judge freezes {HILL} → climber has no key → no token: 401 → "
          f"submit.sh: PASSED sum_radii={score['sum_radii']} signed @ {tree_hash[:12]} → "
          "signature valid → edited score: invalid")
except Exception as e:  # noqa: BLE001
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
