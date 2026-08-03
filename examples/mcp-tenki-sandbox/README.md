# Give Claude or Cursor a Tenki sandbox (MCP)

Point any [MCP](https://modelcontextprotocol.io) client — Claude Desktop, Cursor, Claude Code — at **[`tenki-mcp`](https://github.com/LuxorLabs/tenki-mcp)** and your agent gets a disposable Tenki microVM it can drive natively: create sandboxes, run code, read/write files, run git, expose preview URLs, manage snapshots/volumes/templates. **85 tools**, full parity with the Tenki API.

No SDK code to write — it's a config entry.

## Wire it into your MCP client

Add this to your client's MCP config (Claude Desktop: `claude_desktop_config.json`; Cursor: `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "tenki": {
      "command": "npx",
      "args": ["-y", "@tenkicloud/mcp"],
      "env": { "TENKI_API_KEY": "<your Tenki auth token>" }
    }
  }
}
```

Your token is the `auth_token` in `~/.config/tenki/config.yaml` after `tenki login`.

## Try it

Once connected, ask your agent:

> "Run this Python in a fresh Tenki sandbox and tell me what it prints: `print(sum(range(100)))`"

It calls `tenki_run_code`, which boots a microVM, runs the snippet, returns the output, and tears the sandbox down — per-second billed, gone when it's done.

## A few of the 85 tools

| | |
|---|---|
| `tenki_run_code` | one-shot: boot → run shell/python/js → dispose |
| `tenki_create_sandbox` / `tenki_exec` | a persistent sandbox + run commands in it |
| `tenki_read_file` / `tenki_write_file` | filesystem I/O |
| `tenki_git` | clone / commit / push inside the sandbox |
| `tenki_create_preview_url` | a public URL for a server the agent starts |
| `tenki_create_snapshot` / `tenki_create_volume` | checkpoint state / attach a persistent disk |

Full list: the [tenki-mcp README](https://github.com/LuxorLabs/tenki-mcp#tools).

## Verify

`verify.mjs` proves the whole path the way an MCP client does: it spawns the server, lists its tools, and drives a **real sandbox lifecycle** (create → get → terminate) through MCP tool calls against live Tenki.

```bash
npm install
node verify.mjs        # needs TENKI_API_KEY (or `tenki login`)
# → ✓ connected — 85 tools advertised
# → ✓ tenki_create_sandbox → …  ✓ tenki_get_sandbox → …  ✓ tenki_terminate_sandbox
```

It also attempts `tenki_run_code` as a bonus. That one additionally needs Tenki's per-session **data-plane** endpoint reachable from your network (it stages the code file there), so it's best-effort — reported as skipped, not failed, if the data plane isn't reachable from where you're running.
