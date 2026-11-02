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

  # no-edit control (neither --oracle nor --model): nothing may resolve
  python harness.py --dataset lite --limit 20

  # run your own model (OpenAI-compatible endpoint) over the first 20:
  python harness.py --dataset lite --limit 20 \
    --model your-model --api-base https://api.openai.com/v1 --api-key-env OPENAI_API_KEY

Requires: swebench, datasets, tenki (see requirements.txt). A model run
also needs `mini-swe-agent>=2.4.6,<3` (imported lazily, only for --model).
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures as cf
import json
import os
import shlex
import signal
import sys
import tempfile
import threading
import time
import uuid
from datetime import date
from pathlib import Path

from datasets import load_dataset
from swebench.harness.test_spec.test_spec import make_test_spec
from swebench.harness.grading import (
    get_logs_eval, get_eval_tests_report, get_resolution_status, ResolvedStatus,
)
from swebench.harness.constants import FAIL_TO_PASS, PASS_TO_PASS

from tenki_sandbox import Client, WaitReadyFailedError

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


def _dexec_cmd(script: str, workdir: str = "/testbed", env: dict[str, str] | None = None) -> str:
    """The VM-side command that runs a bash script INSIDE the swebench container. The
    script is piped in via base64 on stdin so quoting/newlines can't corrupt it."""
    b64 = base64.b64encode(script.encode()).decode()
    envs = "".join(f" -e {shlex.quote(f'{k}={v}')}" for k, v in (env or {}).items())
    return f"echo {b64} | base64 -d | sudo docker exec -i{envs} -w {workdir} {CID} bash -s"


def _dexec(sb, script: str, timeout: int = 600, workdir: str = "/testbed") -> tuple[bool, str]:
    """Run a bash script INSIDE the swebench container."""
    return _sh(sb, _dexec_cmd(script, workdir), timeout=timeout)


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
    """mini-SWE-agent 2.x environment: every action runs in the container at /testbed.

    2.x passes each action as a dict ({"command": ...}) and expects the env to raise
    Submitted when the agent prints the submit marker (see LocalEnvironment)."""

    def __init__(self, sb, *, cwd: str = "/testbed", timeout: int = 600, env: dict | None = None):
        self.sb = sb
        # SWE-bench test suites can be slow — a low per-command cap reads as a
        # model failure. Give agent commands real headroom.
        self.config = type("C", (), {"cwd": cwd, "timeout": timeout, "env": env or {}})()

    def execute(self, action: dict, cwd: str = "", *, timeout: int | None = None) -> dict:
        from minisweagent.exceptions import Submitted

        try:
            r = self.sb.exec("bash", "-lc", _dexec_cmd(action.get("command", ""), cwd or self.config.cwd,
                                                       self.config.env),
                             timeout=timeout or self.config.timeout)
            out = (r.stdout_text or "") + (r.stderr_text or "")
            info = "command timed out" if r.timed_out else ""
            output = {"output": out, "returncode": -1 if r.timed_out else r.exit_code, "exception_info": info}
        except Exception as e:  # noqa: BLE001 — surface sandbox errors to the model, like LocalEnvironment
            output = {"output": "", "returncode": -1,
                      "exception_info": f"An error occurred while executing the command: {e}"}
        lines = output["output"].lstrip().splitlines(keepends=True)
        if lines and lines[0].strip() == "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT" and output["returncode"] == 0:
            submission = "".join(lines[1:])
            raise Submitted({"role": "exit", "content": submission,
                             "extra": {"exit_status": "Submitted", "submission": submission}})
        return output

    def get_template_vars(self, **kwargs) -> dict:
        return {"cwd": self.config.cwd, "timeout": self.config.timeout, **kwargs}

    def serialize(self) -> dict:
        return {"info": {"config": {"environment": {"cwd": self.config.cwd, "timeout": self.config.timeout},
                                    "environment_type": f"{__name__}._ContainerEnv"}}}


