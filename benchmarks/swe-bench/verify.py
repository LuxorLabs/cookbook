"""Proves the Tenki-facing half of this benchmark, with NO model key.

Oracle one real SWE-bench Lite instance on a live Tenki sandbox: boot a sandbox,
run the canonical per-instance Docker image inside it, apply the gold patch, and
grade with swebench's own eval script. The gold patch MUST resolve — if it does,
the whole pipeline (VM -> docker-in-VM -> official grading) works on Tenki.

A model run (harness.py --model ...) is the same pipeline with an agent in place
of the gold patch; that needs a model key and time, so it stays out of CI.

Needs: swebench, datasets, tenki (requirements.txt). Token/workspace from
env (CI: TENKI_API_KEY) or ~/.config/tenki/config.yaml (local `tenki login`).
"""
import sys

from harness import cleanup, ignore_signals, raise_on_sigterm, load_instances, run_one

# A small, HERMETIC instance (Flask — no live-network tests), so the oracle is
# deterministic in CI: 1 FAIL_TO_PASS + 18 PASS_TO_PASS, all turned green by the
# gold patch, ~60s. (Avoid instances whose suites hit external services — e.g.
# `psf__requests-*` calls httpbin, so its oracle flaps run to run.)
INSTANCE = "pallets__flask-4992"

raise_on_sigterm()
ok = False
try:
    [instance] = load_instances("lite", [INSTANCE], None)
    r = run_one(instance, oracle=True)
    if r.get("teardown_error"):
        raise RuntimeError(f"sandbox teardown failed: {r['teardown_error']}")
    if r.get("resolved") is not True:
        raise AssertionError(f"gold patch did not resolve {INSTANCE}: {r}")
    ok = True
except (Exception, KeyboardInterrupt) as e:  # noqa: BLE001
    print(f"✗ {type(e).__name__}: {e}")
finally:
    ignore_signals()
    # run_one terminates its own sandbox; this catches one created by a create call
    # that Ctrl-C or SIGTERM interrupted, and any retry that is still pending.
    if leftovers := cleanup():
        print(f"✗ sandbox(es) may still be RUNNING: {', '.join(leftovers)}")
        ok = False
if not ok:
    sys.exit(1)
print(f"✓ swe-bench: oracle {INSTANCE} on Tenki → resolved "
      f"(F2P {r['fail_to_pass']}, P2P {r['pass_to_pass']}, {r['seconds']}s)")
