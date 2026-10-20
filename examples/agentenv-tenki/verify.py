"""
Smoke-verify the AgentEnv example without a model key:
  1. agent-env resolves the built-in `tenki` backend from this folder's
     .agentenv/config.toml, and
  2. that provider boots a live Tenki VM, exposes a port, runs a command as
     root and terminates.

The full `agent-env run hello --sandbox tenki` (Docker bootstrap included)
is in the README; it takes a few minutes, so CI skips it.
"""
import asyncio
import os
import sys

from agent_env.providers.sandbox_providers.sandbox_provider import build_sandbox_provider
from agent_env.providers.sandbox_providers.tenki.provider import TenkiSandboxProvider


def cfg(key):
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return ""


token = os.environ.get("TENKI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN") or cfg("auth_token")
if not token.startswith("tk_"):
    print("✗ The `tenki` SDK (1.4) behind agent-env's provider takes only a `tk_` API key.")
    print("  Create one at https://tenki.cloud/docs/account/api-keys and export TENKI_API_KEY=tk_...")
    sys.exit(1)
os.environ["TENKI_API_KEY"] = token


async def main():
    provider = build_sandbox_provider("tenki")
    if not isinstance(provider, TenkiSandboxProvider):
        raise AssertionError(f"`tenki` resolved to {type(provider).__name__}")

    sb = await provider.create_vm(cpu=2, memory=4096, timeout=600, exposed_ports=[8080], setup_for_gateway=False)
    try:
        url = sb.tunnel_urls.get(8080, "")
        if not url.startswith("https://"):
            raise AssertionError(f"port 8080 URL: {url!r}")
        code, out, err = await sb.exec_with_output("sudo", "sh", "-c", "id -u; python3 -c 'print(6*7)'")
        if code != 0 or out.split() != ["0", "42"]:
            raise AssertionError(f"exec: exit={code} stdout={out!r} stderr={err!r}")
    finally:
        await sb.terminate()


try:
    asyncio.run(main())
except Exception as e:  # noqa: BLE001
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)

print("✓ agentenv-tenki: `tenki` provider from config.toml → create_vm + exposed port → root exec (42) → terminate")
