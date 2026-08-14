# Open WebUI code execution on Tenki

Give any model in [Open WebUI](https://github.com/open-webui/open-webui) — the self-hosted ChatGPT-style interface for Ollama and OpenAI-compatible APIs — a real code interpreter. Every run executes in its own disposable [Tenki](https://tenki.cloud) microVM: a fresh Linux VM with real root, created on demand and destroyed when the run finishes, so untrusted model-generated code never touches your Open WebUI host. Built on [`LuxorLabs/tenki-open-webui`](https://github.com/LuxorLabs/tenki-open-webui).

## Two plugins, one core

Both are single-file plugins built from the same execution core — install either or both from the [v0.1.0 release](https://github.com/LuxorLabs/tenki-open-webui/releases/tag/v0.1.0):

- **Tool — [`tenki_code_execution.py`](https://github.com/LuxorLabs/tenki-open-webui/releases/download/v0.1.0/tenki_code_execution.py).** Exposes `execute_code(code, language)` to the model, which calls it autonomously mid-conversation and iterates on the output (`[exit=0, 1.2s] stdout: …`). Python runs echo the last expression REPL-style, and matplotlib figures are auto-captured and rendered inline in the chat as images.
- **Action — [`tenki_run_code.py`](https://github.com/LuxorLabs/tenki-open-webui/releases/download/v0.1.0/tenki_run_code.py).** Adds a **Run code** button under assistant messages: click it and the last fenced code block re-executes in a fresh sandbox, with the output appended to the message.

## Install (paste, no pip)

1. In Open WebUI: **Workspace → Tools → +** (or **Admin Panel → Functions → +** for the Action).
2. Paste the release file's contents and save. Open WebUI reads the `requirements: tenki[async]>=0.5.1` line in the docstring frontmatter and auto-installs the SDK — nothing to pip-install yourself.
3. Open the plugin's **Valves** (gear icon) and set `tenki_api_key`.
4. For the Tool: enable it per-model or per-chat so the model can call it.

## Valves (configuration)

| Valve | Default | Notes |
| --- | --- | --- |
| `tenki_api_key` | — | Required. Admin key, stored server-side. |
| `tenki_api_endpoint` | `https://api.tenki.cloud` | Override for self-hosted/staging. |
| `tenki_workspace_id` | account default | Optional. |
| `default_language` | `python` | `python` or `shell`. |
| `cpu_cores` / `memory_mb` / `disk_size_gb` | 1 / 512 / 5 | Per-sandbox size. |
| `timeout_seconds` | 300 | Hard cap per run; the microVM also self-destructs server-side. |
| `network_egress` | **false** | Sandboxes get no outbound network unless you opt in. |
| `max_concurrent_executions` | 5 | Instance-wide semaphore. |
| `max_output_bytes` | 100000 | Output truncation cap. |

**Per-user keys:** each user can set their own `tenki_api_key` in UserValves (chat settings); it takes precedence over the admin key, so usage bills to the right account on shared instances.

## Verify

```bash
uv venv --python 3.12
uv pip install -r requirements.txt
export TENKI_AUTH_TOKEN=tk_...   # or `tenki login`
node verify.mjs                  # or: .venv/bin/python verify.py
```

`verify.py` drives the **real release artifact**, not a copy: it downloads the pinned v0.1.0 Tool from the GitHub release, loads it standalone (proving it imports with only `tenki` + `pydantic` — exactly what Open WebUI auto-installs), asserts the safe defaults (egress off, per-user key precedence), then calls `execute_code("print(6 * 7)")` against a live Tenki sandbox → `42`.

## Notes

- Uses the new [`tenki`](https://pypi.org/project/tenki/) SDK (`tenki[async]>=0.5.1`, `AsyncSandbox`) — not the older `tenki-sandbox` package.
- Every execution is a fresh microVM with guaranteed teardown: `sandbox.close()` runs even on timeout or crash, and a server-side `max_duration` backstop kills stragglers — no leaked billing.
- Auth: a `tk_` API key works as-is. A `tenki login` browser session token must be prefixed `cookie:<token>` for the Python SDK (`verify.py` does this for you).
- Source, build tooling, and both plugins: [github.com/LuxorLabs/tenki-open-webui](https://github.com/LuxorLabs/tenki-open-webui).
