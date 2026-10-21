# Composio

Give a [Composio](https://composio.dev) agent Tenki sandboxes. [`@tenkicloud/composio-tools`](https://github.com/LuxorLabs/tenki-composio-tools) registers a Tenki custom toolkit on a Composio session with six tools: `CREATE_SANDBOX`, `EXEC_COMMAND`, `LIST_SANDBOXES`, `GET_SANDBOX`, `CREATE_SNAPSHOT`, and `TERMINATE_SANDBOX` (exposed as `LOCAL_TENKI_*`). The tools run in your process against the Tenki SDK, so there's no backend to deploy. With an Anthropic key, `agent.mjs` has Claude boot a sandbox, run commands, and terminate it.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Composio" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/composio-tenki, and run npm install (Node.js 20 or later).
2. It needs COMPOSIO_API_KEY (from https://app.composio.dev) and TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud), plus ANTHROPIC_API_KEY for agent.mjs. If any is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs and confirm the ✓ line, then node agent.mjs if I have an Anthropic key.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to bind tenkiToolkit() to a Composio session in my own app, passing workspaceId and projectId while the package is on 0.1.0.
```

## Quick start

You need:

- Node.js 20 or later.
- A Composio API key from [app.composio.dev](https://app.composio.dev).
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An Anthropic API key, for `agent.mjs` only.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/composio-tenki
npm install
```

This installs `@tenkicloud/composio-tools` 0.1.0, `@composio/core` 0.13, `@tenkicloud/sandbox` 1.4.1 or later, and `@anthropic-ai/sdk`. The toolkit also brings its own `@tenkicloud/sandbox` 0.3.7 in its `node_modules`.

### 2. Set your keys

```bash
export COMPOSIO_API_KEY=...
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY or tenki login --api-key <key> also work
```

Optional: `TENKI_WORKSPACE_ID` picks the workspace (default: the first one your key sees), and `TENKI_PROJECT_ID` sets the placeholder project (default: `"default"`).

### 3. Verify

```bash
node verify.mjs
```

```
✓ composio-tenki: a Composio session created a Tenki sandbox and ran code in it → 42
```

`verify.mjs` binds the toolkit to a real Composio session and calls the tools directly: it creates a sandbox, runs `echo hello-from-composio && python3 -c 'print(6*7)'`, checks the output, and terminates the sandbox. It needs no model key. The cookbook's CI has no Composio key and skips this example, so run this check yourself.

### 4. Run the agent

```bash
export ANTHROPIC_API_KEY=...
node agent.mjs
```

Claude boots a sandbox, prints the kernel and Python versions inside it, terminates it, and reports back, for up to 10 turns. The model is `claude-sonnet-5` unless you set `ANTHROPIC_MODEL`. Any sandbox the model leaves running is terminated in a `finally` block.

## Bind the toolkit in your app

From `verify.mjs` (`authToken` is the Tenki key, `composioKey` is `COMPOSIO_API_KEY`):

```js
// @tenkicloud/composio-tools 0.1.0 needs both IDs up front; with no projects on the account its own
// lookup fails. Projects are legacy, so any projectId is accepted. 0.2.0 (unpublished) drops both.
const workspaceId =
  process.env.TENKI_WORKSPACE_ID || (await new TenkiSandbox({ authToken }).whoAmI()).workspaces[0]?.id;
const projectId = process.env.TENKI_PROJECT_ID || "default";

const composio = new Composio({ apiKey: composioKey });
const session = await composio.sessions.create("default", {
  experimental: { customToolkits: [tenkiToolkit({ authToken, workspaceId, projectId })] },
});
```

- **Pass both `workspaceId` and `projectId` on 0.1.0.** Without both, the toolkit runs its own project lookup, which fails because Tenki no longer has projects. Any `projectId` works.
- **Pass `authToken` if you rely on `tenki login`.** The toolkit reads `TENKI_AUTH_TOKEN` and `TENKI_API_KEY` but not the CLI's config file.

## Call the tools

Custom toolkits are session-scoped. Read definitions with `session.customTools()` and call tools with `session.execute(slug, args)`, not through Composio's global provider path. `agent.mjs` turns the definitions into Anthropic tools:

```js
// Anthropic tool defs come straight from the session's custom-tool registry.
const tools = session.customTools({ toolkit: "TENKI" }).map((t) => ({
  name: t.slug,
  description: t.description,
  input_schema: t.inputSchema,
}));
```

The tools don't throw. Each returns JSON with `success: true` and a result, or `success: false` and an `error` with `type` and `message`. Check both Composio's `error` and the tool's `success`:

```js
/** Execute one LOCAL_TENKI_* tool and assert Composio + the tool itself both succeeded. */
async function tool(slug, args) {
  const res = await session.execute(slug, args);
  if (res.error !== null || res.data?.success !== true) {
    throw new Error(`${slug} failed: ${res.error ?? JSON.stringify(res.data?.error ?? res.data)}`);
  }
  return res.data;
}
```

`CREATE_SANDBOX` gives each sandbox a 30-minute maximum lifetime unless the agent passes `maxDurationMinutes` (1 to 1440), so a sandbox left behind by a killed process still ends.

## Upgrading to 0.2.0

0.2.0 isn't on npm yet. It drops `workspaceId` and `projectId` (the workspace comes from the key), stops reading `TENKI_WORKSPACE_ID` and `TENKI_PROJECT_ID`, is ESM-only, and returns `workspaceId` instead of `projectId` from `CREATE_SANDBOX` and `GET_SANDBOX`. When it ships, bump `package.json` to `^0.2.0` and remove the two options and the lines that compute them.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `No COMPOSIO_API_KEY …` or `Missing COMPOSIO_API_KEY.` | Export `COMPOSIO_API_KEY`. |
| ``No Tenki token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | Export a `tk_` key or run `tenki login --api-key <key>`. |
| `Missing ANTHROPIC_API_KEY.` | Export it, or run `verify.mjs`, which doesn't need it. |
| `LOCAL_TENKI_CREATE_SANDBOX failed: … No Tenki workspace/project is visible for this API key` | Pass both `workspaceId` and `projectId` to `tenkiToolkit()`. If you do, set `TENKI_WORKSPACE_ID` or check the key is a workspace API key. |

## Related

- [MCP server](../mcp-tenki-sandbox/): Tenki tools for any MCP client
- [Run code in a sandbox](../run-code-in-a-sandbox/): the same loop without Composio
- [`@tenkicloud/composio-tools`](https://github.com/LuxorLabs/tenki-composio-tools) ([npm](https://www.npmjs.com/package/@tenkicloud/composio-tools))
- [Composio](https://composio.dev) and the [Tenki docs](https://tenki.cloud/docs)
