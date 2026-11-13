"""Tenki backend for tinker-cookbook's Harbor RL recipe.

``TenkiSandbox`` implements tinker-cookbook's ``SandboxInterface``. The recipe hands
its sandbox factory a task's ``environment/`` directory (a Dockerfile plus build
context), so each sandbox is one Tenki VM that runs the task's container under Docker:
the prebuilt ``docker_image`` from ``task.toml`` when there is one, otherwise the
Dockerfile built in the VM. Commands, file reads and file writes all go to that
container with ``docker exec``.

Auth comes from ``TENKI_API_KEY`` (or ``~/.config/tenki/config.yaml``).
"""

from __future__ import annotations

import posixpath
import re
import shlex
import tarfile
import tempfile
import tomllib
import uuid
from pathlib import Path

from tenki import (
    AsyncSandbox,
    CommandTimeoutError,
    SessionNotFoundError,
    SessionTerminatedError,
)
from tinker_cookbook.sandbox.sandbox_interface import SandboxResult, SandboxTerminatedError

CONTAINER = "main"
WORK_DIR = "/home/tenki/.tinker"  # Tenki's file API only reaches /home/tenki
BUILD_DIR = f"{WORK_DIR}/build"
TAG = "tinker-rl"

READY_TIMEOUT_SEC = 300
BOOTSTRAP_TIMEOUT_SEC = 600
BUILD_TIMEOUT_SEC = 900
# The recipe's `timeout` is the sandbox's usable lifetime. Starting Docker and building
# the image happen first, so the VM gets this much extra on top of it.
SETUP_BUDGET_SEC = BOOTSTRAP_TIMEOUT_SEC + BUILD_TIMEOUT_SEC

# Installs Docker on a bare Tenki VM and waits for the daemon.
# Same script as tenki-harbor (https://github.com/LuxorLabs/tenki-harbor).
DOCKER_BOOTSTRAP = r"""
set -e
sysctl -qw vm.overcommit_memory=1 || true
if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get -o DPkg::Lock::Timeout=180 update -qq
  apt-get -o DPkg::Lock::Timeout=180 install -y -qq --no-install-recommends \
    docker.io docker-buildx >/dev/null
fi
if ! docker info >/dev/null 2>&1; then
  systemctl start docker >/dev/null 2>&1 || (nohup dockerd >/var/log/dockerd.log 2>&1 &)
fi
for _ in $(seq 90); do
  docker info >/dev/null 2>&1 && exit 0
  sleep 1
done
echo "docker daemon did not become ready" >&2
exit 1
"""


def _cap(data: bytes, limit: int) -> str:
    return data[:limit].decode("utf-8", errors="replace")


def _prebuilt_image(env_dir: Path) -> str | None:
    """The ``docker_image`` a Harbor task declares in the ``task.toml`` next to ``environment/``."""
    task_toml = env_dir.parent / "task.toml"
    if not task_toml.is_file():
        return None
    return tomllib.loads(task_toml.read_text()).get("environment", {}).get("docker_image") or None


