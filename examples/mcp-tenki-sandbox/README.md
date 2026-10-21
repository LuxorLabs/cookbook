# MCP server

Give Claude Desktop, Cursor, Claude Code, or any MCP client disposable Tenki sandboxes as native tools. [`tenki-mcp`](https://github.com/LuxorLabs/tenki-mcp) (`@tenkicloud/mcp` on npm) is a [Model Context Protocol](https://modelcontextprotocol.io) server with a tool for every public method in the Tenki API: create sandboxes, run code, read and write files, run git, expose preview URLs, and manage snapshots, volumes, and templates. You add one config entry and write no SDK code.

Some of the tools:

| Tool | What it does |
|---|---|
| `tenki_run_code` | one-shot: boot a sandbox, run a shell, Python, or JavaScript snippet, return stdout, stderr, and exit code, tear the sandbox down |
| `tenki_create_sandbox` / `tenki_exec` | a persistent sandbox, and commands run in it |
| `tenki_read_file` / `tenki_write_file` | UTF-8 text file I/O, paths under `/home/tenki` |
| `tenki_git` | `clone`, `checkout`, `diff`, and `log` only. Run other git commands (commit, push) through `tenki_exec` |
| `tenki_expose_port` | expose a port from a sandbox and get a public preview URL |
| `tenki_create_preview_url` | a shareable public URL for a port a server in the sandbox listens on. The sandbox must be created with inbound networking (`allow_inbound`) |
| `tenki_create_snapshot` / `tenki_create_volume` | checkpoint a sandbox / create a persistent volume |
| `tenki_auth_status` | reports whether the server found a working credential, without returning it |

See the [full tool list](https://github.com/LuxorLabs/tenki-mcp#tools).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Add the Tenki MCP server to this coding agent so you can run code in Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/main/examples/mcp-tenki-sandbox.
1. Check that Node.js is 22 or later.
2. I need a Tenki API key (starts with tk_). If TENKI_API_KEY isn't set in my shell, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key.
3. Register the server the way this client expects. For Claude Code: claude mcp add tenki --env TENKI_API_KEY="$TENKI_API_KEY" -- npx -y @tenkicloud/mcp. For Cursor or Claude Desktop, add the mcpServers block from the README, and tell me which file you edited, since it will contain my key.
4. Tell me to restart the session, then call tenki_auth_status, then use tenki_run_code to run print(sum(range(100))) in Python and show me the output.
```

## Quick start

You need:

- Node.js 22 or later.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An MCP client: Claude Desktop, Cursor, or Claude Code.

### 1. Add the server to your client

`npx` fetches the server, so you don't need to clone anything for this step. Run it from the project where you want the tools.

Claude Code:

```bash
claude mcp add tenki --env TENKI_API_KEY=tk_your_key_here -- npx -y @tenkicloud/mcp
```

This registers the server for the current project. Add `--scope user` to register it for every project.

Claude Desktop (`claude_desktop_config.json`) or Cursor (`.cursor/mcp.json` for one project, `~/.cursor/mcp.json` for all):

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

The server reads its key only from its environment: `TENKI_API_KEY` or `TENKI_AUTH_TOKEN` (which wins if both are set). The [tenki-mcp README](https://github.com/LuxorLabs/tenki-mcp#use-it-in-claude-code) also covers the hosted endpoint, the Claude Code plugin, and Codex.

### 2. Check the connection

Restart the client or start a new session, then ask:

> Check tenki auth status.

`tenki_auth_status` reports whether the key works, without returning it.

### 3. Run code

> Run this Python in a fresh Tenki sandbox and tell me what it prints: `print(sum(range(100)))`

The agent calls `tenki_run_code`, which boots a sandbox, runs the snippet, returns stdout, stderr, and the exit code, and tears the sandbox down. The throwaway sandbox has a 10-minute lifetime cap. Pass `timeout_seconds` to limit the snippet itself; the server sends no timeout when it's omitted, despite the 30-second default in the tool description.

### 4. Verify

`verify.mjs` drives the server with the official MCP SDK client, the same way Claude or Cursor does:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/mcp-tenki-sandbox
npm install
export TENKI_API_KEY=tk_...      # or: tenki login --api-key <key>
node verify.mjs
```

```
✓ connected — 85 tools advertised
✓ tenki_create_sandbox → <first 8 characters of the session id>
✓ tenki_get_sandbox → <state>
✓ tenki_run_code (python) → "42" in a live sandbox

✓ mcp-tenki-sandbox: an MCP client drove Tenki end-to-end (create → get → terminate).
✓ tenki_terminate_sandbox (cleaned up <first 8 characters of the session id>)
```

The server also writes `tenki-mcp running on stdio` to stderr.

It checks that the server advertises `tenki_create_sandbox`, `tenki_get_sandbox`, `tenki_terminate_sandbox`, and `tenki_run_code`, then creates (with `max_duration_seconds: 300`), reads, and terminates a real sandbox. `tenki_run_code` needs the sandbox's data-plane endpoint; if your network can't reach it, that line reads `… tenki_run_code skipped — data-plane endpoint not reachable from here` and the run still passes. If the `✓ tenki_terminate_sandbox` line is missing, the sandbox ends at its 300-second cap.

`verify.mjs` spawns the pinned server like this:

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

## Versions

`package.json` pins `@tenkicloud/mcp` `^0.1.0`, so `verify.mjs` tests 0.1.0 (85 tools). A client that runs `npx -y @tenkicloud/mcp` outside this directory gets the latest release: 0.3.0 at the time of writing, with 71 tools. Release 0.2.0 removed the standalone image tools and the project-scoped list tools, and capped `tenki_exec` and `tenki_run_code` output at 64 KB per stream ([CHANGELOG](https://github.com/LuxorLabs/tenki-mcp/blob/main/CHANGELOG.md)). If you start a client inside this directory, `npx` uses the installed 0.1.0.

## Things to know

- **Control plane and data plane.** Creating, reading, and terminating sandboxes use Tenki's public control plane. Running code, `tenki_exec` output, and the file tools use each sandbox's own data-plane endpoint, which some networks can't reach.
- **`tenki_git` supports `clone`, `checkout`, `diff`, and `log`.** For commit, push, or a repo in a subdirectory, run `git -C <dir> …` through `tenki_exec`.
- **Cleanup.** `tenki_run_code` tears its sandbox down. A sandbox from `tenki_create_sandbox` runs until `tenki_terminate_sandbox` or its `max_duration_seconds` cap.
- **Limit what the agent can do.** Every tool acts with your key. Set `TENKI_MCP_READONLY=1` for read tools only, or `TENKI_MCP_DISABLED_TOOLS=tenki_run_code,…` to drop specific tools.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | `verify.mjs` found no key. Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| The agent sees only `tenki_auth_status` | The server started without a key. Put `TENKI_API_KEY` in the client's `env` block (or `--env`) and restart. The server doesn't read `~/.config/tenki/config.yaml`. |
| No `tenki_*` tools at all | Restart the client or start a new session. |
| `✗ server did not advertise tenki_create_sandbox` | Unset `TENKI_MCP_READONLY` and `TENKI_MCP_DISABLED_TOOLS` in your shell. |
| `tenki_run_code skipped`, or `tenki_exec` returns `captureError` with `ok: false` | Your network can't reach the data plane. Run from one that can. |

## Related

- [tenki-mcp](https://github.com/LuxorLabs/tenki-mcp) and [`@tenkicloud/mcp` on npm](https://www.npmjs.com/package/@tenkicloud/mcp)
- [Run a full-stack app](../agent-fullstack-app/): an app an agent can stand up with these tools
- [Run code in a sandbox](../run-code-in-a-sandbox/): the same loop with the SDK
- [Expose a port](../expose-a-port/): the SDK equivalent of `tenki_expose_port`
- [Tenki docs](https://tenki.cloud/docs)
