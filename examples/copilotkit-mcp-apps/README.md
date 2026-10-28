# CopilotKit MCP Apps

An AI chat app where running code or building a web page shows the result right in the conversation, served from a Tenki cloud machine.

[CopilotKit](https://copilotkit.ai) is a framework for adding AI chat to your own web app. The chat's tools here come from an **MCP server**. MCP (Model Context Protocol) is a standard way to offer tools to an AI model, so any app that speaks it can use them. **[MCP Apps](https://github.com/modelcontextprotocol/ext-apps)** is an extension to MCP that lets a tool return a small interactive web page along with its result, which the chat app (the **host**) shows inline.

Ask the chat to run code, and a console appears in the conversation with the output and a live shell into the Tenki sandbox. Ask it for a web app, and the page appears in the chat, served from a sandbox on a public URL. The tools are a plain MCP server, so CopilotKit or any other host that supports MCP Apps can use them.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Run the CopilotKit MCP Apps example on Tenki, following https://github.com/LuxorLabs/cookbook/tree/main/examples/copilotkit-mcp-apps.
1. Clone https://github.com/LuxorLabs/cookbook, cd into examples/copilotkit-mcp-apps, check that Node.js is 20.11 or later, and run npm install.
2. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
3. Run node verify.mjs and confirm it prints the ✓ line.
4. Copy chat/.env.example to chat/.env and ask me to fill in LLM_API_KEY myself. Then start the server with npm start, and in a second terminal run npm install && npm run dev in chat/, and tell me to open http://localhost:3000.
5. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Node.js 20.11 or later.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- For the chat: an API key for an OpenAI-compatible endpoint that serves `/chat/completions`. The default is [Aisa](https://aisa.one) with `claude-sonnet-5`; OpenRouter and OpenAI also work.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/copilotkit-mcp-apps
npm install
```

### 2. Set your API keys

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY or a `tenki login` key also work
```

Only the MCP server needs the Tenki key. The chat never sees it. For the chat, copy its env file:

```bash
cp chat/.env.example chat/.env
```

```bash
# Any OpenAI-compatible endpoint. Aisa (https://aisa.one) is the default.
LLM_API_KEY=
LLM_BASE_URL=https://api.aisa.one/v1
LLM_MODEL=claude-sonnet-5

# Where the MCP App server is listening (npm start, in the example's root).
MCP_URL=http://localhost:3108/mcp
```

Fill in `LLM_API_KEY`. Set it even if `OPENAI_API_KEY` is in your shell, or the chat sends your OpenAI key to `LLM_BASE_URL`.

### 3. Run

Start the MCP server and leave it running:

```bash
npm start
```

```
MCP App server on http://localhost:3108/mcp — sandboxes under /home/tenki/app
```

In a second terminal, start the chat:

```bash
cd chat
npm install && npm run dev
```

Open http://localhost:3000 and pick a suggestion, or type:

> Show me this sandbox is real: run uname -a, nproc and free -m.

A console appears with the code, the output, and boot and run times. Type `ls -la` into its shell: the command goes from the page to the same sandbox with no model involved. "Ask Copilot to fix it" (shown after a failing command) or "Send output to Copilot" hands work back to the agent, and "Destroy sandbox" terminates the machine.

### 4. Verify

From the example's root, with the Tenki key exported in that terminal:

```bash
node verify.mjs
```

```
✓ copilotkit-mcp-apps: ui resource → run python → 42 → app-only exec → destroy
```

`verify.mjs` starts its own server on port 3199 and drives it with an MCP client, no model needed. It checks the UI resource, runs `print(6 * 7)`, runs `uname -s && nproc` through the app-only `sandbox_exec`, and destroys the sandbox in a `finally` block. It doesn't cover the chat or `launch_web_app`'s public URL.

## What the agent can do

| Tool | What the user gets |
| --- | --- |
| `run_code_in_sandbox` | A console: the program (Python, Node, or shell), its output, timings, and a live shell into the same sandbox |
| `launch_web_app` | The page the agent wrote, served from a sandbox on a public URL, in an iframe with reload, "Open ↗", and "Destroy sandbox" |

- Each sandbox has 2 vCPUs and 4 GB of memory, and each command a 60-second timeout.
- Passing `sandbox_id` back reuses a sandbox, files and all, with no boot. Only sandboxes tagged `cookbook-mcp-apps` can be reused or destroyed.
- Outbound network is off. `run_code_in_sandbox` turns it on for a new sandbox when the agent passes `allow_internet: true`. `launch_web_app` sandboxes stay offline, so pages must be self-contained.
- `launch_web_app` can't reuse a `run_code_in_sandbox` sandbox, because inbound access is fixed at creation.
- Sandboxes outlive the chat. Each runs until "Destroy sandbox" or its 1-hour `maxDurationMs` cap. Preview URLs are public while the sandbox is up.

## How it works

| File | What it is |
| --- | --- |
| [`server.mjs`](server.mjs) | The MCP server: four tools and two `ui://` resources, over Streamable HTTP on port 3108 (`MCP_PORT`) |
| [`sandboxes.mjs`](sandboxes.mjs) | The Tenki calls: boot, run, serve, destroy |
| [`widget.mjs`](widget.mjs) | The app page the host renders: plain HTML and JavaScript, no build step |
| [`chat/`](chat/) | The Next.js CopilotKit chat |
| [`verify.mjs`](verify.mjs) | Drives the server's tools against live Tenki |

### A tool with a UI

An MCP App tool is a normal MCP tool that names a `ui://` resource. From `server.mjs`:

```js
  registerAppTool(
    server,
    "run_code_in_sandbox",
    {
      title: "Run code in a Tenki sandbox",
      description:
        "Run a Python, JavaScript (Node) or shell program in a fresh Tenki sandbox and open a console the user can keep working in: " +
        "the code, its output, and a live shell into the same machine. Pass sandbox_id to reuse one (files persist, no boot). " +
        "Standard library only unless allow_internet is true.",
      inputSchema: {
        language: z.enum(["python", "javascript", "shell"]),
        code: z.string().min(1).describe("The complete program."),
        title: z.string().max(60).optional().describe("Short label, e.g. 'Monte Carlo pi'."),
        sandbox_id: sandboxId.optional(),
        allow_internet: z.boolean().optional().describe("Give a NEW sandbox outbound internet (package installs). Default false."),
      },
      // This is the whole difference from a plain tool: a UI to render with the result.
      _meta: { ui: { resourceUri: VIEWS.console } },
    },
```

Each view is served as an HTML page:

```js
  for (const [view, uri] of Object.entries(VIEWS)) {
    registerAppResource(server, `tenki-${view}`, uri, { mimeType: RESOURCE_MIME_TYPE, description: `Tenki ${view} app` }, async () => ({
      contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml(view, bridge) }],
    }));
  }
```

The MCP Apps bridge is read out of `node_modules` and baked into each page:

```js
// The MCP Apps browser bundle: one self-contained ES module, read out of
// node_modules and baked into each app page. No build step anywhere.
const bridge = readFileSync(createRequire(import.meta.url).resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");
```

The page loads it as a blob module, so it works in a hosted chat that can't reach your localhost. From `widget.mjs`:

```js
const bridgeBytes = Uint8Array.from(atob(BRIDGE_B64), (c) => c.charCodeAt(0));
const { App } = await import(URL.createObjectURL(new Blob([bridgeBytes], { type: "text/javascript" })));

const app = new App({ name: "Tenki sandbox", version: "1.0.0" }, {}, { autoResize: true });
const el = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
let data = null;

app.ontoolresult = (res) => {
  data = res?.structuredContent ?? {};
  render();
};
await app.connect();

/** Call one of the server's app-only tools, straight from the UI. */
async function callTool(name, args) {
  const res = await app.callServerTool({ name, arguments: args });
  if (res.isError) throw new Error(res.content?.find((c) => c.type === "text")?.text ?? "tool failed");
  return res.structuredContent ?? {};
}
```

### Tools only the UI can call

The console's shell and the destroy button use `sandbox_exec` and `sandbox_destroy`, which are hidden from the model:

```js
  // ── app-only: the UI calls these, the model never sees them ──────────────
  const appOnly = { ui: { visibility: ["app"] } };

  registerAppTool(
    server,
    "sandbox_exec",
    { description: "Run a shell command in a sandbox (the console's terminal).", inputSchema: { sandbox_id: sandboxId, command: z.string().min(1) }, _meta: appOnly },
```

The page calls them through the host with `app.callServerTool`, and hands work back to the agent with `app.sendMessage`.

### The Tenki side

From `sandboxes.mjs`:

```js
/**
 * The sandbox named by `sandboxId`, or a fresh one.
 *
 * Reuse is what makes the chat feel like a session: the agent passes the id
 * back, the files are still there, and nothing boots. Demo sandboxes are small
 * and self-terminating, so an abandoned one costs an hour at most.
 */
export async function acquire({ sandboxId, name, allowInbound = false, allowOutbound = false }) {
  if (sandboxId) {
    const existing = await tenki.get(sandboxId);
    assertOurs(existing);
    return { session: existing, bootMs: null, reused: true };
  }
  const started = Date.now();
  const session = await tenki.createAndWait({
    name,
    workspaceId,
    cpuCores: 2,
    memoryMb: 4096,
    allowInbound,
    allowOutbound,
    // Bounds the sandbox's whole life: the SDK dropped idle timeouts, and a
    // forgotten demo sandbox should cost an hour at most.
    maxDurationMs: 60 * 60_000,
    tags: [DEMO_TAG],
  });
  return { session, bootMs: Date.now() - started, reused: false };
}
```

`serveWebApp` starts the page's server under `systemd-run` (or `setsid nohup`), probes the port until it accepts connections, then exposes it with `exposePort`.

### The chat

From `chat/app/agent.ts`:

```ts
export function createAgent(): BuiltInAgent {
  const agent = new BuiltInAgent({ model: model(), prompt: PROMPT, maxSteps: 4 });
  // Order matters: the first middleware is the outermost, so the continuation
  // wraps the MCP Apps middleware and can see the tool results it emits.
  agent.use(
    new ContinueAfterAppsMiddleware(2),
    new MCPAppsMiddleware({ mcpServers: [{ type: "http", url: MCP_URL, serverId: "tenki" }] }),
  );
  return agent;
}
```

- `MCPAppsMiddleware` connects to `MCP_URL`, runs the tools, renders the apps, and proxies the page's tool calls.
- `ContinueAfterAppsMiddleware` (`chat/app/continue-middleware.ts`) runs the model again with the tool results, up to 2 times, so the agent can explain a result or react to a failure.
- For Claude models the chat sends `anthropic-beta: fine-grained-tool-streaming-2025-05-14`, so long tool arguments stream instead of arriving in one burst.
- `repairingFetch` (`chat/app/stream-repair.ts`) fixes tool-call indexes from relays such as Aisa.
- `rxjs` is pinned to `7.8.1` to match `@ag-ui/client` 1.0.2 and `@ag-ui/mcp-apps-middleware` 0.1.2.

## Things to know

- **Keep the server on localhost.** It has no authentication, listens on `127.0.0.1`, and rejects requests not addressed to localhost. Anything that reaches port 3108 can run code on your Tenki account, so add authentication before binding it to `0.0.0.0` or putting it behind a tunnel.
- To use another MCP Apps host, point it at `http://localhost:3108/mcp` from the same machine.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY …` | Export a key or run `tenki login --api-key <key>` before `npm start` or `verify.mjs`. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| The agent answers in text and the chat logs `MCP tool discovery failed` | Start the server with `npm start`, and check `MCP_URL` in `chat/.env`. |
| `Sandbox <id> was created without inbound access …` | Ask the agent to launch the app without a `sandbox_id`. |
| `The server never listened on port <port>.` | The `start_command` must listen on `0.0.0.0` and `$PORT`, and can't install packages. Check the log lines that follow. |
| `Sandbox <id> was not created by this example; refusing to use it.` | Omit `sandbox_id` to get a fresh sandbox. |
| A program that installs packages or fetches a URL fails | Ask for a new sandbox with `allow_internet: true`. |
| `OpenAI API key is missing. …` | Create `chat/.env` from `.env.example` and set `LLM_API_KEY`. |
| `Cannot read properties of undefined (reading 'hasFinished')` | Keep `fetch: repairingFetch` in `agent.ts`; it renumbers a relay's tool calls. |

## Related

- [MCP Apps](https://github.com/modelcontextprotocol/ext-apps), [CopilotKit](https://copilotkit.ai), and [`@ag-ui/mcp-apps-middleware`](https://www.npmjs.com/package/@ag-ui/mcp-apps-middleware)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
- [MCP server](../mcp-tenki-sandbox/): Tenki's own MCP server for Claude or Cursor, without app UIs
- [Expose a port](../expose-a-port/): the preview URL on its own
