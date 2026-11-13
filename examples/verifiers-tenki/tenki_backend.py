"""Tenki runtime backend for Prime Intellect's ``verifiers``.

``TenkiBackend`` is a ``RuntimeBackend`` that verifiers loads out of tree, with no fork:

    [env.agent.runtime]
    type = "custom"
    import_path = "tenki_backend.TenkiBackend"

Every rollout gets its own Tenki sandbox. Tenki sandboxes can't boot a container image
directly, so the sandbox installs Docker and runs the task image as one container under
it; commands, file reads and file writes are ``docker exec`` calls into that container.
The sandbox's own file API only reaches ``/home/tenki``, which is why files go through
``docker exec`` stdin instead.

The model-traffic interception server runs on the evaluator host. The backend declares
``is_local`` and forwards the host's loopback port into the sandbox with Tenki's
host-port tunnel (``host_url``), so no Prime tunnel or Prime credentials are involved.

Auth comes from ``TENKI_API_KEY`` (or ``TENKI_AUTH_TOKEN``).
"""

from __future__ import annotations

import asyncio
import contextlib
import ipaddress
import json
import logging
import math
import uuid
from collections.abc import AsyncIterator
from typing import ClassVar
from urllib.parse import urlsplit

from pydantic import Field
from tenki import (
    AsyncSandbox,
    Client,
    RateLimitedError,
    SandboxError as TenkiError,
    SessionNotFoundError,
    SessionTerminatedError,
)

from verifiers.v1.errors import SandboxError
from verifiers.v1.runtimes import (
    CustomRuntimeConfig,
    CustomRuntimeInfo,
    ProgramResult,
    Runtime,
    RuntimeBackend,
    RuntimeProcess,
)
from verifiers.v1.utils.aio import run_shielded

logger = logging.getLogger(__name__)

TAG = "verifiers-tenki"
CONTAINER = "vf-task"
READY_TIMEOUT_SEC = 300
BOOTSTRAP_TIMEOUT_SEC = 600
PULL_TIMEOUT_SEC = 900
CHUNK_BYTES = 256 * 1024

# Installs Docker on a bare Tenki sandbox and waits for the daemon.
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

# Gives the target its own process group when `setsid` is available, and records its
# pid so `terminate()` / `kill()` can signal it inside the container (the `docker exec`
# client does not forward signals).
_WRAPPER = (
    "if setsid -w true >/dev/null 2>&1; then "
    "exec setsid -w sh -c 'echo $$ > \"$1\"; shift; exec \"$@\"' vf-process \"$@\"; "
    'fi; echo $$ > "$1"; shift; exec "$@"'
)
_SIGNAL = (
    "i=0; while [ $i -lt 40 ]; do "
    'if [ -s "$1" ]; then pid=$(cat "$1"); '
    'kill -"$2" "-$pid" 2>/dev/null || kill -"$2" "$pid" 2>/dev/null; exit 0; fi; '
    "i=$((i+1)); sleep 0.05; done; exit 1"
)


class TenkiConfig(CustomRuntimeConfig):
    """Validated next to ``import_path``; every field is settable under ``[env.agent.runtime]``."""

    image: str = "python:3.11-slim"
    """Task image. Runs as a container under Docker inside the sandbox."""
    workdir: str | None = None
    """Working directory override; None uses the task's workdir, or /app."""
    # TaskData.resources uses these units; non-default runtime values take precedence.
    cpu: float = 2
    """vCPUs for the sandbox (rounded up)."""
    memory: float = 4.0
    """Memory in GB."""
    disk: float = 20.0
    """Disk in GB. Holds Docker, the pulled image and everything the task writes."""
    max_duration: int = 7200
    """Seconds before Tenki ends the sandbox on its own, if teardown never runs."""
    tags: list[str] = Field(default_factory=list)
    """Extra tags on the sandbox, beside ``verifiers-tenki``."""


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    with contextlib.suppress(ValueError):
        return ipaddress.ip_address(host).is_loopback
    return False


