"""
Verify the verifiers + Tenki example without a model key. On a live Tenki sandbox:
  1. verifiers loads TenkiBackend from `type = "custom"` + `import_path` and reads its feature flags,
  2. run, exec, kill, files, user switching and host-port forwarding behave as the framework expects, and
  3. the sandbox is terminated after teardown (checked through the SDK list by tag).
"""
import asyncio, http.server, os, re, sys, threading, uuid  # noqa: E401
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


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
os.environ["TENKI_API_KEY"] = token

from pydantic import TypeAdapter  # noqa: E402
import tenki  # noqa: E402
from tenacity import retry, stop_after_attempt, wait_fixed  # noqa: E402
from verifiers.v1.errors import SandboxError  # noqa: E402
from verifiers.v1.runtimes import RuntimeConfig, backend_cls, provision_runtime  # noqa: E402

TAG = f"verifiers-tenki-verify-{uuid.uuid4().hex[:8]}"
FETCH = "import sys, urllib.request; print(urllib.request.urlopen(sys.argv[1]).read().decode())"
NO_SLEEPERS = "cat /proc/[0-9]*/cmdline | tr '\\0' ' ' | grep -c '[s]leep 600' || true"  # slim images have no pgrep


async def main():
    config = TypeAdapter(RuntimeConfig).validate_python(
        {"type": "custom", "import_path": "tenki_backend.TenkiBackend", "tags": [TAG]}
    )
    cls = backend_cls(config)  # compose stays off: verifiers' compose path can't reach a custom backend (see README)
    assert (cls.SUPPORTS_TASK_IMAGES, cls.SUPPORTS_USER_SWITCHING, cls.is_local, cls.SUPPORTS_COMPOSE) == (True, True, True, False)
    async with provision_runtime(config) as rt:
        sandbox_id = rt.info.id
        r = await rt.run(["sh", "-c", 'echo "$GREETING"; pwd; exit 3'], {"GREETING": "hi"})
        assert (r.exit_code, r.stdout.split()) == (3, ["hi", "/app"]), r
        assert (await rt.run(["cat"], {})).stdout == "", "run must close stdin"
        p = await rt.exec(["sh", "-c", 'read l; echo "got $l"; exit 4'], {})
        await p.write(b"ping\n")
        assert (b"".join([c async for c in p.stdout]).strip(), await p.wait()) == (b"got ping", 4)
        sleeper = await rt.exec(["sleep", "600"], {})
        assert await sleeper.poll() is None
        await sleeper.kill()
        assert await asyncio.wait_for(sleeper.wait(), 30) != 0
        assert (await rt.run(["sh", "-c", NO_SLEEPERS], {})).stdout.strip() == "0", "kill left the process"

        data = os.urandom(3 * 1024 * 1024)  # the sandbox file API only reaches /home/tenki; this goes into the container
        await rt.write("vf check/nested/data.bin", data)
        assert await rt.read("vf check/nested/data.bin") == data
        capped = await asyncio.gather(rt.read("vf check/nested/data.bin", max_bytes=10), return_exceptions=True)
        assert isinstance(capped[0], SandboxError), "read past max_bytes must fail"
        assert (await rt.with_user("nobody").run(["id", "-un"], {})).stdout.strip() == "nobody"

        # A server on THIS machine, standing in for verifiers' model interception server.
        http.server.SimpleHTTPRequestHandler.log_message = lambda *a: None
        host = http.server.ThreadingHTTPServer(("127.0.0.1", 0), http.server.SimpleHTTPRequestHandler)
        threading.Thread(target=host.serve_forever, daemon=True).start()
        got = await rt.run(["python3", "-c", FETCH, rt.host_url(f"http://127.0.0.1:{host.server_port}/")], {})
        assert "Directory listing" in got.stdout, got
        print(f"✓ run, exec, kill, 3 MB file round-trip, user switch and host-port forward on sandbox {sandbox_id}")

    list_sessions = retry(stop=stop_after_attempt(4), wait=wait_fixed(2))(tenki.AsyncClient().list)  # the API can 503 briefly
    sessions = await list_sessions(tags=[TAG], include_terminated=True)
    states = {s.info.id: s.info.state for s in sessions}
    assert sandbox_id in states, f"sandbox not found by tag {TAG}"
    assert all(s in {"TERMINATING", "TERMINATED"} for s in states.values()), states
    print("✓ sandbox terminated")


asyncio.run(main())