def run_agent(sb, instance: dict, model_id: str, api_base: str, api_key_env: str, model=None) -> None:
    """Drive mini-SWE-agent (2.x) against /testbed inside the container, against any
    OpenAI-compatible endpoint (bring your own model + key). `model` overrides the
    litellm model (e.g. a DeterministicModel for an offline test)."""
    import yaml
    from minisweagent.agents.default import DefaultAgent
    from minisweagent.config import get_config_path
    from minisweagent.models import get_model

    # Reasoning models that stream their thoughts on a separate channel need the
    # text-based litellm shim, or the parser can drop the answer. OpenRouter is the
    # common case; flip this on for your endpoint if answers come back empty.
    textbased = "openrouter.ai" in api_base
    # mini-SWE-agent ships a swebench config (system/instance templates telling the
    # model it's in /testbed and to edit in place, plus the observation templates
    # and container env). Reuse it for fidelity.
    cfg = yaml.safe_load(get_config_path("swebench_backticks" if textbased else "swebench").read_text())
    agent_cfg, env_cfg, model_cfg = cfg["agent"], cfg.get("environment", {}), cfg.get("model", {})

    if model is None:
        model_cfg = {**model_cfg, "model_name": "openai/" + model_id, "model_kwargs": {
            **model_cfg.get("model_kwargs", {}),
            "api_base": api_base, "api_key": os.environ[api_key_env],
            "temperature": 0.0, "max_tokens": 16000}}
        if textbased:
            model_cfg["model_class"] = "litellm_textbased"
        model = get_model("openai/" + model_id, config=model_cfg)

    env = _ContainerEnv(sb, cwd=env_cfg.get("cwd", "/testbed"), env=env_cfg.get("env"))
    agent = DefaultAgent(model, env, **agent_cfg)
    try:
        result = agent.run(instance["problem_statement"])
        log(f"    (agent exit: {result.get('exit_status')})")
    except Exception as e:  # grading still runs on whatever the agent left in /testbed
        log(f"    (agent stop: {type(e).__name__}: {str(e)[:120]})")


# ---- sandbox lifecycle -------------------------------------------------------
# Every sandbox this process creates carries RUN_TAG, so cleanup() can find one even
# when Ctrl-C lands mid-create, before we hold a handle to it.

RUN_TAG = f"swe-bench-{uuid.uuid4().hex[:12]}"
_live: dict[str, object] = {}  # sandbox id -> Sandbox, until terminated
_live_lock = threading.Lock()
_DONE = ("TERMINATING", "TERMINATED")


def _terminate(sb) -> str | None:
    """Terminate one sandbox, retrying once. Returns None, or the error (already logged)."""
    err = ""
    for attempt in (1, 2):
        try:
            close_err = None
            try:
                sb.close_if_open()
            except Exception as e:  # noqa: BLE001 — judged by the state below
                close_err = e
            sb.refresh()  # a racing terminate (cleanup() vs a worker) still ends TERMINATING
            if sb.state not in _DONE:
                raise close_err or RuntimeError(f"state is {sb.state} after terminate")
            with _live_lock:
                _live.pop(sb.id, None)
            return None
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {str(e)[:200]}"
            log(f"  WARNING: terminate {sb.id} failed (attempt {attempt}/2): {err}")
            if attempt == 1:
                time.sleep(3)
    log(f"  WARNING: sandbox {sb.id} may still be RUNNING. Stop it: tenki sandbox terminate {sb.id}")
    return err


def cleanup() -> list[str]:
    """Terminate every sandbox this process created and still holds, then sweep the
    workspace for any other sandbox tagged RUN_TAG. Returns the ids that failed."""
    with _live_lock:
        pending = list(_live.values())
    failed = [sb.id for sb in pending if _terminate(sb)]
    try:
        client, wid = tenki_client()
        for sb in client.list(workspace_id=wid, tags=[RUN_TAG]):
            if sb.state not in _DONE and sb.id not in failed:
                log(f"  terminating leftover sandbox {sb.id} ({sb.name})")
                if _terminate(sb):
                    failed.append(sb.id)
    except Exception as e:  # noqa: BLE001
        log(f"  WARNING: could not list sandboxes tagged {RUN_TAG} to check for leftovers: "
            f"{type(e).__name__}: {str(e)[:200]}")
    return failed


def raise_on_sigterm() -> None:
    """Treat SIGTERM (CI cancel, `timeout`) like Ctrl-C so the same cleanup runs."""
    def handler(signum, frame):
        raise KeyboardInterrupt(f"signal {signum}")
    signal.signal(signal.SIGTERM, handler)


