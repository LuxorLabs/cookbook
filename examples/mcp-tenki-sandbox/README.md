# MCP server

Give Claude Code, Claude Desktop, Cursor, Codex, or any MCP client disposable Tenki sandboxes as native tools. [`tenki-mcp`](https://github.com/LuxorLabs/tenki-mcp) (`@tenkicloud/mcp` on npm) is a [Model Context Protocol](https://modelcontextprotocol.io) server with a tool for every public method in the Tenki API: create sandboxes, run code, read and write files, run git, expose preview URLs, and manage snapshots, volumes, and templates. Claude Code connects to Tenki's hosted server and signs you in through the browser, so no key goes in a config file. Other clients run the server locally with `npx` and an API key. Either way you write no SDK code.

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

See the [full tool list](https://github.com/LuxorLabs/tenki-mcp#tools) (71 tools in 0.3.1).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Add the Tenki MCP server to this coding agent so you can run code in Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/main/examples/mcp-tenki-sandbox.
1. If you are Claude Code: run claude mcp add --transport http tenki https://mcp.tenki.cloud/mcp, then ask me to run claude mcp login tenki in my terminal and finish the browser sign-in. No API key is needed. Skip steps 2 and 3.
2. Otherwise, check that Node.js is 22 or later. I need a Tenki API key (starts with tk_). If TENKI_API_KEY isn't set in my shell, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key.
3. Register the local server the way this client expects: the mcpServers block from the README for Cursor or Claude Desktop, or the [mcp_servers.tenki] block for Codex. Tell me which file you edited, since it will contain my key.
4. Tell me to restart the session, then call tenki_auth_status, then use tenki_run_code to run print(sum(range(100))) in Python and show me the output.
```

## Quick start

You need:

- A Tenki account at [app.tenki.cloud](https://app.tenki.cloud).
- An MCP client: Claude Code, Claude Desktop, Cursor, or Codex.
- For any client other than Claude Code's hosted setup: Node.js 22 or later and a Tenki API key (`tk_...`).

### 1. Add the server to your client

**Claude Code** connects to the hosted server at `https://mcp.tenki.cloud/mcp`:

```bash
claude mcp add --transport http tenki https://mcp.tenki.cloud/mcp
claude mcp login tenki
```

`mcp add` registers the server for the current project; add `--scope user` to register it for every project. `mcp login` opens a browser where you sign in to Tenki and pick a workspace. Claude Code keeps the resulting token, so no key sits in any config file. Over SSH, run `claude mcp login tenki --no-browser` and paste the redirect URL back when prompted.

**Other clients** run the server locally with `npx`, which fetches `@tenkicloud/mcp`, so you don't need to clone anything. The [tenki-mcp README](https://github.com/LuxorLabs/tenki-mcp#use-it-in-claude-code) documents the hosted endpoint for Claude Code only.

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

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.tenki]
command = "npx"
args = ["-y", "@tenkicloud/mcp"]
env = { TENKI_API_KEY = "tk_your_key_here" }
```

Claude Code can run the local server too: `claude mcp add tenki --env TENKI_API_KEY=tk_your_key_here -- npx -y @tenkicloud/mcp`.

The local server reads its key only from its environment: `TENKI_API_KEY` or `TENKI_AUTH_TOKEN` (which wins if both are set).

### 2. Check the connection

Restart the client or start a new session, then ask:

> Check tenki auth status.

`tenki_auth_status` reports which kind of credential the server has and whether it works, without returning it.

### 3. Run code

> Run this Python in a fresh Tenki sandbox and tell me what it prints: `print(sum(range(100)))`

The agent calls `tenki_run_code`, which boots a sandbox, runs the snippet, returns stdout, stderr, and the exit code, and tears the sandbox down. The throwaway sandbox has a 10-minute lifetime cap. Pass `timeout_seconds` to limit the snippet itself; the server sends no timeout when it's omitted, despite the 30-second default in the tool description.

### 4. Verify

`verify.mjs` starts the local server from `node_modules` and drives it with the official MCP SDK client, the same way Cursor or Claude Desktop does. It uses an API key, not the hosted sign-in:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/mcp-tenki-sandbox
npm install
export TENKI_API_KEY=tk_...      # or: tenki login --api-key <key>
node verify.mjs
```

```
✓ connected — 71 tools advertised
✓ tenki_create_sandbox → <first 8 characters of the session id>
✓ tenki_get_sandbox → <state>
✓ tenki_run_code (python) → "42" in a live sandbox

✓ mcp-tenki-sandbox: an MCP client drove Tenki end-to-end (create → get → terminate).
✓ tenki_terminate_sandbox (cleaned up <first 8 characters of the session id>)
```

The server also writes `tenki-mcp running on stdio` to stderr.

It checks that the server advertises `tenki_create_sandbox`, `tenki_get_sandbox`, `tenki_terminate_sandbox`, and `tenki_run_code`, then creates (with `max_duration_seconds: 300`), reads, and terminates a real sandbox. `tenki_run_code` needs the sandbox's data-plane endpoint; if your network can't reach it, that line reads `… tenki_run_code skipped — data-plane endpoint not reachable from here` and the run still passes. If the `✓ tenki_terminate_sandbox` line is missing, the sandbox ends at its 300-second cap.

`verify.mjs` spawns the installed server like this:

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

## Things to know

- **Control plane and data plane.** Creating, reading, and terminating sandboxes use Tenki's public control plane. Running code, `tenki_exec` output, and the file tools use each sandbox's own data-plane endpoint, which some networks can't reach.
- **Output is capped at 64 KB per stream.** Beyond that, `tenki_exec` and `tenki_run_code` return the head and tail with `stdoutTruncated` or `stderrTruncated` set. `tenki_exec` keeps the full output in the sandbox at `stdoutPath` / `stderrPath` and takes `max_output_bytes` to raise the cap. `tenki_run_code` terminates its sandbox before returning, so for large output use `tenki_create_sandbox` plus `tenki_exec`.
- **`tenki_git` supports `clone`, `checkout`, `diff`, and `log`.** For commit, push, or a repo in a subdirectory, run `git -C <dir> …` through `tenki_exec`.
- **Cleanup.** `tenki_run_code` tears its sandbox down. A sandbox from `tenki_create_sandbox` runs until `tenki_terminate_sandbox` or its `max_duration_seconds` cap.
- **Limit what the agent can do.** Every tool acts with your account. On the local server, set `TENKI_MCP_READONLY=1` for read tools only, or `TENKI_MCP_DISABLED_TOOLS=tenki_run_code,…` to drop specific tools.
- **Versions.** `package.json` requires `@tenkicloud/mcp` 0.3.1 or later, so `verify.mjs` tests the same release `npx -y @tenkicloud/mcp` fetches. Release 0.2.0 removed the standalone image tools and the project-scoped list tools ([CHANGELOG](https://github.com/LuxorLabs/tenki-mcp/blob/main/CHANGELOG.md)).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Claude Code shows the hosted `tenki` server but no `tenki_*` tools | Run `claude mcp login tenki`, finish the browser sign-in, and start a new session. |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | `verify.mjs` found no key. Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| The agent sees only `tenki_auth_status` | The local server started without a key. Put `TENKI_API_KEY` in the client's `env` block (or `--env`) and restart. The server doesn't read `~/.config/tenki/config.yaml`. |
| No `tenki_*` tools at all | Restart the client or start a new session. |
| `✗ server did not advertise tenki_create_sandbox` | Unset `TENKI_MCP_READONLY` and `TENKI_MCP_DISABLED_TOOLS` in your shell. |
| `tenki_run_code skipped`, or `tenki_exec` returns `captureError` with `ok: false` | Your network can't reach the data plane. Run from one that can. |

## Related

- [tenki-mcp](https://github.com/LuxorLabs/tenki-mcp) and [`@tenkicloud/mcp` on npm](https://www.npmjs.com/package/@tenkicloud/mcp)
- [Run a full-stack app](../agent-fullstack-app/): an app an agent can stand up with these tools
- [Run code in a sandbox](../run-code-in-a-sandbox/): the same loop with the SDK
- [Expose a port](../expose-a-port/): the SDK equivalent of `tenki_expose_port`
- [Tenki docs](https://tenki.cloud/docs)
