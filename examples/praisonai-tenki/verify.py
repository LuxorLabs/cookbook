"""
Smoke-verify the PraisonAI Tenki compute provider, end to end:

  1. registration — ``TenkiCompute`` imports from its module and the
     ``praisonai.integrations.compute`` barrel, and the core SDK's compute
     bridge resolves the string ``"tenki"`` to it. That bridge is the exact
     path ``PraisonAIAgents(..., compute="tenki")`` and
     ``Workflow(..., compute="tenki")`` take, so this proves the string wiring
     without an LLM call.
  2. live — provision a real Tenki microVM through the provider, run a
     command, round-trip a file byte-for-byte, and shut it down.

No LLM key needed: this drives the provider directly, not an agent run.
Token from env (TENKI_AUTH_TOKEN / TENKI_API_KEY) or ~/.config/tenki/config.yaml.
"""
import asyncio
import os
import sys
import tempfile

from praisonai.integrations.compute.tenki import TenkiCompute
from praisonai.integrations.compute import TenkiCompute as TenkiComputeBarrel
from praisonaiagents.managed._compute_bridge import resolve_compute
from praisonaiagents.managed.protocols import ComputeConfig, InstanceStatus


def cfg(key):
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return ""


def resolve_token():
    token = (
        os.environ.get("TENKI_AUTH_TOKEN")
        or os.environ.get("TENKI_API_KEY")
        or cfg("auth_token")
    )
    if not token:
        print("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.")
        sys.exit(1)
    # A `tenki login` browser-session token may need a `cookie:` prefix (a
    # `tk_` API key works bare). Probe with who_am_i and keep what works.
    from tenki import Client

    for candidate in (token, f"cookie:{token}"):
        try:
            Client(auth_token=candidate).who_am_i()
            return candidate
        except Exception:
            continue
    print("Tenki rejected the token (tried bare and cookie:-prefixed).")
    sys.exit(1)


# 1. Registration: module import (top of file), barrel export, and the core
# SDK bridge resolving the string "tenki" to a ready TenkiCompute instance.
assert TenkiComputeBarrel is TenkiCompute
provider = resolve_compute("tenki")
assert isinstance(provider, TenkiCompute), f"resolve_compute gave {type(provider)}"
assert provider.provider_name == "tenki"

# 2. Live: the same provider class against a real microVM.
compute = TenkiCompute(api_key=resolve_token())
config = ComputeConfig(cpu=1, memory_mb=1024, idle_timeout_s=120)

try:
    info = asyncio.run(compute.provision(config))
except Exception as e:  # noqa
    print(f"✗ provision failed: {type(e).__name__}: {e}")
    sys.exit(1)

try:
    assert info.status == InstanceStatus.RUNNING, info.status

    r = asyncio.run(compute.execute(info.instance_id, "python3 -c 'print(6 * 7)'"))
    assert r["exit_code"] == 0, r
    assert r["stdout"].strip() == "42", r

    # The stock image runs as user `tenki` and has no /workspace yet; create it
    # once, exactly as a real team run on the stock image would (see README).
    r = asyncio.run(compute.execute(
        info.instance_id,
        'sudo mkdir -p /workspace && sudo chown "$(id -un)" /workspace',
    ))
    assert r["exit_code"] == 0, r

    payload = os.urandom(256)
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "up.bin")
        dst = os.path.join(td, "down.bin")
        with open(src, "wb") as f:
            f.write(payload)
        assert asyncio.run(
            compute.upload_file(info.instance_id, src, "/workspace/roundtrip.bin")
        ), "upload_file returned False"
        assert asyncio.run(
            compute.download_file(info.instance_id, "/workspace/roundtrip.bin", dst)
        ), "download_file returned False"
        with open(dst, "rb") as f:
            assert f.read() == payload, "downloaded bytes differ"

    print('✓ praisonai-tenki: compute="tenki" resolves → provision → execute 42 → file round-trip → shutdown')
except Exception as e:  # noqa
    print(f"✗ {type(e).__name__}: {e}")
    sys.exit(1)
finally:
    asyncio.run(compute.shutdown(info.instance_id))
