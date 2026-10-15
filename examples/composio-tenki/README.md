# How to give a Composio agent Tenki sandboxes

**Audience:** Node.js developers building agents on [Composio](https://composio.dev) who want the agent to run shell commands in disposable Linux microVMs.
**Time:** ~10 minutes.
**Outcome:** a Composio session with six Tenki tools bound to it, a passing `node verify.mjs`, and, if you add an Anthropic key, Claude booting a sandbox, running a command in it, and terminating it on its own.

> **Honesty note:** this example uses `@tenkicloud/composio-tools` 0.1.0, the only version on npm. 0.1.0 still requires a `workspaceId` and a `projectId`, even though Tenki no longer has projects. The scripts look your workspace up from your key and pass `"default"` as the project. Upstream 0.2.0 drops both options, but it isn't on npm yet.

## Why bother

The official [`@tenkicloud/composio-tools`](https://github.com/LuxorLabs/tenki-composio-tools) package registers a Tenki custom toolkit on a Composio session. The agent gets six tools: `CREATE_SANDBOX`, `EXEC_COMMAND`, `LIST_SANDBOXES`, `GET_SANDBOX`, `CREATE_SNAPSHOT`, and `TERMINATE_SANDBOX`. Composio exposes them as `LOCAL_TENKI_CREATE_SANDBOX`, `LOCAL_TENKI_EXEC_COMMAND`, and so on. The tools run in-process in your app against the Tenki SDK, so there's no extra backend to deploy.

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/composio-tenki
npm install
```

Run every later command from this directory.

What `package.json` installs, and why:

| Package | Range | Used for |
|---|---|---|
| `@tenkicloud/composio-tools` | `^0.1.0` | the toolkit |
| `@composio/core` | `^0.13.0` | the Composio session (composio-tools 0.1.0 accepts `>=0.13.0 <1`) |
| `@tenkicloud/sandbox` | `>=1.4.1` | the workspace lookup in `verify.mjs` and `agent.mjs` |
| `@anthropic-ai/sdk` | `^0.111.0` | `agent.mjs` only |

`package.json` asks for the current `@tenkicloud/sandbox` (`>=1.4.1`), which the scripts use for their own workspace lookup. composio-tools 0.1.0 depends on `@tenkicloud/sandbox` `^0.3.6`, so npm also installs a 0.3.x release (0.3.7, the last one) under the toolkit's own `node_modules` for the toolkit's calls.

## Authenticate

| Key | For | Where |
|---|---|---|
| `COMPOSIO_API_KEY` | the Composio session | https://app.composio.dev |
| `TENKI_AUTH_TOKEN` or `TENKI_API_KEY` (or `tenki login`) | the sandboxes | https://app.tenki.cloud |
| `ANTHROPIC_API_KEY` | `agent.mjs` only | https://console.anthropic.com |

```bash
export COMPOSIO_API_KEY=...        # https://app.composio.dev
export TENKI_AUTH_TOKEN=...        # a tk_ key, or run: tenki login --api-key <key>
```

The Tenki key is a `tk_` API key. Both scripts look for it in `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then the `auth_token` line that `tenki login --api-key <key>` writes to `~/.config/tenki/config.yaml`.

Two optional variables feed composio-tools 0.1.0's required IDs:

- `TENKI_WORKSPACE_ID` picks the workspace. Without it, the scripts use the first workspace that `whoAmI()` returns for your key.
- `TENKI_PROJECT_ID` sets the project value. It defaults to `"default"`. Projects are legacy, so any value is accepted.

## Use it

### Run the agent

```bash
export ANTHROPIC_API_KEY=...
node agent.mjs
```

`agent.mjs` prints the tool names it hands to Claude, then gives it this task: boot a fresh Tenki sandbox, print the Linux kernel version and the Python version inside it, terminate the sandbox, and report what it found. Claude picks the tool calls itself, for up to 10 turns, and the script prints each tool call and each text reply as it goes. The model is `claude-sonnet-5` unless you set `ANTHROPIC_MODEL`.

The script records every sandbox the model creates and hasn't terminated. When the loop ends (the model finished, it ran out of turns, or an error was thrown), a `finally` block calls `LOCAL_TENKI_TERMINATE_SANDBOX` on each one still recorded and prints a `terminated leftover sandbox <id>` line. It doesn't check the tool's result.

### Bind the toolkit in your own app

This is the binding, from `verify.mjs`. `agent.mjs` does the same. It imports `Composio` from `@composio/core`, `tenkiToolkit` from `@tenkicloud/composio-tools`, and `TenkiSandbox` from `@tenkicloud/sandbox`. `authToken` is the Tenki key the script found (see Authenticate), and `composioKey` is `COMPOSIO_API_KEY`:

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

If you leave out `authToken`, the toolkit reads `TENKI_AUTH_TOKEN` or `TENKI_API_KEY` from the environment, but not the `~/.config/tenki/config.yaml` file that `tenki login` writes. The scripts read that file themselves and pass the key in as `authToken`. If your own app relies on `tenki login`, do the same.

Keep `workspaceId` and `projectId` while you're on 0.1.0. If either one is missing, from both the option and its `TENKI_WORKSPACE_ID` / `TENKI_PROJECT_ID` variable, the toolkit falls back to its own lookup, which looks for a project and fails (see Troubleshooting). For moving to 0.2.0, see the FAQ.

## Custom toolkits are session-scoped

The Tenki tools exist only on the session you created. You call them with `session.execute(slug, args)`, not through Composio's global provider path, and you read their definitions from `session.customTools()`.

`agent.mjs` turns those definitions into Anthropic tool definitions:

```js
// Anthropic tool defs come straight from the session's custom-tool registry.
const tools = session.customTools({ toolkit: "TENKI" }).map((t) => ({
  name: t.slug,
  description: t.description,
  input_schema: t.inputSchema,
}));
```

Then it runs each `tool_use` block Claude returns against the same session, with `session.execute(b.name, b.input ?? {})` (`agent.mjs`).

The tools don't throw. Each one returns JSON with `success: true` plus its result, or `success: false` plus an `error` object with `type` and `message`. Check both Composio's `error` and the tool's own `success` flag, as this helper in `verify.mjs` does:

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

## Check it works

```bash
node verify.mjs
```

On success it prints:

```
✓ composio-tenki: a Composio session created a Tenki sandbox and ran code in it → 42
```

The script binds the toolkit to a real Composio session and calls the tools directly, with no LLM. It creates a sandbox with `LOCAL_TENKI_CREATE_SANDBOX`, runs `echo hello-from-composio && python3 -c 'print(6*7)'` with `LOCAL_TENKI_EXEC_COMMAND`, checks for exit code 0 and both `hello-from-composio` and `42` in stdout, then terminates the sandbox in a `finally` block. This proves the Composio session, the toolkit, and a real Tenki sandbox work together without a model key. It doesn't exercise the agent loop in `agent.mjs`, and it doesn't assert that termination succeeded.

Unlike the other examples, `verify.mjs` needs `COMPOSIO_API_KEY` as well as the Tenki key. The cookbook's CI has no Composio key, so it skips this example. A green CI run says nothing about it. Run `verify.mjs` yourself.

## Troubleshooting

**❌ `No COMPOSIO_API_KEY. Get one at https://app.composio.dev.`** (from `agent.mjs`: `Missing COMPOSIO_API_KEY.`) The Composio key isn't set. Both scripts need it, so export `COMPOSIO_API_KEY`.

**❌ ``No Tenki token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** (from `agent.mjs`: ``Missing a Tenki token (TENKI_AUTH_TOKEN or `tenki login`).``) No key in `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`, and no `auth_token` line in `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.

**❌ `Missing ANTHROPIC_API_KEY.`** Only `agent.mjs` needs a model key. Export `ANTHROPIC_API_KEY`, or run `verify.mjs`, which doesn't need one.

**❌ `✗ LOCAL_TENKI_CREATE_SANDBOX failed:` with `No Tenki workspace/project is visible for this API key`.** composio-tools 0.1.0 got no `workspaceId` or no `projectId`, so it ran its own lookup, which needs a project. Tenki no longer has projects, so the lookup fails. Pass both to `tenkiToolkit()`, as the example does. If you already do, the scripts' own lookup found no workspace for your key: set `TENKI_WORKSPACE_ID`, or check that the key is a workspace API key. (In `agent.mjs` the same message comes back to the model in the `CREATE_SANDBOX` tool result.)

## FAQ

**When shouldn't I use this?**
When your agent isn't built on Composio. The toolkit only exists to plug Tenki into a Composio session, and calling `@tenkicloud/sandbox` directly needs no Composio account (see [`../run-code-in-a-sandbox/`](../run-code-in-a-sandbox/)). Also note that the cookbook's CI doesn't test this example (it has no Composio key), so a green cookbook build doesn't vouch for it. Run `verify.mjs` yourself, or in your own CI with `COMPOSIO_API_KEY` and a Tenki key set. Until 0.2.0 is on npm, you carry the 0.1.0 workaround: a workspace lookup and a placeholder `projectId`. composio-tools also brings its own older `@tenkicloud/sandbox` (0.3.7 under 0.1.0), which npm installs inside the toolkit's `node_modules` for the toolkit's calls.

**Why pass a `projectId` when Tenki has no projects?**
0.1.0 uses the IDs you pass only when it has both. Otherwise it looks for the first project in your workspace, finds none, and fails. Any `projectId` value works. 0.2.0 drops both options, infers the workspace from your workspace API key, and stops reading `TENKI_WORKSPACE_ID` and `TENKI_PROJECT_ID`. Its breaking changes also include dropping the CommonJS build (it's ESM-only) and returning `workspaceId` instead of `projectId` from `CREATE_SANDBOX` and `GET_SANDBOX`. It isn't on npm yet. Once it is, bump the range in `package.json` to `^0.2.0` and remove both options, along with the `workspaceId`/`projectId` lines that feed them. No other change is needed for this example's code.

**What happens to a sandbox if my process dies before it's terminated?**
In 0.1.0, `CREATE_SANDBOX` gives every sandbox a 30-minute maximum lifetime unless the agent passes `maxDurationMinutes` (1 to 1440). A sandbox your process leaves behind ends when that cap runs out. `verify.mjs` also terminates its sandbox in a `finally` block, and `agent.mjs` terminates any sandbox the model left running the same way. A `finally` block runs after an error, not after the process is killed.

## Related

- [Composio](https://composio.dev)
- [`@tenkicloud/composio-tools` source](https://github.com/LuxorLabs/tenki-composio-tools) and [on npm](https://www.npmjs.com/package/@tenkicloud/composio-tools)
- [Tenki docs](https://tenki.cloud/docs)
- [`../mcp-tenki-sandbox/`](../mcp-tenki-sandbox/): Tenki sandbox tools for Claude, Cursor, or any MCP client
- [`../run-code-in-a-sandbox/`](../run-code-in-a-sandbox/): the same create, exec, and terminate loop with `@tenkicloud/sandbox` alone