class TenkiProcess(RuntimeProcess):
    """A ``docker exec`` client running in the sandbox, whose stdio streams to us."""

    def __init__(self, backend: TenkiBackend, process, pidfile: str, user: str | None):
        self._backend = backend
        self._process = process
        self._pidfile = pidfile
        self._user = user
        self.stdout: AsyncIterator[bytes] = process.stdout
        self.stderr: AsyncIterator[bytes] = process.stderr
        self._done: asyncio.Task = asyncio.ensure_future(process.wait())
        self._done.add_done_callback(lambda t: t.cancelled() or t.exception())

    async def write(self, data: bytes) -> None:
        await self._process.write_stdin(data)

    async def result(self):
        """The finished command's ``CommandResult``, with its full stdout and stderr."""
        try:
            return await asyncio.shield(self._done)
        except (SessionNotFoundError, SessionTerminatedError) as e:
            raise SandboxError(f"tenki sandbox is gone: {e}") from e

    async def wait(self) -> int:
        return (await self.result()).exit_code

    async def poll(self) -> int | None:
        if not self._done.done():
            return None
        return None if self._done.exception() else self._done.result().exit_code

    async def terminate(self) -> None:
        await self._signal("TERM")

    async def kill(self) -> None:
        await self._signal("KILL")

    async def _signal(self, name: str) -> None:
        if self._done.done():
            return
        with contextlib.suppress(Exception):
            await self._backend._docker(
                ["sh", "-c", _SIGNAL, "vf-signal", self._pidfile, name], user=self._user
            )
        if name == "KILL":  # the client too, in case the container side never started
            with contextlib.suppress(Exception):
                await self._process.kill()


