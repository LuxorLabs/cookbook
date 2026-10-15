# How to give Claude or Cursor a Tenki sandbox over MCP

**Audience:** Developers who use an MCP client (Claude Desktop, Cursor, or Claude Code) and want their agent to run code in a disposable microVM without writing any SDK code.
**Time:** ~5 minutes.
**Outcome:** Your MCP client lists the `tenki_*` tools, your agent runs a snippet in a fresh Tenki sandbox, and `node verify.mjs` drives a real sandbox through MCP tool calls against live Tenki.

> **Honesty note:** Creating, reading, and terminating sandboxes goes through Tenki's public control plane. Running code, reading `tenki_exec` output, and the file tools also go through each sandbox's own data-plane endpoint, and that endpoint may not be reachable from every network. `verify.mjs` reports `tenki_run_code` as skipped, not failed, when it can't reach the data plane. A passing run proves code execution only if you see the `tenki_run_code` `✓` line.

## Why bother

[`tenki-mcp`](https://github.com/LuxorLabs/tenki-mcp) (published on npm as [`@tenkicloud/mcp`](https://www.npmjs.com/package/@tenkicloud/mcp)) is a [Model Context Protocol](https://modelcontextprotocol.io) server for Tenki. Point your MCP client at it and your agent gets disposable Tenki microVMs as native tools: it can create sandboxes, run code, read and write files, run git, expose preview URLs, and manage snapshots, volumes, and templates. Every public unary method in the Tenki API has a tool, and a CI parity audit enforces that. You don't write SDK code. You add one config entry.

A few of the tools:

| Tool | What it does |
|---|---|
| `tenki_run_code` | one-shot: boot a microVM, run a shell, Python, or JavaScript snippet, return stdout, stderr, and exit code, tear the sandbox down |
| `tenki_create_sandbox` / `tenki_exec` | a persistent sandbox, and commands run in it |
| `tenki_read_file` / `tenki_write_file` | UTF-8 text file I/O, paths under `/home/tenki` |
| `tenki_git` | `clone`, `checkout`, `diff`, and `log` only. Run other git commands (commit, push) through `tenki_exec` |
| `tenki_expose_port` | expose a port from a sandbox and get a public preview URL |
| `tenki_create_preview_url` | a shareable public URL for a port a server in the sandbox listens on. The sandbox must be created with inbound networking (`allow_inbound`) |
| `tenki_create_snapshot` / `tenki_create_volume` | checkpoint a sandbox / create a persistent volume |
| `tenki_auth_status` | reports whether the server found a working credential, without returning it |

Full list: the [tenki-mcp README](https://github.com/LuxorLabs/tenki-mcp#tools). The tool count depends on the release (see the FAQ).

## Prerequisites

- Node.js 22 or later. `@tenkicloud/mcp` declares `"node": ">=22"`.
- A Tenki API key (`tk_…`). Create one at https://app.tenki.cloud.
- An MCP client: Claude Desktop, Cursor, or Claude Code.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/mcp-tenki-sandbox
```

Run Steps 2 and 6 from this directory.

## Step 2 — Install

```bash
npm install
```

This installs what `verify.mjs` needs, from `package.json`:

```json
  "dependencies": {
    "@tenkicloud/mcp": "^0.1.0",
    "@modelcontextprotocol/sdk": "^1.0.0"
  }
```

`^0.1.0` only matches 0.1.x, so npm installs `@tenkicloud/mcp` 0.1.0. `verify.mjs` tests 0.1.0 (see the FAQ).

## Step 3 — Authenticate

The server reads its key from its environment: `TENKI_API_KEY` (`tk_…`) or `TENKI_AUTH_TOKEN`. If both are set, it uses `TENKI_AUTH_TOKEN`, so unset a stale one.

For the verify script, export the key in your shell:

```bash
export TENKI_API_KEY=tk_your_key_here
```

Or, if you use the Tenki CLI, store it once:

```bash
tenki login --api-key tk_your_key_here
```

`tenki login` saves the key as `auth_token` in `~/.config/tenki/config.yaml`. `verify.mjs` looks for `TENKI_API_KEY`, then `TENKI_AUTH_TOKEN`, then that file. It passes your shell environment through to the server, so a `TENKI_AUTH_TOKEN` in your shell still takes precedence there. The local MCP server reads only its environment, so your client config in Step 4 has to pass the key.

## Step 4 — Add the server to your MCP client

This step doesn't use the clone, because `npx` fetches the server on its own. Edit your client's config, or run `claude mcp add`, from the project where you want the tools, not from `examples/mcp-tenki-sandbox`. `npx` prefers a copy installed in the current project, so a client that starts the server inside this directory runs the 0.1.0 that Step 2 installed, not the latest release.

For Claude Desktop, add this block from the tenki-mcp README to `claude_desktop_config.json`. For Cursor, add the same block to `.cursor/mcp.json` (one project) or `~/.cursor/mcp.json` (all projects).

```json
{
  "mcpServers": {
    "tenki": {
      "command": "npx",
      "args": ["-y", "@tenkicloud/mcp"],
      "env": { "TENKI_API_KEY": "tk_your_key_here" }
    }
  }
}
```

For Claude Code, register it from the command line:

```bash
claude mcp add tenki --env TENKI_API_KEY=tk_your_key_here -- npx -y @tenkicloud/mcp
```

`claude mcp add` defaults to the `local` scope, which registers the server only for the project you run it in. Add `--scope user` to register it for every project. The [tenki-mcp README](https://github.com/LuxorLabs/tenki-mcp#use-it-in-claude-code) also documents a hosted endpoint and a Claude Code plugin install. This guide uses the local stdio server that `npx` starts. `verify.mjs` drives the same server over stdio, at the 0.1.0 that Step 2 installed.

Start a fresh session, or restart the client, so it loads the server. Then ask your agent "Check tenki auth status." `tenki_auth_status` reports whether the key was picked up and works.

## Step 5 — Run code from your agent

Ask your agent:

> "Run this Python in a fresh Tenki sandbox and tell me what it prints: `print(sum(range(100)))`"

It calls `tenki_run_code`, which boots a microVM, runs the snippet, returns the output, and tears the sandbox down. Sandboxes are billed per second and are gone when the run finishes. The agent can pass `timeout_seconds` to cap how long the snippet runs. The tool's description mentions a 30-second default, but the server sends no timeout when the argument is left out. The throwaway sandbox itself has a 10-minute lifetime cap.

## Step 6 — Check it works

From `cookbook/examples/mcp-tenki-sandbox`, in the shell where you exported `TENKI_API_KEY` (or after `tenki login`):

```bash
node verify.mjs
```

`npm run verify` runs the same script. It spawns the server and drives it with the official MCP SDK client, the same way Claude or Cursor does. From `verify.mjs`:

```js
const require = createRequire(import.meta.url);
const serverEntry = require.resolve("@tenkicloud/mcp/dist/index.js"); // the package's bin entry (no "main" field)

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, TENKI_API_KEY: token },
});
const client = new Client({ name: "cookbook-verify", version: "1.0.0" });
```

The script checks that the server advertises `tenki_create_sandbox`, `tenki_get_sandbox`, `tenki_terminate_sandbox`, and `tenki_run_code`. Then it runs a real sandbox lifecycle (create, get, terminate) through MCP tool calls. It creates the sandbox with a 300-second lifetime cap (`max_duration_seconds: 300`) and tries to terminate it in a `finally` block, even when a later step fails. A full pass prints these lines on stdout:

```
✓ connected — 85 tools advertised
✓ tenki_create_sandbox → <first 8 characters of the session id>
✓ tenki_get_sandbox → <state>
✓ tenki_run_code (python) → "42" in a live microVM

