# DeerFlow's sandbox on Tenki

[DeerFlow](https://github.com/bytedance/deer-flow) — ByteDance's open-source SuperAgent harness — runs the code its agents write inside pluggable sandboxes. Since [deer-flow#4382](https://github.com/bytedance/deer-flow/pull/4382), Tenki ships as a community-supported provider alongside E2B and AIO: teams already running agent infrastructure on [Tenki](https://tenki.cloud) microVMs point DeerFlow at the same workspace instead of provisioning a parallel sandbox vendor.

## Enable it

The provider's `tenki-sandbox` dependency is an optional extra — uninstalled by default, lazily imported only when selected:

```bash
git clone https://github.com/bytedance/deer-flow && cd deer-flow/backend
uv sync --extra tenki
```

Opt in via `config.yaml` (see `config.example.yaml` upstream for every knob):

```yaml
sandbox:
  use: deerflow.community.tenki:TenkiSandboxProvider
  api_key: $TENKI_API_KEY
  cpu_cores: 2
  memory_mb: 2048
  replicas: 3          # warm-pool size
  idle_timeout: 600    # seconds before an idle sandbox is evicted
  max_duration: 14400  # hard server-side lifetime cap
  sticky: false
```

Optional keys: `base_url`, `image`, `workspace_id`, `home_dir` (default `/home/tenki`), and an `environment:` map injected into every sandbox. `project_id` is accepted for legacy configs; current Tenki no longer scopes sandboxes by project.

## What the provider does

- **The full DeerFlow `Sandbox` contract** — `execute_command`, file read/write/append, upload/download, `list_dir`, `glob`, and `grep` — mapped onto one Tenki microVM per replica.
- **Virtual path mapping**: DeerFlow's `/mnt/user-data` namespace translates to the sandbox home directory on the way in and back on the way out.
- **Native file transport**: uploads and downloads ride Tenki's `sandbox.fs` streaming API rather than shell pipes, so binary and Unicode content survive untouched.
- **Warm-pool lifecycle**: the provider reuses DeerFlow's pooling mixin for `replicas`, idle eviction, and orphan reconciliation; download failures evict the sandbox rather than poisoning the pool.
- **Shell semantics**: commands execute under `sh -lc`; `glob`/`grep` delegate to busybox-portable `find`/`grep` inside the VM.

## Verify

```bash
uv venv && uv pip install -r requirements.txt
node verify.mjs        # or: .venv/bin/python verify.py
```

[`verify.py`](verify.py) proves the Tenki surface the provider is built on without installing DeerFlow: **create with `wait=False` + `wait_ready()`** (the warm-pool boot path) → **`sh -lc`** exec → **`sandbox.fs`** streaming round-trip (`mkdir`, `write_stream`, `read_text`, `stat`) → busybox **`find`/`grep`** → terminate. The provider's own 49-test suite upstream covers the DeerFlow-side contract (path mapping, pool behavior, eviction).

## Notes

- **Auth:** the Python SDK wants a `tk_` API key (`export TENKI_API_KEY=tk_…`). A `tenki login` browser session token works too, but must be prefixed `cookie:` — `verify.py` does this for you.
- The provider is fully opt-in: with `sandbox.use` unset, DeerFlow behaves exactly as before.
- Every sandbox carries `max_duration` server-side, so orphans self-terminate even if the harness crashes — no leaked billing.