def ignore_signals() -> None:
    """Call before cleanup(): a second Ctrl-C must not abort the teardown itself."""
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)


# ---- one instance, end to end ----------------------------------------------

def run_one(instance: dict, *, oracle: bool = False, model_id: str | None = None,
            api_base: str = "", api_key_env: str = "", keep: bool = False, model=None) -> dict:
    iid = instance["instance_id"]
    test_spec = make_test_spec(instance)
    client, wid = tenki_client()
    t0 = time.time()
    sb, result = None, {"instance_id": iid}
    try:
        try:
            sb = client.create(name=f"swe-{iid[:32]}", workspace_id=wid, cpu_cores=2,
                               memory_mb=4096, max_duration=1800, disk_size_gb=DISK_GB,
                               tags=["swe-bench", RUN_TAG])
        except WaitReadyFailedError as e:  # admitted but never ready: still ours to stop
            sb = e.sandbox
            raise
        finally:
            if sb is not None:
                with _live_lock:
                    _live[sb.id] = sb
        log(f"  [{iid}] sandbox {sb.id}; provisioning (pull {image_name(iid).split('/')[-1]}) …")
        provision(sb, iid)
        if oracle:
            apply_gold(sb, instance["patch"])
            mode = "oracle"
        elif model_id or model is not None:
            mode = model_id or "stub-model"
            log(f"  [{iid}] running agent {mode} …")
            run_agent(sb, instance, model_id or "", api_base, api_key_env, model=model)
        else:
            mode = "empty"  # no edit -> must NOT resolve (negative control)
        resolved, detail = grade(sb, test_spec)
        dt = time.time() - t0
        log(f"  [{iid}] {mode:16} resolved={resolved}  "
            f"F2P {detail.get('fail_to_pass')}  P2P {detail.get('pass_to_pass')}  ({dt:.0f}s)")
        result = {"instance_id": iid, "mode": mode, "resolved": resolved, "seconds": round(dt), **detail}
    except Exception as e:
        log(f"  [{iid}] ERROR {type(e).__name__}: {str(e)[:200]}")
        result = {"instance_id": iid, "mode": "error", "resolved": None,
                  "error": f"{type(e).__name__}: {str(e)[:200]}"}
    finally:
        # Also runs on KeyboardInterrupt, which then propagates to the caller.
        if sb is not None and not keep:
            if err := _terminate(sb):
                result["teardown_error"] = f"{sb.id}: {err}"
    return result


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

    raise_on_sigterm()
    results = []
    ex = cf.ThreadPoolExecutor(max_workers=a.workers)
    try:
        futs = [ex.submit(run_one, r, oracle=a.oracle, model_id=a.model,
                          api_base=a.api_base, api_key_env=a.api_key_env, keep=a.keep)
                for r in rows]
        for fut in cf.as_completed(futs):
            results.append(fut.result())
    except KeyboardInterrupt:
        log("\nInterrupted: terminating this run's sandboxes …")
        ignore_signals()
        ex.shutdown(wait=False, cancel_futures=True)
        if not a.keep:
            failed = cleanup()
            log(f"  {len(failed)} sandbox(es) could not be terminated: {', '.join(failed)}" if failed
                else "  all sandboxes terminated")
        sys.stdout.flush()
        os._exit(130)  # don't wait on workers still blocked in sandbox calls
    ex.shutdown()
    leftovers = [] if a.keep else cleanup()

    resolved = [r for r in results if r.get("resolved") is True]
    errs = [r for r in results if r.get("mode") == "error"]
    log(f"\n=== {len(resolved)}/{len(results)} resolved · {len(errs)} errored ===")
    Path(a.out).write_text(json.dumps(
        {"generatedAt": str(date.today()), "dataset": a.dataset, "backend": "tenki",
         "resolvedRate": round(100 * len(resolved) / max(1, len(results) - len(errs)), 1),
         "results": results}, indent=2) + "\n")
    log(f"Wrote {a.out}")
    if leftovers:
        log(f"ERROR: {len(leftovers)} sandbox(es) may still be RUNNING: {', '.join(leftovers)}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
