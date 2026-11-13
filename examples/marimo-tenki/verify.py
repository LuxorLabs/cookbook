"""
Proves this example against live Tenki: serve notebook.py with run.py's serve_marimo(),
then over the public preview URL assert that a request without the token lands on the
login page, the token opens the editor, and the kernel answers on marimo's WebSocket.
Exits non-zero on failure; the `with` block terminates the sandbox either way.
"""
import asyncio
import secrets
import sys
import time
import urllib.request
from http.cookiejar import CookieJar

from tenki import Sandbox
from websockets.asyncio.client import connect

from run import sandbox_opts, serve_marimo

if not sandbox_opts()["auth_token"]:
    print("No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.")
    sys.exit(1)


def get(opener, url):
    with opener.open(url, timeout=20) as r:
        return r.geturl(), r.read().decode()


async def kernel_ready(url, cookie):
    ws_url = url.replace("https://", "wss://", 1) + f"/ws?session_id=s_{secrets.token_hex(4)}"
    async with connect(ws_url, additional_headers={"Cookie": cookie}, open_timeout=20) as ws:
        return '"kernel-ready"' in await asyncio.wait_for(ws.recv(), 30)


token = secrets.token_urlsafe(24)
try:
    with Sandbox.create(**sandbox_opts()) as sb:
        url = serve_marimo(sb, token)
        print(f"  preview URL: {url}")
        anon = urllib.request.build_opener()
        jar = CookieJar()
        authed = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        for _ in range(30):  # marimo and the gateway route take a few seconds to come up
            try:
                landed, _ = get(anon, url + "/")
                break
            except OSError:
                time.sleep(2)
        else:
            raise RuntimeError("marimo never answered: " + sb.shell("tail -5 /tmp/marimo.log").stdout_text)
        assert "/auth/login" in landed, f"no token, expected the login page, got {landed}"
        landed, body = get(authed, f"{url}/?access_token={token}")
        assert "/auth/login" not in landed and "marimo" in body, f"token rejected: {landed}"
        cookie = "; ".join(f"{c.name}={c.value}" for c in jar)
        assert asyncio.run(kernel_ready(url, cookie)), "no kernel-ready on the WebSocket"
    print("✓ marimo-tenki: marimo edit → exposePort → no token: login page → token: editor → WebSocket kernel-ready")
except Exception as e:  # noqa: BLE001
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
