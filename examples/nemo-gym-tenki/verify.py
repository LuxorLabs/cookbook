"""Check NeMo Gym's `tenki` sandbox provider against the live Tenki API.

Exits non-zero on any failure. Needs TENKI_API_KEY (or a `tenki login` config).
"""

import asyncio
import os
import sys

from nemo_gym.sandbox.providers.base import SandboxSpec, SandboxStatus
from nemo_gym.sandbox.providers.registry import create_provider, list_providers


def cfg(key: str) -> str:
    try:
        with open(os.path.expanduser("~/.config/tenki/config.yaml")) as f:
            for line in f:
                if line.startswith(key + ":"):
                    return line.split(":", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


async def main() -> None:
    token = os.environ.get("TENKI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN") or cfg("auth_token")
    if not token:
        sys.exit("No token. Set TENKI_API_KEY (tk_...), or run `tenki login`.")
    if "tenki" not in list_providers():
        sys.exit("✗ NeMo Gym doesn't list a `tenki` provider. Is nemo-gym-tenki installed in this environment?")

    # max_duration_s caps the VM's lifetime, so a crashed run can't leave it running.
    provider = create_provider({"tenki": {"connection": {"auth_token": token},
                                          "create": {"cpu_cores": 1, "memory_mb": 1024, "max_duration_s": 600}}})
    # The same staging path run.py uses: spec.files are written into spec.workdir at create time.
    spec = SandboxSpec(env={"ROLLOUT": "verify"}, workdir="/home/tenki/task", files={"answer.py": "print(6 * 7)\n"})
    handle = await provider.create(spec)
    try:
        r = await provider.exec(handle, "python3 answer.py", cwd="/home/tenki/task")
        assert r.return_code == 0 and (r.stdout or "").strip() == "42", f"staged file: exit {r.return_code}, stdout {r.stdout!r}"
        r = await provider.exec(handle, 'echo "$ROLLOUT"')
        assert (r.stdout or "").strip() == "verify", f"spec.env didn't reach the VM: {r.stdout!r}"
        r = await provider.exec(handle, "exit 3")
        assert r.return_code == 3, f"exit code not preserved: {r.return_code}"
    finally:
        await provider.close(handle)
        # close() swallows errors, so confirm the VM is actually gone.
        status = await provider.status(handle)
        await provider.aclose()
    assert status not in (SandboxStatus.RUNNING, SandboxStatus.STARTING), f"sandbox still {status.value} after close()"
    print(f"✓ nemo-gym-tenki: `tenki` provider via entry point → create {handle.sandbox_id} with staged files"
          f" → exec 42 → env → exit 3 → close ({status.value})")


if __name__ == "__main__":
    asyncio.run(main())
