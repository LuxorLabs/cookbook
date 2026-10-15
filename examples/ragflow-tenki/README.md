# RAGFlow's code executor on Tenki

[RAGFlow](https://github.com/infiniflow/ragflow) is an open-source RAG engine whose agent workflows can include **code components** — Python or JavaScript snippets executed through pluggable sandbox providers. Since [ragflow#17305](https://github.com/infiniflow/ragflow/pull/17305), `tenki` is one of those providers: each execution runs in a fresh [Tenki](https://tenki.cloud) microVM that is destroyed afterwards. Because it's cloud-hosted, there is nothing to operate locally — no gVisor, no Docker base images, no executor-manager service — only an API key.

## Enable it

On RAGFlow v1.0.0-rc1 and later, the provider lives in RAGFlow's Go server ([`internal/agent/sandbox/tenki.go`](https://github.com/infiniflow/ragflow/blob/main/internal/agent/sandbox/tenki.go)) and its SDK, `github.com/LuxorLabs/tenki-sdk-go/sandbox`, is a regular `go.mod` dependency, so there is nothing to install. On v0.27.x with the default Python server, RAGFlow uses the older Python provider instead, which was removed from RAGFlow main in [ragflow#20389](https://github.com/infiniflow/ragflow/pull/20389). For that provider, install the SDK into the RAGFlow runtime with `pip install tenki` (the old `tenki-sandbox` package is no longer on PyPI).

Configure it in **Admin > Sandbox Settings** (saved settings apply to the next execution, no restart):

| Setting | Notes |
| --- | --- |
| `api_key` (required) | create one at [app.tenki.cloud](https://app.tenki.cloud) under **API Keys** |
| `image` | leave empty for the Tenki default image, which ships both `python3` and `node` |
| `allow_outbound` | **defaults to `false`** — sandboxed code gets no network unless you opt in (e.g. to install packages) |
| `timeout` / `max_lifetime` | per-execution limit (default 30 s) / server-side sandbox cap (default 3600 s) |
| `base_url` | override the API endpoint; empty uses Tenki cloud |
| `cpu_cores`, `memory_mb`, `disk_size_gb` | `0` uses the Tenki default |
| `max_output_bytes`, `max_artifacts`, `max_artifact_bytes` | 1 MiB / 20 / 10 MiB by default |

Without saved settings the provider falls back to `TENKI_API_KEY` (and `TENKI_API_URL`) in the server environment. RAGFlow's sandbox quickstart still lists a required `project_id`; the provider no longer has that field ([ragflow#18117](https://github.com/infiniflow/ragflow/pull/18117)).

## What the provider does

- **Ephemeral by design**: create → execute → destroy, once per run. No volumes, no snapshots, nothing persists between executions.
- **Two languages**: Python (`python3 -c`) and JavaScript (`node -e`), run in a per-instance work dir (`/home/tenki/ragflow-codeexec-<session id>`) with a wrapper that injects the component's arguments and returns `main()`'s value.
- **Artifacts come back**: anything the code writes to `artifacts/` in the work dir is collected over Tenki's file API (list, stat, read): extension-allowlisted, size- and count-capped, symlinks rejected.
- **Structured results**: stdout, stderr, exit code, and timing map to RAGFlow's `ExecutionResult`; timeouts and API failures map to clear error messages.
- **`max_duration` is a server-side cap**, so a sandbox self-terminates even if RAGFlow crashes mid-run — no leaked billing.

## Verify

```bash
node verify.mjs        # or: go run .   (Go 1.21+; `go.mod` pins toolchain 1.25.3)
```

[`main.go`](main.go) exercises the Tenki calls the provider is built on, without running RAGFlow: the `WhoAmI` health check, a disposable sandbox with outbound network off (RAGFlow's security default), the work dir with `artifacts/`, `python3 -c` and `node -e` with a timeout, artifact collection (list, stat, read), and close. It uses the same SDK module RAGFlow uses, at its latest release (`v1.4.1`; RAGFlow itself still pins `v0.7.0`). RAGFlow's own `tenki_test.go` covers the RAGFlow-side contract.

## Notes

- **Auth:** use a `tk_` API key (`export TENKI_API_KEY=tk_…`).
- With `allow_outbound: false`, `pip install` inside components will fail by design; turn it on in **Admin > Sandbox Settings** when needed.
- Full setup docs: [sandbox quickstart](https://github.com/infiniflow/ragflow/blob/main/docs/administrator/configurations/sandbox_quickstart.md) in the RAGFlow repo.
