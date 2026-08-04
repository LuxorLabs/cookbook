# RAGFlow's code executor on Tenki

[RAGFlow](https://github.com/infiniflow/ragflow) is an open-source RAG engine whose agent workflows can include **code components** — Python or JavaScript snippets executed through pluggable sandbox providers. Since [ragflow#17305](https://github.com/infiniflow/ragflow/pull/17305), `tenki` is one of those providers (implemented in both Python and Go): each execution runs in a fresh [Tenki](https://tenki.cloud) microVM that is destroyed afterwards. Because it's cloud-hosted, there is nothing to operate locally — no gVisor, no Docker base images, no executor-manager service. Just an API key.

## Enable it

The `tenki-sandbox` SDK is an optional dependency (it needs `protobuf>=6.31`, which differs from RAGFlow's default gRPC stack), so install it into the RAGFlow runtime first:

```bash
pip install tenki-sandbox
```

Then configure the provider in **Admin > Sandbox Settings**:

| Setting | Notes |
| --- | --- |
| `api_key` (required) | create one at [app.tenki.cloud](https://app.tenki.cloud) under **API Keys** |
| `project_id` (required) | required by RAGFlow's schema; current Tenki no longer scopes sandboxes by project, so any identifier satisfies it |
| `image` | leave empty for the Tenki default image, which ships both `python3` and `node` |
| `allow_outbound` | **defaults to `false`** — sandboxed code gets no network unless you opt in (e.g. to install packages) |
| `timeout` / `max_lifetime` | per-execution limit (default 30 s) / server-side sandbox cap (default 3600 s) |
| `cpu_cores`, `memory_mb`, `disk_size_gb`, output & artifact limits | tunable, sensible defaults |

## What the provider does

- **Ephemeral by design**: create → execute → destroy, once per run. No volumes, no snapshots, nothing persists between executions.
- **Two languages**: Python (`python3`) and JavaScript (`node`), with wrapper scripts that inject the component's arguments.
- **Artifacts come back** (Python provider): anything the code writes to `artifacts/` in its working directory is collected over Tenki's file API — extension-whitelisted (`.csv .html .jpeg .json .pdf .png .svg`), size-capped, symlinks rejected. The Go port runs code with the same wrapping protocol but, like the Go e2b provider, does not collect artifacts.
- **Structured results**: stdout, stderr, exit code, and timing map to RAGFlow's `ExecutionResult`; timeouts and API failures map to clear error messages.
- **`max_duration` is a server-side cap**, so a sandbox self-terminates even if RAGFlow crashes mid-run — no leaked billing.

## Verify

```bash
uv venv && uv pip install -r requirements.txt
node verify.mjs        # or: .venv/bin/python verify.py
```

[`verify.py`](verify.py) proves the Tenki surface the provider is built on without running RAGFlow: the **`who_am_i()`** health check → an ephemeral sandbox with **outbound network off** (RAGFlow's security default) → the **Python** and **JavaScript** execution paths (script staged over `fs`, run with a timeout) → the **`artifacts/` read-back** transport → terminate. The provider's own upstream test suites (Python and Go) cover the RAGFlow-side contract.

## Notes

- **Auth:** the Python SDK wants a `tk_` API key (`export TENKI_API_KEY=tk_…`). A `tenki login` browser session token works too, but must be prefixed `cookie:` — `verify.py` does this for you.
- With `allow_outbound: false`, `pip install` inside components will fail by design; flip it on per RAGFlow's settings page when needed.
- Full setup docs: [sandbox quickstart](https://github.com/infiniflow/ragflow/blob/main/docs/guides/agent/agent_quickstarts/sandbox_quickstart.md) in the RAGFlow repo.
