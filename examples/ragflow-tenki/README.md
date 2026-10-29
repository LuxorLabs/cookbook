# RAGFlow

Let RAGFlow agents run Python and JavaScript safely, each run on a fresh Tenki cloud machine.

[RAGFlow](https://github.com/infiniflow/ragflow) is an open-source platform for building AI apps on top of your own documents. It's built around **RAG** (retrieval-augmented generation): finding the passages in your documents that answer a question and giving them to a model along with the question. RAGFlow also lets you build **agent workflows** by connecting blocks in a visual editor. One of those blocks, the **code component**, runs a short Python or JavaScript program, for example to clean up data or call an API.

That code has to run somewhere isolated. RAGFlow's own option needs extra services on your server. Its `tenki` **sandbox provider** instead runs each execution in a new Tenki sandbox and deletes it afterwards, so there's nothing extra to install or run.

The steps below switch RAGFlow to Tenki. This folder's `main.go` is a quicker check that your Tenki key works and the provider's Tenki calls succeed, without RAGFlow.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Help me run RAGFlow's code components in Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/main/examples/ragflow-tenki.
1. Check which RAGFlow version I run. On v1.0.0-rc1 or later the tenki provider is built in. On v0.27.x, install the tenki package into RAGFlow's Python environment.
2. Walk me through selecting tenki in Admin > Sandbox Settings and setting api_key myself (a Tenki key starting with tk_, from https://app.tenki.cloud), then running the connection test. Never ask me to paste the key to you.
3. To check the Tenki side outside RAGFlow: clone https://github.com/LuxorLabs/cookbook and cd into examples/ragflow-tenki. It needs TENKI_API_KEY exported; if it isn't set, stop and ask me to export it. Never print the key or write it to a file. Check Go 1.21+ is installed, run node verify.mjs, and confirm the ✓ line.
4. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- RAGFlow v1.0.0-rc1 or later (or v0.27.x, see below), with admin access to **Admin > Sandbox Settings**.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- Outbound network access from the RAGFlow server to Tenki.
- For step 4: Go 1.21 or later and Node.js 20 or later.

### 1. Install the provider

On RAGFlow v1.0.0-rc1 and later, the provider is built into the Go server ([`internal/agent/sandbox/tenki.go`](https://github.com/infiniflow/ragflow/blob/main/internal/agent/sandbox/tenki.go)), so there's nothing to install.

On v0.27.x with the Python server, install the SDK into RAGFlow's runtime:

```bash
pip install tenki
```

### 2. Set your API key

In **Admin > Sandbox Settings**, select `tenki` and set `api_key`. Saved settings apply to the next execution, with no restart. Leave out `project_id`, which RAGFlow's quickstart still lists; Tenki infers the workspace from the key.

To configure it from the environment instead, save no sandbox settings and set `SANDBOX_PROVIDER_TYPE=tenki` and `TENKI_API_KEY` on the RAGFlow server. `TENKI_API_URL`, `TENKI_IMAGE`, `TENKI_TIMEOUT`, and `TENKI_ALLOW_OUTBOUND=true` are optional. Saved settings win over these.

### 3. Run

Use the connection test on the same page. It creates a sandbox with your settings, runs a short Python program, and deletes it. Then run an agent workflow that has a code component; its code now runs on Tenki.

### 4. Verify

To check your key and the Tenki side outside RAGFlow:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/ragflow-tenki
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN or a `tenki login` key also work
node verify.mjs               # or: go run .
```

```
✓ ragflow-tenki: WhoAmI → outbound-off sandbox → python3 -c (42) → node -e → artifacts/ collected → close
```

`main.go` uses the same Go SDK module as RAGFlow, at its latest release:

```
module ragflow-tenki-verify

go 1.25.3

require github.com/LuxorLabs/tenki-sdk-go/sandbox v1.4.1
```

It checks your key (`WhoAmI`), creates a sandbox with outbound network off, runs `python3 -c` and `node -e`, collects `artifacts/result.json` the way the provider does (list, stat, read), and closes the sandbox. The run is capped at 5 minutes. The first run downloads Go modules, and the Go 1.25.3 toolchain if yours is older. It doesn't run RAGFlow or touch the v0.27.x Python provider; RAGFlow's [`tenki_test.go`](https://github.com/infiniflow/ragflow/blob/main/internal/agent/sandbox/tenki_test.go) covers the RAGFlow side.

## Settings

| Setting | Notes |
| --- | --- |
| `api_key` (required) | A `tk_` API key. Create one at [app.tenki.cloud](https://app.tenki.cloud) under **API Keys**. |
| `image` | Leave empty for the Tenki default image, which ships both `python3` and `node`. |
| `allow_outbound` | **Defaults to `false`.** Sandboxed code gets no network unless you opt in, for example to install packages. |
| `timeout` / `max_lifetime` | Per-execution limit (default 30 s, 1–600) / server-side sandbox cap (default 3600 s, 60–86400). |
| `base_url` | Overrides the API endpoint. Empty uses Tenki cloud. |
| `cpu_cores`, `memory_mb`, `disk_size_gb` | `0` uses the Tenki default. |
| `max_output_bytes`, `max_artifacts`, `max_artifact_bytes` | 1 MiB / 20 / 10 MiB by default. |

## What each execution does

- **Create, run, delete.** Nothing carries over between executions. Tenki deletes each sandbox after `max_lifetime` no matter what, so one RAGFlow fails to delete still goes away.
- **Python and JavaScript.** A code component defines a `main()` function. The provider wraps it so it receives the component's inputs and its return value comes back to RAGFlow, then runs it with `python3 -c` or `node -e` in `/home/tenki/ragflow-codeexec-<session id>`.
- **One time limit.** `timeout` caps each execution. A component can ask for less but not more.
- **Output files come back.** Files the code writes to `artifacts/` are collected if their extension is `.csv`, `.html`, `.jpeg`, `.jpg`, `.json`, `.pdf`, `.png`, or `.svg`, within the count and size caps, at most 16 directories deep, and not symlinks.
- **Results.** Output, error output, exit code, and timing go back to RAGFlow as the component's result. A non-zero exit code is reported as a result, not as a provider failure.

On v0.27.x the Python provider writes `main.py` or `main.js` and runs the file, with the same caps and defaults.

The check makes the Go provider's create call. From `main.go`:

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

## Things to know

- **Outbound network is off by default**, the reverse of the SDK's default. A `pip install` inside a code component fails until you turn on `allow_outbound`.
- Every execution runs in Tenki's cloud, so use the `self_managed` provider if code or data must stay on your infrastructure.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `` ✗ no token: set TENKI_API_KEY, or run `tenki login` `` | Export a `tk_` key, or run `tenki login --api-key <key>`. |
| `✗ could not run go: …` | Install Go 1.21 or later and put it on your `PATH`. |
| `tenki: API key is required (set it in Admin > Sandbox Settings or TENKI_API_KEY)` | Set `api_key` in Sandbox Settings, or `TENKI_API_KEY` on the RAGFlow server. |
| `` tenki is required for the Tenki sandbox provider. Install it with `pip install tenki` … `` | On v0.27.x, run `pip install tenki` in RAGFlow's Python environment. |
| `pip install` or another network call fails in a component | Turn on `allow_outbound`. |
| `tenki: exec python3: …` or `tenki: exec node: …` | The command failed outright, often by passing `timeout`. Raise `timeout`, up to 600 s. |
| `tenki: output exceeds 1048576 bytes` | Print less, or raise `max_output_bytes`. |
| `tenki: collect artifacts: unsupported artifact type` | Save output in an allowed format. |
| `tenki: collect artifacts: execution produced more than 20 artifacts` or `artifact exceeds 10485760 bytes` | Write fewer or smaller files, or raise `max_artifacts` or `max_artifact_bytes`. |
| `tenki: collect artifacts: artifact symlinks are not allowed` or `… nesting exceeds 16 levels` | Write regular files, and flatten `artifacts/`. |

## Related

- [RAGFlow](https://github.com/infiniflow/ragflow) and its [sandbox quickstart](https://github.com/infiniflow/ragflow/blob/main/docs/administrator/configurations/sandbox_quickstart.md)
- [ragflow#17305](https://github.com/infiniflow/ragflow/pull/17305) (adds the provider), [ragflow#18117](https://github.com/infiniflow/ragflow/pull/18117) (drops `project_id`), [ragflow#20389](https://github.com/infiniflow/ragflow/pull/20389) (removes the Python provider)
- [Tenki Go SDK](https://github.com/LuxorLabs/tenki-sdk-go) and the [Tenki docs](https://tenki.cloud/docs)
- [DeerFlow](../deerflow-tenki/): another app with a built-in Tenki sandbox provider
