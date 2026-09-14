"""
Proves the Tenki-facing surface RAGFlow's `tenki` sandbox provider
(agent/sandbox/providers/tenki.py) is built on, without running RAGFlow:
Client + who_am_i health check, an ephemeral sandbox with outbound network
off (RAGFlow's security default), both supported languages (python3 and
node), the artifacts/ read-back path, and terminate.

Needs Python 3.10+ and `tenki-sandbox` (requirements.txt). Token/workspace
from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
"""
import os
import sys

from tenki_sandbox import Client


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
# A `tk_` API key works as-is; a `tenki login` browser session token must go
# over as a cookie — the SDK does that when the token is prefixed `cookie:`.
if not token.startswith(("tk_", "ory_st_", "cookie:")):
    token = f"cookie:{token}"

create_opts = {"cpu_cores": 1, "memory_mb": 1024, "allow_outbound": False, "max_duration": 3600}
workspace_id = os.environ.get("TENKI_WORKSPACE_ID") or cfg("current_workspace_id")
if workspace_id:
    create_opts["workspace_id"] = workspace_id

client = Client(auth_token=token)
sb = None
try:
    # 1) the provider's health check
    client.who_am_i()

    # 2) an ephemeral sandbox, network off — RAGFlow's per-execution lifecycle
    sb = client.create(**create_opts)

    # 3) python path: stage the script over fs, run it (the provider's wrapper pattern)
    sb.fs.write_text("/home/tenki/main.py", "print(6 * 7)\n")
    r = sb.exec("python3", "main.py", cwd="/home/tenki", timeout=30)
    if not (r.ok and r.stdout_text.strip() == "42"):
        raise AssertionError(f"python: ok={r.ok}, stdout={r.stdout_text!r}, stderr={r.stderr_text!r}")

    # 4) javascript path — the default image ships node too
    sb.fs.write_text("/home/tenki/main.js", 'console.log("hello from node")\n')
    r = sb.exec("node", "main.js", cwd="/home/tenki", timeout=30)
    if not (r.ok and r.stdout_text.strip() == "hello from node"):
        raise AssertionError(f"node: ok={r.ok}, stdout={r.stdout_text!r}, stderr={r.stderr_text!r}")

    # 5) artifact collection transport: code writes artifacts/, provider reads them back
    sb.exec("python3", "-c", "import os,json; os.makedirs('artifacts',exist_ok=True); json.dump({'answer':42},open('artifacts/result.json','w'))", cwd="/home/tenki", timeout=30)
    if b'"answer": 42' not in sb.fs.read_bytes("/home/tenki/artifacts/result.json"):
        raise AssertionError("artifact read-back mismatch")

    print("✓ ragflow-tenki: who_am_i → outbound-off sandbox → python (42) → node → artifacts/ read-back → terminate")
except Exception as e:  # noqa: BLE001
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
finally:
    if sb is not None:
        try:
            sb.terminate()
        except Exception:  # noqa: BLE001
            pass  # self-reaps via max_duration
    client.close()