class TenkiBackend(RuntimeBackend):
    """One Tenki sandbox running one task container."""

    config_class = TenkiConfig
    is_local: ClassVar[bool] = True
    """Host loopback URLs reach the sandbox through `host_url`, not a public tunnel."""
    SUPPORTS_TASK_IMAGES: ClassVar[bool] = True
    SUPPORTS_USER_SWITCHING: ClassVar[bool] = True
    # Not declared, on purpose:
    # - SUPPORTS_COMPOSE: verifiers' compose path runs `docker compose` on the evaluator
    #   host and needs a DockerConfig, so it never reaches a custom backend.
    # - SUPPORTS_PORT_EXPOSURE: an `is_local` backend's `expose()` must return a
    #   host-reachable URL, which a sandbox does not have.
    # - NetworkPolicyConfig: Tenki fixes a sandbox's egress rules when it is created.

    def __init__(self, config: TenkiConfig, name: str | None = None) -> None:
        super().__init__(name)
        self.config = config.model_copy(update={"workdir": config.workdir or "/app"})
        self.info = CustomRuntimeInfo(**self.config.model_dump())
        self._sandbox: AsyncSandbox | None = None
        self._terminated = False
        self._image_env: dict[str, str] = {}
        self._forwards: dict[int, asyncio.Task] = {}

    # -- provisioning -----------------------------------------------------------------

    async def start(self) -> None:
        try:
            await self._start()
        except SandboxError:
            raise
        except Exception as e:  # one rollout's problem, not the eval's
            raise SandboxError(f"tenki sandbox provisioning failed: {e}") from e

    async def _start(self) -> None:
        cfg = self.config

        async def create() -> AsyncSandbox:
            # Shielded through the id capture: a cancel mid-create must not orphan a
            # sandbox that teardown can't find.
            for attempt in range(4):
                try:
                    sandbox = await AsyncSandbox.create(
                        name=self.name,
                        cpu_cores=max(1, math.ceil(cfg.cpu)),
                        memory_mb=int(cfg.memory * 1024),
                        disk_size_gb=max(1, math.ceil(cfg.disk)),
                        max_duration=cfg.max_duration,
                        tags=[TAG, *cfg.tags],
                        wait=False,
                    )
                    break
                except Exception as e:  # a 429, or the API answering 503 for a moment
                    if attempt == 3 or not (isinstance(e, RateLimitedError) or type(e) is TenkiError):
                        raise
                    await asyncio.sleep(2**attempt)
            self._sandbox = sandbox
            self.info.id = sandbox.id
            return sandbox

        sandbox = await run_shielded(create())
        await sandbox.wait_ready(timeout=READY_TIMEOUT_SEC)
        await self._host("bash", "-c", DOCKER_BOOTSTRAP, timeout=BOOTSTRAP_TIMEOUT_SEC, what="docker install")
        # Host networking: the container shares the sandbox's loopback, which is where
        # `host_url` forwards the evaluator's ports.
        env_flags = [a for key in self.env for a in ("--env", key)]
        await self._host(
            "docker", "run", "--detach", "--network", "host", "--name", CONTAINER,
            *env_flags, "--entrypoint", "sleep", cfg.image, "infinity",
            env=self.env, timeout=PULL_TIMEOUT_SEC, what=f"docker run {cfg.image}",
        )
        inspected = await self._host(
            "docker", "inspect", "--format", "{{json .Config}}", CONTAINER, timeout=60, what="docker inspect"
        )
        container = json.loads(inspected.stdout_text)
        self._image_env = dict(e.split("=", 1) for e in container.get("Env") or [])
        # Create a missing workdir, owned by the image's execution user.
        await self._host(
            "docker", "exec", "--user", "0", CONTAINER, "sh", "-c",
            'if [ ! -d "$1" ]; then mkdir -p "$1" && chown "$2" "$1"; fi',
            "vf-workdir", cfg.workdir, container.get("User") or "0",
            timeout=60, what="workdir setup",
        )
        logger.info("tenki: sandbox %s up (image=%s)", self.info.id, cfg.image)

    async def _host(self, *argv: str, timeout: int, what: str, env: dict[str, str] | None = None):
        """Run a command on the sandbox itself (not in the container); it must succeed."""
        assert self._sandbox is not None
        result = await self._sandbox.exec(*argv, env=env, timeout=timeout, privileged=True)
        if result.exit_code != 0 or result.timed_out:
            tail = (result.stdout_text + result.stderr_text)[-2000:]
            raise SandboxError(f"{what} failed: {tail or f'exit code {result.exit_code}'}")
        return result

    # -- exec / run / files -----------------------------------------------------------

    def _docker_cmd(
        self, env: dict[str, str], *, stdin: bool = False, user: str | None = None, detach: bool = False
    ) -> list[str]:
        return [
            "docker", "exec",
            *(("--detach",) if detach else ()),
            *(("-i",) if stdin else ()),
            *(a for key in env for a in ("--env", key)),  # values travel in the exec's env, not argv
            *(("--user", user) if user is not None else ()),
            "--workdir", self.config.workdir,
            CONTAINER,
        ]

    async def _docker(self, argv: list[str], *, user: str | None = None, env: dict[str, str] | None = None):
        """One-shot `docker exec` returning the sandbox's ``CommandResult``."""
        await self._forwarded()
        assert self._sandbox is not None
        env = env or {}
        try:
            return await self._sandbox.exec(
                *self._docker_cmd(env, user=user), *argv, env=env, privileged=True
            )
        except (SessionNotFoundError, SessionTerminatedError) as e:
            raise SandboxError(f"tenki sandbox is gone: {e}") from e

    async def exec(self, runtime: Runtime, argv: list[str], env: dict[str, str]) -> RuntimeProcess:
        return await self._spawn(runtime, argv, env, stdin=True)

    async def _spawn(self, runtime: Runtime, argv: list[str], env: dict[str, str], *, stdin: bool) -> TenkiProcess:
        await self._forwarded()
        assert self._sandbox is not None
        values = runtime.process_env(env)
        pidfile = f"/tmp/vf-process-{uuid.uuid4().hex}.pid"
        command = [
            *self._docker_cmd(values, stdin=stdin, user=runtime.user),
            "sh", "-c", _WRAPPER, "vf-process", pidfile, *argv,
        ]
        try:
            process = await self._sandbox.start(*command, env=values, privileged=True)
        except (SessionNotFoundError, SessionTerminatedError) as e:
            raise SandboxError(f"tenki sandbox is gone: {e}") from e
        return TenkiProcess(self, process, pidfile, runtime.user)

    async def run(self, runtime: Runtime, argv: list[str], env: dict[str, str]) -> ProgramResult:
        process = await self._spawn(runtime, argv, env, stdin=False)
        try:
            await process._process.close_stdin()
            result = await process.result()
        except BaseException:
            with contextlib.suppress(Exception):
                await run_shielded(process.kill())
            raise
        return ProgramResult(result.exit_code, result.stdout_text, result.stderr_text)

    async def run_background(self, runtime: Runtime, argv: list[str], env: dict[str, str], log: str) -> None:
        # Docker owns the process as a detached exec; no client stays attached.
        await self._forwarded()
        assert self._sandbox is not None
        values = runtime.process_env(env)
        script = 'exec "$@" > "$0" 2>&1 < /dev/null'
        result = await self._sandbox.exec(
            *self._docker_cmd(values, user=runtime.user, detach=True),
            "sh", "-c", script, log, *argv, env=values, privileged=True,
        )
        if result.exit_code != 0:
            raise SandboxError(f"tenki background process failed: {result.stderr_text.strip()}")

    async def read(self, runtime: Runtime, path: str, max_bytes: int | None = None) -> bytes:
        reader = ["cat"] if max_bytes is None else ["head", "-c", str(max_bytes)]
        result = await self._docker([*reader, "--", path], user=runtime.user)
        if result.exit_code != 0:
            raise SandboxError(f"read {path!r}: {result.stderr_text.strip()}")
        return result.stdout

    async def write(self, runtime: Runtime, path: str, data: bytes) -> None:
        await self._forwarded()
        assert self._sandbox is not None
        script = 'mkdir -p "$(dirname "$1")" && cat > "$1"'
        command = [*self._docker_cmd({}, stdin=True, user=runtime.user), "sh", "-c", script, "vf-write", path]
        try:
            process = await self._sandbox.start(*command, privileged=True)
            for i in range(0, len(data), CHUNK_BYTES):
                await process.write_stdin(data[i : i + CHUNK_BYTES])
            await process.close_stdin()
            result = await process.wait()
        except (SessionNotFoundError, SessionTerminatedError) as e:
            raise SandboxError(f"tenki sandbox is gone: {e}") from e
        if result.exit_code != 0:
            raise SandboxError(f"write {path!r}: {result.stderr_text.strip()}")

    # -- host loopback ----------------------------------------------------------------

    def host_url(self, url: str) -> str:
        """The URL a program in the container uses to reach a host-bound `url`.

        A loopback port on the evaluator is forwarded to the same port on the sandbox's
        loopback (the container shares it), so the URL only changes host. The forward
        is opened in the background; every exec waits for it (`_forwarded`)."""
        parts = urlsplit(url)
        if parts.port is None or not _is_loopback(parts.hostname or ""):
            return url
        if parts.port not in self._forwards and self._sandbox is not None:
            self._forwards[parts.port] = asyncio.ensure_future(
                self._forward(parts.hostname or "127.0.0.1", parts.port)
            )
        return parts._replace(netloc=f"127.0.0.1:{parts.port}").geturl()

    async def _forward(self, host: str, port: int):
        assert self._sandbox is not None
        return await self._sandbox.expose_host_port_resilient(
            f"{host}:{port}", sandbox_bind_address="127.0.0.1", sandbox_port=port
        )

    async def _forwarded(self) -> None:
        if self._forwards:
            try:
                await asyncio.gather(*self._forwards.values())
            except Exception as e:
                raise SandboxError(f"tenki host-port forward failed: {e}") from e

    # -- teardown ---------------------------------------------------------------------

    async def teardown(self) -> None:
        forwards, self._forwards = list(self._forwards.values()), {}
        for forward in forwards:
            with contextlib.suppress(Exception):
                async with asyncio.timeout(10):
                    await (await forward).close()
        sandbox = self._sandbox
        if sandbox is None:
            return
        try:
            await sandbox.close_if_open()
        except Exception as e:  # noqa: BLE001 - best-effort; max_duration is the backstop
            logger.warning("tenki: failed to terminate sandbox %s: %s", self.info.id, e)
        finally:
            self._terminated = True

    def cleanup(self) -> None:
        # Synchronous atexit backstop (the event loop may be gone): end the sandbox through
        # the sync client. Idempotent: ending an ended sandbox is a no-op.
        if self.info.id is None or self._terminated:
            return
        with contextlib.suppress(Exception):
            Client().get(self.info.id).close_if_open()
