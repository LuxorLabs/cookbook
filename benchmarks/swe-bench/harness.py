"""Run SWE-bench (Lite / Verified / full) on Tenki Sandboxes — faithfully.

Tenki gives you a stock Ubuntu sandbox (no nested virt), but Docker *containers*
run inside it fine: containers are namespaces, not VMs, so `docker run` works
without /dev/kvm. So we run the canonical, per-instance SWE-bench Docker image
INSIDE a Tenki VM and grade with the official `swebench` eval script — no
from-source reimplementation, no fidelity loss.

Per instance:
  1. create a Tenki VM (disk big enough for one ~2-4 GB image)
  2. install + start docker, pull docker.io/swebench/sweb.eval.x86_64.<iid>
  3. `docker run -d` the image — the repo is checked out at base_commit in /testbed
  4. either apply the gold patch (--oracle) or run an agent against /testbed
  5. run the instance's canonical eval_script in the container and parse
     FAIL_TO_PASS / PASS_TO_PASS with swebench's own log parser -> resolved

`--oracle` validates the whole pipeline WITHOUT a model: the gold patch must
resolve. That is exactly what verify.mjs runs in CI (no model key needed).

Usage:
  # prove the pipeline on one instance, no model:
  python harness.py --dataset lite --instances psf__requests-1963 --oracle

  # run your own model (OpenAI-compatible endpoint) over the first 20:
  python harness.py --dataset lite --limit 20 \
    --model your-model --api-base https://api.openai.com/v1 --api-key-env OPENAI_API_KEY

Requires: swebench, datasets, tenki (see requirements.txt). A model run
also needs `mini-swe-agent` (imported lazily, only for --model).
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import json
import os
import sys
import tempfile
import threading
import time
from datetime import date
from pathlib import Path

from datasets import load_dataset
from swebench.harness.test_spec.test_spec import make_test_spec
from swebench.harness.grading import (
    get_logs_eval, get_eval_tests_report, get_resolution_status, ResolvedStatus,
)
from swebench.harness.constants import FAIL_TO_PASS, PASS_TO_PASS

from tenki_sandbox import Client

# Add a row to run another SWE-bench-family dataset. Anything that ships the
# per-instance `swebench/sweb.eval.x86_64.*` images works with this exact harness;
# a source with a different image prefix also needs its own image_name() (see below).
DATASETS = {
    "lite": "princeton-nlp/SWE-bench_Lite",
    "verified": "princeton-nlp/SWE-bench_Verified",
    "full": "princeton-nlp/SWE-bench",
}

DISK_GB = 32
CID = "swebench"  # container name inside the VM
_print_lock = threading.Lock()


def log(msg: str) -> None:
    with _print_lock:
        print(msg, flush=True)


# ---- Tenki auth ------------------------------------------------------------
# Token/workspace from env (CI: TENKI_API_KEY) or ~/.config/tenki/config.yaml
# (local `tenki login`).

def _cfg(key: str) -> str:
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return ""


def tenki_client() -> tuple[Client, str | None]:
    token = os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or _cfg("auth_token")
    if not token:
        raise SystemExit("No token. Set TENKI_AUTH_TOKEN / TENKI_API_KEY, or run `tenki login`.")
    # A `tk_` API key works as-is; a `tenki login` session token must be sent as a
    # cookie, which the SDK does when you prefix it `cookie:`.
    if not token.startswith(("tk_", "ory_st_", "cookie:")):
        token = f"cookie:{token}"
    client = Client(auth_token=token)
    # None lets the SDK pick the key's default workspace.
    wid = os.environ.get("TENKI_WORKSPACE_ID") or _cfg("current_workspace_id") or None
    return client, wid


# ---- container plumbing ----------------------------------------------------

def image_name(instance_id: str) -> str:
    iid = instance_id.replace("__", "_1776_")
    return f"docker.io/swebench/sweb.eval.x86_64.{iid}:latest".lower()


def _sh(sb, cmd: str, timeout: int = 240) -> tuple[bool, str]:
    """Run a bash command in the Tenki VM (not the container). Returns (ok, output)."""
    r = sb.exec("bash", "-lc", cmd, timeout=timeout)
    return bool(r.ok), (r.stdout_text or "") + (r.stderr_text or "")


def _sh_retry(sb, cmd: str, timeout: int = 240, tries: int = 3, what: str = "cmd") -> tuple[bool, str]:
    """Retry a network-dependent step — fresh sandboxes occasionally race DNS on boot."""
    out = ""
    for i in range(tries):
        ok, out = _sh(sb, cmd, timeout=timeout)
        if ok:
            return True, out
        log(f"    (retry {what}: attempt {i + 1}/{tries} failed: {out.strip()[-120:]})")
        _sh(sb, "sleep 3", timeout=15)
    return False, out


def _dexec(sb, script: str, timeout: int = 600, workdir: str = "/testbed") -> tuple[bool, str]:
    """Run a bash script INSIDE the swebench container. The script is piped in via
    base64 on stdin so quoting/newlines can't corrupt it."""
    b64 = base64.b64encode(script.encode()).decode()
    cmd = f"echo {b64} | base64 -d | sudo docker exec -i -w {workdir} {CID} bash -s"
    return _sh(sb, cmd, timeout=timeout)


