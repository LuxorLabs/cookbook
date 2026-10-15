# How to run RAGFlow code components in Tenki microVMs

**Audience:** people who run [RAGFlow](https://github.com/infiniflow/ragflow), the open-source RAG engine, build agent workflows with code components (Python or JavaScript snippets), and want those snippets to run in a cloud sandbox instead of one they operate themselves.
**Time:** ~10 minutes, assuming RAGFlow is already running. The check in Step 5 caps its own run at 5 minutes. Its first run also downloads Go modules, and a Go toolchain if yours is older than 1.25.3.
**Outcome:** RAGFlow's built-in `tenki` sandbox provider is active, so each code execution runs in a fresh [Tenki](https://tenki.cloud) microVM that is destroyed afterwards. You also have a passing check, run from this directory, of the Tenki calls the provider is built on.

> **Honesty note:** the provider creates every sandbox with outbound network off unless you set `allow_outbound`. That's the reverse of the Tenki SDK's own default, and it means a `pip install` inside a code component fails until you turn it on. Also, this directory doesn't contain the provider. The provider ships inside RAGFlow, and the check here exercises the same Tenki calls without running RAGFlow.

## Why bother

RAGFlow's code components run through pluggable sandbox providers. The default, `self_managed`, runs code in Docker-managed sandbox containers behind an executor-manager service that you deploy. Since [ragflow#17305](https://github.com/infiniflow/ragflow/pull/17305), `tenki` is one of the providers. Because it's cloud-hosted, there's nothing to operate locally: no gVisor, no Docker base images, no executor-manager service, only an API key. Each execution gets its own microVM, and nothing persists from one execution to the next.

## Prerequisites

- RAGFlow v1.0.0-rc1 or later, or v0.27.x (see Step 2), and admin access to **Admin > Sandbox Settings**.
- Outbound network access from the RAGFlow server to Tenki.
- A Tenki account, to create a `tk_` API key at [app.tenki.cloud](https://app.tenki.cloud).
- For the check in Step 5: Go 1.21 or newer, and Node for the `verify.mjs` shim (CI uses Node 20). `go.mod` declares `go 1.25.3`. An older Go downloads that toolchain on the first run, under the default `GOTOOLCHAIN=auto`.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/ragflow-tenki
```

Every later command runs from this directory. It holds the check, [`main.go`](main.go) with its `go.mod` and `go.sum`, and `verify.mjs`, a shim that runs `go run .` for the cookbook's Node verify harness. There's no RAGFlow code here and nothing to copy into RAGFlow.

## Step 2 — Install the provider

**RAGFlow v1.0.0-rc1 and later.** The provider lives in RAGFlow's Go server ([`internal/agent/sandbox/tenki.go`](https://github.com/infiniflow/ragflow/blob/main/internal/agent/sandbox/tenki.go)), and its SDK, `github.com/LuxorLabs/tenki-sdk-go/sandbox`, is a regular `go.mod` dependency of RAGFlow, so there's nothing to install. RAGFlow pins that SDK at `v0.7.0`.

**RAGFlow v0.27.x with the default Python server.** RAGFlow uses the older Python provider instead, which was removed from RAGFlow main in [ragflow#20389](https://github.com/infiniflow/ragflow/pull/20389). That provider needs the Python SDK installed into the RAGFlow runtime:

```bash
pip install tenki
```

The `tenki` package also provides the `tenki_sandbox` module that the v0.27.x provider imports. The old `tenki-sandbox` package is no longer on PyPI.

## Step 3 — Configure it in Admin > Sandbox Settings

Select `tenki` as the provider and fill in the settings. Saved settings apply to the next execution, with no restart.

| Setting | Notes |
| --- | --- |
| `api_key` (required) | A `tk_` API key. Create one at [app.tenki.cloud](https://app.tenki.cloud) under **API Keys**. |
| `image` | Leave empty for the Tenki default image, which ships both `python3` and `node`. |
| `allow_outbound` | **Defaults to `false`.** Sandboxed code gets no network unless you opt in, for example to install packages. |
| `timeout` / `max_lifetime` | Per-execution limit (default 30 s, 1–600) / server-side sandbox cap (default 3600 s, 60–86400). |
| `base_url` | Overrides the API endpoint. Empty uses Tenki cloud. |
| `cpu_cores`, `memory_mb`, `disk_size_gb` | `0` uses the Tenki default. |
| `max_output_bytes`, `max_artifacts`, `max_artifact_bytes` | 1 MiB / 20 / 10 MiB by default. |

Tenki infers the workspace from the API key, so there's no workspace or project field. RAGFlow's [sandbox quickstart](https://github.com/infiniflow/ragflow/blob/main/docs/administrator/configurations/sandbox_quickstart.md) still lists a required `project_id`. The provider no longer has that field ([ragflow#18117](https://github.com/infiniflow/ragflow/pull/18117)), so leave it out.

After saving, test the connection on the same page, as RAGFlow's quickstart describes. The test creates a Tenki sandbox with these settings, runs a short Python program in it, and destroys it, so a passing test means sandbox creation and execution both work.

**Configuring from the environment instead.** On the Go server, an empty `base_url` falls back to `TENKI_API_URL`. The admin page won't save Tenki settings without an `api_key`, so to supply the key from the environment, save no sandbox settings and let the Go server build its provider from the environment: set `SANDBOX_PROVIDER_TYPE=tenki` (the default is `self_managed`) and `TENKI_API_KEY`. `TENKI_API_URL`, `TENKI_IMAGE`, `TENKI_TIMEOUT` and `TENKI_ALLOW_OUTBOUND=true` are optional. Saved admin settings take precedence over all of these.

## Step 4 — Know what each execution does

On the Go provider (RAGFlow v1.0.0-rc1 and later):

- **Ephemeral by design.** Create, execute, destroy, once per run. No volumes, no snapshots, nothing persists between executions. Destroying a sandbox that's already gone (not found, terminated, or expired) counts as success.
- **Two languages.** Python runs as `python3 -c` and JavaScript as `node -e`, in a per-instance work dir, `/home/tenki/ragflow-codeexec-<session id>`, with a wrapper that injects the component's arguments and returns `main()`'s value. The work dir sits under `/home/tenki`, the sandbox's working directory, which is where the SDK's file methods, used for artifact collection, are confined.
- **One time limit.** `timeout` caps each execution. A component can ask for less time but not more, because the provider caps it at the setting. The same value is also the HTTP timeout and how long the provider waits for a new sandbox to come up.
- **Artifacts come back.** Anything the code writes to `artifacts/` in the work dir is collected over Tenki's file API (list, stat, read). Collection is extension-allowlisted (`.csv`, `.html`, `.jpeg`, `.jpg`, `.json`, `.pdf`, `.png`, `.svg`), size- and count-capped, limited to 16 levels of nested directories, and rejects symlinks.
- **Structured results.** stdout, stderr, exit code and timing map to RAGFlow's `ExecutionResult`. A non-zero exit comes back as a normal result. stdout and stderr together must fit in `max_output_bytes`. When an exec call fails outright, the error names the command but leaves out your code and arguments.
- **A server-side lifetime cap.** Each sandbox is created with `max_lifetime` as its maximum duration on Tenki's side, so a sandbox that RAGFlow never destroys, for example because RAGFlow crashed mid-run, ends at that cap instead of running on.

On v0.27.x, the Python provider instead writes the code to `main.py` or `main.js` in `/home/tenki/ragflow-codeexec-<random id>` and runs it as `python3 <file>` or `node <file>`. The caps, allowlist and outbound default are the same.

Every sandbox also carries the metadata `source: ragflow`. The check in Step 5 makes the Go provider's create call with fixed values in place of the settings. From `main.go`:

```go
  // CreateInstance: disposable sandbox, network off, server-side lifetime cap
  sess, err := client.Create(ctx,
    tenkisdk.WithAllowOutbound(false),
    tenkisdk.WithMaxDuration(time.Hour),
    tenkisdk.WithWaitTimeout(2*time.Minute),
    tenkisdk.WithMetadata(map[string]string{"source": "ragflow"}),
    tenkisdk.WithCPUCores(1),
    tenkisdk.WithMemoryMB(1024),
  )
  if err != nil {
    return fmt.Errorf("Create: %w", err)
  }
  defer func() {
    cctx, ccancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer ccancel()
    _ = sess.Close(cctx) // DestroyInstance; max duration reaps it otherwise
  }()
  workDir := path.Join("/home/tenki", "ragflow-codeexec-"+sess.ID)
  if err := sess.Mkdir(ctx, path.Join(workDir, "artifacts")); err != nil {
    return fmt.Errorf("Mkdir: %w", err)
  }
```

## Step 5 — Check it works

```bash
export TENKI_API_KEY=tk_...   # or `tenki login --api-key tk_...`
node verify.mjs               # or: go run .
```

`main.go` reads the key from `TENKI_API_KEY`, then `TENKI_AUTH_TOKEN`, then the `auth_token` line that `tenki login --api-key <key>` writes to `~/.config/tenki/config.yaml`. It uses the same SDK module RAGFlow uses, at its latest release. From `go.mod`:

```
module ragflow-tenki-verify

go 1.25.3

require github.com/LuxorLabs/tenki-sdk-go/sandbox v1.4.1
```

On success it prints:

```
✓ ragflow-tenki: WhoAmI → outbound-off sandbox → python3 -c (42) → node -e → artifacts/ collected → close
```

In order, the check makes the `WhoAmI` health check, creates a disposable sandbox with outbound network off (RAGFlow's security default), makes the work dir with `artifacts/`, and runs `python3 -c` and `node -e` with a 30-second timeout. Then Python writes `artifacts/result.json`, and the check collects it the way the provider does: it lists the directory, stats the file to make sure it isn't a symlink, and reads it back. Finally it closes the sandbox. The whole run is capped at 5 minutes. Any failure exits non-zero. A failure inside the check prints a `✗` line.

This proves that your key works and that the Tenki calls the provider is built on work against your account, on the current Go SDK. On v0.27.x the provider uses the Python SDK, which this check doesn't touch. The check doesn't run RAGFlow, so the admin settings, the argument wrapper and `main()` result, and the artifact allowlist and caps aren't exercised, and neither is the `v0.7.0` SDK RAGFlow pins. RAGFlow's own [`tenki_test.go`](https://github.com/infiniflow/ragflow/blob/main/internal/agent/sandbox/tenki_test.go) covers the RAGFlow-side contract. This is the check CI runs, with only `TENKI_API_KEY` set.

To check inside RAGFlow, use the connection test on **Admin > Sandbox Settings**, then run an agent workflow that has a code component.

## Troubleshooting

The `tenki: …` messages below come from the Go provider in RAGFlow v1.0.0-rc1 and later.

**❌ `` ✗ no token: set TENKI_API_KEY, or run `tenki login` ``.** The check found no key in `TENKI_API_KEY`, `TENKI_AUTH_TOKEN` or `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.

**❌ `✗ could not run go: …`.** `verify.mjs` couldn't start the `go` binary. Install Go 1.21 or newer and put it on your `PATH`.

**❌ `tenki: API key is required (set it in Admin > Sandbox Settings or TENKI_API_KEY)`.** RAGFlow's provider found no key in the saved settings or the server environment, so RAGFlow doesn't register it. Set `api_key` in **Admin > Sandbox Settings**, or `TENKI_API_KEY` in the RAGFlow server's environment.

**❌ `` tenki is required for the Tenki sandbox provider. Install it with `pip install tenki` (or `uv pip install tenki`). ``** You're on v0.27.x, where the Python provider's SDK is an optional dependency that RAGFlow doesn't install. Run `pip install tenki` in the environment RAGFlow's Python server runs in.

**❌ `pip install` or any other network call fails inside a code component.** `allow_outbound` defaults to `false`, so sandboxed code has no network, by design. Turn it on in **Admin > Sandbox Settings** when you need it.

**❌ `tenki: exec python3: …` or `tenki: exec node: …`.** The command failed without producing a result, from a transport, timeout or session error. A component can't run longer than `timeout` (30 s by default), whatever it asks for. If your code needs longer, raise `timeout`, up to 600 s.

**❌ `tenki: output exceeds 1048576 bytes`.** stdout and stderr together went over `max_output_bytes` (1 MiB by default). Print less, or raise `max_output_bytes`.

**❌ `tenki: collect artifacts: …`.** A file in `artifacts/` couldn't be collected, and the rest of the message says why. The rule-based reasons include:
- `unsupported artifact type`: the extension isn't `.csv`, `.html`, `.jpeg`, `.jpg`, `.json`, `.pdf`, `.png` or `.svg`. Save the output in one of those formats.
- `execution produced more than 20 artifacts` or `artifact exceeds 10485760 bytes`: the `max_artifacts` or `max_artifact_bytes` cap. Write fewer or smaller files, or raise the setting.
- `artifact symlinks are not allowed`: write regular files, not symlinks.
- `artifact directory nesting exceeds 16 levels`: flatten the directory tree under `artifacts/`.

## FAQ

**When shouldn't I use this?**
When code or data must stay on your own infrastructure: every execution runs in Tenki's cloud, and the RAGFlow server needs outbound network access to reach it. When executions need to share state: nothing persists between them, with no volumes or snapshots. And when you need a language other than Python or JavaScript, the only two the provider supports.

**Do I need a Tenki project ID?**
No. The provider dropped `project_id` in [ragflow#18117](https://github.com/infiniflow/ragflow/pull/18117), and Tenki infers the workspace from the API key. Ignore the `project_id` line in RAGFlow's sandbox quickstart.

**Can a code component run longer than 30 seconds?**
Yes, up to 600 seconds: raise `timeout` in **Admin > Sandbox Settings** (it accepts 1–600). A component's own timeout is capped at that setting. `max_lifetime` (3600 s by default, 60–86400) is the separate cap on how long the sandbox itself may live.

**Why is the check written in Go, and why a newer SDK than RAGFlow's?**
On RAGFlow main the provider is Go-only, so the check uses the same Go SDK module. It pins the latest release, `v1.4.1`, while RAGFlow still pins `v0.7.0`.

## Related

- [RAGFlow](https://github.com/infiniflow/ragflow) and its [sandbox quickstart](https://github.com/infiniflow/ragflow/blob/main/docs/administrator/configurations/sandbox_quickstart.md)
- The provider, [`internal/agent/sandbox/tenki.go`](https://github.com/infiniflow/ragflow/blob/main/internal/agent/sandbox/tenki.go), and its tests, [`tenki_test.go`](https://github.com/infiniflow/ragflow/blob/main/internal/agent/sandbox/tenki_test.go)
- [ragflow#17305](https://github.com/infiniflow/ragflow/pull/17305) (adds the provider), [ragflow#18117](https://github.com/infiniflow/ragflow/pull/18117) (drops `project_id`), [ragflow#20389](https://github.com/infiniflow/ragflow/pull/20389) (removes the Python provider)
- [Tenki Go SDK](https://github.com/LuxorLabs/tenki-sdk-go) and the [Tenki docs](https://tenki.cloud/docs)
- [`../deerflow-tenki/`](../deerflow-tenki/): DeerFlow's built-in Tenki sandbox provider
- [`../files-in-a-sandbox/`](../files-in-a-sandbox/): the SDK file API that artifact collection uses