✓ mcp-tenki-sandbox: an MCP client drove Tenki end-to-end (create → get → terminate).
✓ tenki_terminate_sandbox (cleaned up <first 8 characters of the session id>)
```

You'll also see the server's own `tenki-mcp running on stdio` line, which it writes to stderr.

The `tenki_run_code` step is a best-effort bonus. It needs the per-session data-plane endpoint, where it stages the code file. If that endpoint isn't reachable from your network, the script prints this line instead and still passes:

```
… tenki_run_code skipped — data-plane endpoint not reachable from here
```

If the snippet runs but doesn't come back as a clean `42`, the script prints `… tenki_run_code ran but gave <stdout> (continuing)` instead, and the run also passes.

The summary line prints before terminate is attempted, and a terminate failure is swallowed without failing the run, so check for the `✓ tenki_terminate_sandbox` line. If it's missing, the sandbox ends at its 300-second `max_duration_seconds` cap.

This proves that the pinned 0.1.0 server starts, authenticates with your key, and creates and reads a real sandbox over MCP. It doesn't test your client's config, the newer release `npx` runs, or a model, and it tests code execution only if you see the `tenki_run_code` `✓` line.

## Troubleshooting

**❌ `` No token. Set TENKI_API_KEY, or run `tenki login`. ``** `verify.mjs` found no key in `TENKI_API_KEY`, `TENKI_AUTH_TOKEN`, or `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY=tk_…` or run `tenki login --api-key <key>`, then rerun.

**❌ Your agent sees only `tenki_auth_status`.** The server started without a credential, so it registered only that tool. The server doesn't read `~/.config/tenki/config.yaml`. Put `TENKI_API_KEY` in the `env` block (or `--env` for Claude Code) and restart the client.

**❌ The `tenki_*` tools don't show up at all.** The client hasn't reloaded its config. Restart it or start a fresh session.

**❌ `✗ server did not advertise tenki_create_sandbox`** (or another tool name). `verify.mjs` passes your shell environment through to the server. `TENKI_MCP_READONLY=1` in your shell registers only read tools, and `TENKI_MCP_DISABLED_TOOLS` drops the tools you name. Unset them and rerun.

**❌ `… tenki_run_code skipped — data-plane endpoint not reachable from here`.** The create and get checks passed over the control plane (terminate runs next), but your network can't reach the sandbox's data-plane endpoint. The run still passes. The file tools use the same endpoint and will fail from this network. `tenki_exec` still runs the command, but returns empty stdout and stderr with a `captureError` and `ok: false`. Run from a network that can reach the endpoint.

## FAQ

**When shouldn't I use this?**
When you're writing application code that manages sandboxes itself: call the SDK directly instead, as in [`../run-code-in-a-sandbox/`](../run-code-in-a-sandbox/). When your network can't reach Tenki's data plane: your agent can create and terminate sandboxes there, but can't run code with `tenki_run_code`, read command output, or move files. And when you don't want an agent creating, running, or deleting things with your key: every tool acts with the key you give the server. If you still want the server, limit it with `TENKI_MCP_READONLY=1` (read tools only) or `TENKI_MCP_DISABLED_TOOLS=tenki_run_code,…` (drops the named tools).

**Which release does my client run, and why do the tool counts differ?**
When a client starts it outside this example directory (see Step 4), `npx -y @tenkicloud/mcp` fetches the latest release, which is 0.3.0 as of this writing and has 71 tools. `verify.mjs` tests the 0.1.0 that `package.json` pins, which has 85. Release 0.2.0 removed the standalone image-management tools and the project-scoped list tools (`tenki_list_project_sandboxes` and its siblings), and capped `tenki_exec` and `tenki_run_code` inline output at 64 KB per stream. The [CHANGELOG](https://github.com/LuxorLabs/tenki-mcp/blob/main/CHANGELOG.md) has the details.

**Can my agent commit and push with `tenki_git`?**
No. `tenki_git` supports `clone`, `checkout`, `diff`, and `log`, which is what the API supports. For anything else, the agent runs `git …` through `tenki_exec`. `checkout`, `diff`, and `log` also run in `/home/tenki` with no directory argument, so for a repo cloned into a subdirectory, use `git -C <directory> …` through `tenki_exec`.

**Do sandboxes clean themselves up?**
`tenki_run_code` tears its sandbox down when the run ends. A sandbox from `tenki_create_sandbox` stays until the agent calls `tenki_terminate_sandbox` or it hits the `max_duration_seconds` cap, if the agent set one.

## Related

- [tenki-mcp](https://github.com/LuxorLabs/tenki-mcp): source, full tool list, and the Codex config
- [`@tenkicloud/mcp` on npm](https://www.npmjs.com/package/@tenkicloud/mcp)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Tenki docs](https://tenki.cloud/docs)
- [`../run-code-in-a-sandbox/`](../run-code-in-a-sandbox/): the same boot, run, and dispose loop, written with the `@tenkicloud/sandbox` SDK
- [`../expose-a-port/`](../expose-a-port/): expose a port and get a preview URL from the SDK, the equivalent of `tenki_expose_port`