def provision(sb, iid: str) -> None:
    """Install docker, pull the instance image, start the container at /testbed."""
    # A freshly-booted sandbox can race DNS — wait for name resolution before apt.
    _sh(sb, "for i in $(seq 1 30); do getent hosts archive.ubuntu.com && break; sleep 1; done",
        timeout=60)
    ok, out = _sh_retry(sb, "sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive "
                            "apt-get install -y -qq docker.io 2>&1 | tail -1 && "
                            "sudo service docker start 2>&1 | tail -1 && sleep 2 && docker --version",
                        timeout=420, what="apt/docker")
    if not ok:
        raise RuntimeError(f"docker install failed: {out[-300:]}")
    img = image_name(iid)
    ok, out = _sh_retry(sb, f"sudo docker pull {img}", timeout=900, what="pull")
    if not ok:
        raise RuntimeError(f"image pull failed for {img}: {out[-300:]}")
    ok, out = _sh(sb, f"sudo docker rm -f {CID} 2>/dev/null; "
                      f"sudo docker run -d --name {CID} {img} tail -f /dev/null && "
                      f"sudo docker exec {CID} bash -lc 'cd /testbed && git rev-parse HEAD'",
                  timeout=180)
    if not ok:
        raise RuntimeError(f"container start failed: {out[-300:]}")


def apply_gold(sb, patch: str) -> None:
    """Oracle mode: apply the gold solution patch to /testbed inside the container."""
    ok, out = _dexec(sb, "git config --global --add safe.directory /testbed\n"
                         "cat > /tmp/gold.patch <<'TENKI_EOF'\n" + patch + "\nTENKI_EOF\n"
                         "git apply -v /tmp/gold.patch && echo GOLD_APPLIED")
    if not ok or "GOLD_APPLIED" not in out:
        raise RuntimeError(f"gold patch did not apply: {out[-400:]}")


def grade(sb, test_spec) -> tuple[bool, dict]:
    """Run the canonical eval_script in the container; parse resolved status."""
    ok, out = _dexec(sb, test_spec.eval_script, timeout=1200, workdir="/")
    with tempfile.NamedTemporaryFile("w", suffix=".log", delete=False) as f:
        f.write(out)
        log_fp = f.name
    status_map, found = get_logs_eval(test_spec, log_fp)
    if not found:
        return False, {"error": "no test output parsed", "tail": out[-500:]}
    report = get_eval_tests_report(
        status_map,
        {FAIL_TO_PASS: test_spec.FAIL_TO_PASS, PASS_TO_PASS: test_spec.PASS_TO_PASS},
    )
    resolved = get_resolution_status(report) == ResolvedStatus.FULL.value
    f2p, p2p = report[FAIL_TO_PASS], report[PASS_TO_PASS]
    return resolved, {
        "resolved": resolved,
        "fail_to_pass": {"passed": len(f2p["success"]), "total": len(f2p["success"]) + len(f2p["failure"])},
        "pass_to_pass": {"passed": len(p2p["success"]), "total": len(p2p["success"]) + len(p2p["failure"])},
    }


# ---- agent mode (optional; needs mini-swe-agent + a model key) --------------

class _ContainerEnv:
    """mini-SWE-agent environment: every action runs in the container at /testbed."""

    def __init__(self, sb):
        self.sb = sb
        # SWE-bench test suites can be slow — a low per-command cap reads as a
        # model failure. Give agent commands real headroom.
        self.config = type("C", (), {"cwd": "/testbed", "timeout": 600})()

    def execute(self, command: str, cwd: str = "") -> dict:
        ok, out = _dexec(self.sb, command, timeout=self.config.timeout, workdir=cwd or "/testbed")
        return {"output": out, "returncode": 0 if ok else 1}

    def get_template_vars(self) -> dict:
        return {"cwd": "/testbed"}


def run_agent(sb, instance: dict, model_id: str, api_base: str, api_key_env: str) -> None:
    """Drive mini-SWE-agent against /testbed inside the container, against any
    OpenAI-compatible endpoint (bring your own model + key)."""
    import glob
    import yaml
    from minisweagent.agents.default import DefaultAgent
    from minisweagent.models import get_model
    import minisweagent

    cfg = {"model_name": "openai/" + model_id, "model_kwargs": {
        "api_base": api_base, "api_key": os.environ[api_key_env],
        "temperature": 0.0, "max_tokens": 16000}}
    # Reasoning models that stream their thoughts on a separate channel need the
    # text-based litellm shim, or the parser can drop the answer. OpenRouter is the
    # common case; flip this on for your endpoint if answers come back empty.
    if "openrouter.ai" in api_base:
        cfg["model_class"] = "litellm_textbased"
    model = get_model("openai/" + model_id, config=cfg)

    # mini-SWE-agent ships a swebench agent config (system/instance templates telling
    # the model it's in /testbed and to edit in place). Reuse it for fidelity.
    root = Path(minisweagent.__file__).resolve().parent
    cfgs = glob.glob(str(root / "**" / "swebench.yaml"), recursive=True)
    tmpl = yaml.safe_load(Path(cfgs[0]).read_text())["agent"] if cfgs else {}

    agent = DefaultAgent(model, _ContainerEnv(sb),
                         system_template=tmpl.get("system_template"),
                         instance_template=tmpl.get("instance_template"),
                         step_limit=int(tmpl.get("step_limit", 40)),
                         cost_limit=float(tmpl.get("cost_limit", 5.0)))
    try:
        agent.run(instance["problem_statement"])
    except Exception as e:  # agent loops raise on submit/limits — grading still runs
        log(f"    (agent stop: {type(e).__name__}: {str(e)[:120]})")