class TenkiSandbox:
    """One Tenki VM running one task container. Conforms to ``SandboxInterface``."""

    def __init__(self, sandbox: AsyncSandbox, max_stream_output_bytes: int = 128 * 1024) -> None:
        self._sandbox = sandbox
        self._max_stream_output_bytes = max_stream_output_bytes

    @classmethod
    async def create(
        cls,
        env_dir: Path,
        timeout: int = 600,
        *,
        cpus: int = 2,
        memory_mb: int = 4096,
        disk_size_gb: int = 50,
        max_stream_output_bytes: int = 128 * 1024,
    ) -> TenkiSandbox:
        """Start a VM, build ``env_dir/Dockerfile`` in it, and start the container."""
        create_kwargs: dict = {
            "name": f"tinker-{uuid.uuid4().hex[:10]}",
            "cpu_cores": cpus,
            "memory_mb": memory_mb,
            "disk_size_gb": disk_size_gb,
            "max_duration": timeout + SETUP_BUDGET_SEC,
            "metadata": {"task_dir": re.sub(r"[^A-Za-z0-9._-]+", "-", env_dir.parent.name)},
            "tags": [TAG],
            "wait": False,
        }

        sandbox = await AsyncSandbox.create(**create_kwargs)
        # A VM that never gets its container must not outlive the failed create.
        try:
            await sandbox.wait_ready(timeout=READY_TIMEOUT_SEC)
            await cls._setup(sandbox, env_dir)
        except BaseException:
            await sandbox.close_if_open()
            raise
        return cls(sandbox, max_stream_output_bytes=max_stream_output_bytes)

    @staticmethod
    async def _setup(sandbox: AsyncSandbox, env_dir: Path) -> None:
        async def host(*argv: str, timeout: int, what: str, check: bool = True):
            result = await sandbox.exec(*argv, timeout=timeout, privileged=True)
            if check and (result.exit_code != 0 or result.timed_out):
                tail = (result.stdout_text + result.stderr_text)[-2000:]
                raise RuntimeError(f"{what} failed: {tail or f'exit code {result.exit_code}'}")
            return result

        await host("mkdir", "-p", BUILD_DIR, timeout=30, what="mkdir")
        await host("bash", "-c", DOCKER_BOOTSTRAP, timeout=BOOTSTRAP_TIMEOUT_SEC, what="docker install")

        # Prefer the task's prebuilt image, as Harbor does: it is the exact image the
        # benchmark was validated on, and some Dockerfiles fetch live repos while building.
        image = _prebuilt_image(env_dir)
        pulled = image and await host(
            "docker", "pull", "-q", image, timeout=BUILD_TIMEOUT_SEC, what="docker pull", check=False
        )
        if not pulled or pulled.exit_code != 0:
            image = "task"
            with tempfile.TemporaryDirectory() as tmp:
                archive = Path(tmp) / "env.tar"
                with tarfile.open(archive, "w") as tar:
                    tar.add(env_dir, arcname=".")
                await sandbox.fs.upload(archive, f"{WORK_DIR}/env.tar")
            await host("tar", "-xf", f"{WORK_DIR}/env.tar", "-C", BUILD_DIR, timeout=120, what="unpack")
            await host("docker", "build", "-q", "-t", image, BUILD_DIR, timeout=BUILD_TIMEOUT_SEC, what="docker build")
        await host(
            "docker", "run", "-d", "--name", CONTAINER, image, "sh", "-c", "sleep infinity",
            timeout=120, what="docker run",
        )

    @property
    def sandbox_id(self) -> str:
        return self._sandbox.id

    async def send_heartbeat(self, timeout: int = 30) -> None:
        result = await self.run_command("true", timeout=timeout)
        if result.exit_code != 0:
            raise SandboxTerminatedError(f"heartbeat failed: {result.stderr}")

    async def run_command(
        self,
        command: str,
        workdir: str | None = None,
        timeout: int = 60,
        max_output_bytes: int | None = None,
    ) -> SandboxResult:
        cap = max_output_bytes if max_output_bytes is not None else self._max_stream_output_bytes
        argv = ["docker", "exec", *(["-w", workdir] if workdir else []), CONTAINER]
        argv += ["bash", "-lc", command]
        return await self._exec(argv, timeout=timeout, cap=cap)

    async def read_file(
        self, path: str, max_bytes: int | None = None, timeout: int = 60
    ) -> SandboxResult:
        head = f"head -c {max_bytes} " if max_bytes is not None else "cat "
        return await self.run_command(head + shlex.quote(path), timeout=timeout)

    async def write_file(
        self, path: str, content: str | bytes, executable: bool = False, timeout: int = 60
    ) -> SandboxResult:
        data = content.encode() if isinstance(content, str) else content
        dest = shlex.quote(path)
        script = f"mkdir -p {shlex.quote(posixpath.dirname(path) or '/')} && cat > {dest}"
        if executable:
            script += f" && chmod +x {dest}"
        argv = ["docker", "exec", "-i", CONTAINER, "bash", "-c", script]
        return await self._exec(argv, timeout=timeout, cap=self._max_stream_output_bytes, stdin=data)

    async def cleanup(self) -> None:
        await self._sandbox.close_if_open()

    async def _exec(
        self, argv: list[str], *, timeout: int, cap: int, stdin: bytes | None = None
    ) -> SandboxResult:
        try:
            result = await self._sandbox.exec(*argv, timeout=timeout, input=stdin, privileged=True)
        except (SessionNotFoundError, SessionTerminatedError) as e:
            raise SandboxTerminatedError(str(e)) from e
        except CommandTimeoutError:
            return SandboxResult(stdout="", stderr=f"Command timed out after {timeout} seconds", exit_code=-1)
        except Exception as e:  # Match ModalSandbox: a failed call is a result, not a crash
            return SandboxResult(stdout="", stderr=str(e), exit_code=-1)
        if result.timed_out:
            return SandboxResult(stdout="", stderr=f"Command timed out after {timeout} seconds", exit_code=-1)
        return SandboxResult(
            stdout=_cap(result.stdout, cap), stderr=_cap(result.stderr, cap), exit_code=result.exit_code
        )


async def tenki_sandbox_factory(env_dir: Path, timeout: int) -> TenkiSandbox:
    """Drop-in for tinker-cookbook's ``SandboxFactory``: ``(env_dir, timeout) -> sandbox``."""
    return await TenkiSandbox.create(env_dir, timeout)