# ---- one instance, end to end ----------------------------------------------

def run_one(instance: dict, *, oracle: bool = False, model_id: str | None = None,
            api_base: str = "", api_key_env: str = "", keep: bool = False) -> dict:
    iid = instance["instance_id"]
    test_spec = make_test_spec(instance)
    client, wid = tenki_client()
    t0 = time.time()
    sb = client.create(name=f"swe-{iid[:32]}", workspace_id=wid, cpu_cores=2,
                       memory_mb=4096, max_duration=1800, disk_size_gb=DISK_GB)
    try:
        log(f"  [{iid}] provisioning (pull {image_name(iid).split('/')[-1]}) …")
        provision(sb, iid)
        if oracle:
            apply_gold(sb, instance["patch"])
            mode = "oracle"
        elif model_id:
            log(f"  [{iid}] running agent {model_id} …")
            run_agent(sb, instance, model_id, api_base, api_key_env)
            mode = model_id
        else:
            mode = "empty"  # no edit -> must NOT resolve (negative control)
        resolved, detail = grade(sb, test_spec)
        dt = time.time() - t0
        log(f"  [{iid}] {mode:16} resolved={resolved}  "
            f"F2P {detail.get('fail_to_pass')}  P2P {detail.get('pass_to_pass')}  ({dt:.0f}s)")
        return {"instance_id": iid, "mode": mode, "resolved": resolved, "seconds": round(dt), **detail}
    except Exception as e:
        log(f"  [{iid}] ERROR {type(e).__name__}: {str(e)[:200]}")
        return {"instance_id": iid, "mode": "error", "resolved": None,
                "error": f"{type(e).__name__}: {str(e)[:200]}"}
    finally:
        if not keep:
            try:
                sb.terminate()
            except Exception:
                pass


def load_instances(dataset: str, instances: list[str] | None, limit: int | None) -> list[dict]:
    if dataset not in DATASETS:
        raise SystemExit(f"unknown dataset {dataset}; known: {', '.join(DATASETS)}")
    rows = list(load_dataset(DATASETS[dataset], split="test"))
    if instances:
        want = set(instances)
        rows = [r for r in rows if r["instance_id"] in want]
        if miss := want - {r["instance_id"] for r in rows}:
            raise SystemExit(f"unknown instance id(s): {', '.join(sorted(miss))}")
    if limit:
        rows = rows[:limit]
    if not rows:
        raise SystemExit("no instances selected")
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description="Run SWE-bench on Tenki Sandboxes.")
    ap.add_argument("--dataset", choices=list(DATASETS), default="lite")
    ap.add_argument("--instances", nargs="*", help="explicit instance ids")
    ap.add_argument("--limit", type=int, help="first N instances")
    ap.add_argument("--oracle", action="store_true", help="apply the gold patch (no model) — must resolve")
    ap.add_argument("--model", help="model id on an OpenAI-compatible endpoint (needs mini-swe-agent)")
    ap.add_argument("--api-base", default="https://api.openai.com/v1", help="OpenAI-compatible base URL")
    ap.add_argument("--api-key-env", default="OPENAI_API_KEY", help="env var holding the model API key")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--keep", action="store_true", help="don't terminate VMs (debug)")
    ap.add_argument("--out", default="swebench-tenki.json")
    a = ap.parse_args()

    rows = load_instances(a.dataset, a.instances, a.limit)
    mode = "oracle" if a.oracle else (a.model or "empty")
    log(f"SWE-bench/{a.dataset} on Tenki: {len(rows)} instance(s), {a.workers} workers, mode={mode}")

    results = []
    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(run_one, r, oracle=a.oracle, model_id=a.model,
                          api_base=a.api_base, api_key_env=a.api_key_env, keep=a.keep)
                for r in rows]
        for fut in cf.as_completed(futs):
            results.append(fut.result())

    resolved = [r for r in results if r.get("resolved") is True]
    errs = [r for r in results if r.get("mode") == "error"]
    log(f"\n=== {len(resolved)}/{len(results)} resolved · {len(errs)} errored ===")
    Path(a.out).write_text(json.dumps(
        {"generatedAt": str(date.today()), "dataset": a.dataset, "backend": "tenki",
         "resolvedRate": round(100 * len(resolved) / max(1, len(results) - len(errs)), 1),
         "results": results}, indent=2) + "\n")
    log(f"Wrote {a.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
