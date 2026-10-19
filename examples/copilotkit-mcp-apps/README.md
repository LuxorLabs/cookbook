# How to give an agent's MCP tools their own UI with CopilotKit and Tenki sandboxes

**Audience:** Developers who build agents on MCP tools and want a tool's result to arrive in the chat as an interface the user can keep working in (an MCP App), with CopilotKit or another MCP Apps host.
**Time:** ~10 minutes.
**Outcome:** A CopilotKit chat on http://localhost:3000 whose agent runs code in a Tenki sandbox and opens a console with a live shell into that machine, or writes a web app and shows it running from the sandbox on a public URL.

> **Honesty note:** Closing the chat doesn't stop the sandboxes it started. Each one runs until you press "Destroy sandbox" in its app or its 1-hour `maxDurationMs` cap ends it. A web app's preview URL is public, so anyone with the link can open it while the sandbox is up.

## Prerequisites

- Node.js 20.11 or later. Next.js 16.1.1 needs 20.9, and `verify.mjs` uses `import.meta.dirname`, which arrived in 20.11. CI runs the verify script on Node 20.
- A Tenki API key. Create one at https://app.tenki.cloud. Keys start with `tk_`, and SDK 1.x accepts nothing else.
- For the chat only: an API key for an OpenAI-compatible endpoint. `chat/.env.example` defaults to [Aisa](https://aisa.one) with `claude-sonnet-5`, and `chat/app/agent.ts` names OpenRouter and OpenAI as alternatives. The endpoint must serve `/chat/completions`: the chat calls `provider.chat(id)`, not the Responses API.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/copilotkit-mcp-apps
```

Every later command runs from this directory unless a step says otherwise.

| File | What it is |
| --- | --- |
| [`server.mjs`](server.mjs) | The MCP server: four tools and two `ui://` resources, over Streamable HTTP on port 3108 |
| [`sandboxes.mjs`](sandboxes.mjs) | The Tenki side: boot, run, serve, destroy. Plain SDK calls, no MCP |
| [`widget.mjs`](widget.mjs) | The MCP App page the host renders: plain HTML and JavaScript, no framework, no build step |
| [`verify.mjs`](verify.mjs) | Drives the server's tools against live Tenki, with no model |
| [`chat/`](chat/) | A Next.js app with a [CopilotKit](https://copilotkit.ai) chat that renders the apps |

## Step 2 — Install the MCP App server

```bash
npm install
```

That installs `@modelcontextprotocol/ext-apps` (`^2.0.3`), `@modelcontextprotocol/sdk` (`^1.30.0`), `@tenkicloud/sandbox` 1.4.1 or later and `zod` (`^4.4.3`).

## Step 3 — Authenticate

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY works too
```

Or store the key once with `tenki login --api-key <key>`, which writes it to `~/.config/tenki/config.yaml`. `sandboxes.mjs` falls back to that file when neither variable is set, so `npm start` and `verify.mjs` both pick it up.

`TENKI_WORKSPACE_ID` is optional. Tenki infers the workspace from the key.

Only the MCP server needs the Tenki key. The chat reads its model settings and `MCP_URL`, and never sees the key.

## Step 4 — Start the MCP App server

```bash
npm start
```

It prints:

```
MCP App server on http://localhost:3108/mcp — sandboxes under /home/tenki/app
```

Set `MCP_PORT` to use another port. `curl http://localhost:3108/healthz` returns `{"ok":true,"sandboxes":"live"}`. Leave this terminal running.

## Step 5 — Start the chat

In a second terminal, from the directory where you ran `git clone`:

```bash
cd cookbook/examples/copilotkit-mcp-apps/chat
cp .env.example .env
```

This is `chat/.env.example`:

```bash
# Any OpenAI-compatible endpoint. Aisa (https://aisa.one) is the default.
LLM_API_KEY=
LLM_BASE_URL=https://api.aisa.one/v1
LLM_MODEL=claude-sonnet-5

# Where the MCP App server is listening (npm start, in the example's root).
MCP_URL=http://localhost:3108/mcp
```

Fill in `LLM_API_KEY`. Change `LLM_BASE_URL` and `LLM_MODEL` for another provider, and `MCP_URL` if you moved the server off port 3108. Then install and start the chat:

```bash
npm install && npm run dev
```

This install pulls Next.js and CopilotKit, so it takes longer than the server's. `rxjs` is pinned to `7.8.1`, the exact version `@ag-ui/client` 1.0.2 depends on and `@ag-ui/mcp-apps-middleware` 0.1.2 requires as a peer dependency, so keep them in step if you upgrade.

Open http://localhost:3000.

## Step 6 — Ask for something that needs a computer

Before your first message, the chat offers three suggestions: "Prove it's a real machine", "Run code", and "Ship a web app". Or type:

> Show me this sandbox is real: run uname -a, nproc and free -m.

The agent gets two tools that come with a UI:

| Tool | What the user gets |
| --- | --- |
| `run_code_in_sandbox` | A console: the program, its output, timings, and a live shell into the same sandbox |
| `launch_web_app` | The app the agent wrote, served from the sandbox on a public URL, running in the chat |

For the prompt above, the agent calls `run_code_in_sandbox`. Tenki boots a sandbox with 2 vCPUs and 4 GB of memory, the server writes the program under `/home/tenki/app` and runs it, and a console appears in the chat with the code, the output, and the boot and run times. Type `ls -la` into the console's shell. That command goes from the app through the host's proxy to the MCP server and into the same sandbox, with no model in the loop.

Below the shell are two buttons. "Send output to Copilot" posts the last output to the chat as a user message. When the last command exited non-zero, it reads "Ask Copilot to fix it" instead, and asks the agent to fix the program and run it again in the same sandbox. "Destroy sandbox" terminates the machine.

The "Ship a web app" suggestion shows the other app. The agent calls `launch_web_app`, which writes the page into a new sandbox, starts `python3 -m http.server` on port 8080 unless the agent passes its own `start_command` and `port`, waits for the port to accept connections, exposes it on a public URL, and shows the page in an iframe in the chat, with a reload button, an "Open ↗" button and "Destroy sandbox".

A few rules decide what the agent can do in a sandbox:

- **Reuse.** Passing `sandbox_id` back into a tool reuses that machine: the files are still there and nothing boots. The agent's prompt tells it to pass the `sandbox_id` from the previous result whenever it changes or fixes something.
- **`launch_web_app` can't reuse a `run_code_in_sandbox` sandbox.** That sandbox was created with inbound access off, and inbound access is fixed at creation.
- **This example turns outbound network off.** The SDK turns outbound access on by default, but this example creates sandboxes with it off. `run_code_in_sandbox` turns it on only for a new sandbox, and only when the agent passes `allow_internet: true`. A reused sandbox keeps what it was created with. `launch_web_app` has no such option, so a server it starts can't download packages, and its tool description asks for one self-contained page with inline CSS and JS and no external requests.
- **Timeout.** Each command runs with a 60-second timeout.

## Step 7 — Check it works

In a third terminal, `cd` into `cookbook/examples/copilotkit-mcp-apps` (the directory from Step 1). Export `TENKI_AUTH_TOKEN` again unless you used `tenki login`, because a new terminal doesn't inherit an `export` from another one. Then run:

```bash
node verify.mjs   # npm run verify does the same
```

```
✓ copilotkit-mcp-apps: ui resource → run python → 42 → app-only exec → destroy
```

The script starts its own copy of `server.mjs` on port 3199, so it can run alongside `npm start`, and drives it with an MCP client the way CopilotKit's middleware does. It checks that `run_code_in_sandbox` names a UI resource and that reading it returns an HTML page. It then runs `print(6 * 7)` in a live sandbox and expects `42`, runs `uname -s && nproc` through the app-only `sandbox_exec` and expects `Linux`, and destroys the sandbox through `sandbox_destroy`, again in a `finally` if an earlier step failed. On failure it prints `✗ <message>` and exits 1.

It needs no model key, so the chat, the model's tool calls, the apps rendering in a browser, and `launch_web_app`'s public URL aren't exercised.

## How a tool gets its UI

An MCP App tool is a normal MCP tool that also names a `ui://` resource. A host that speaks the [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) extension renders that resource in the conversation and wires it to the tool call. From `server.mjs`:

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

The server serves each view, `ui://tenki/console.html` and `ui://tenki/preview.html`, as an HTML page (also `server.mjs`):

```js
  for (const [view, uri] of Object.entries(VIEWS)) {
    registerAppResource(server, `tenki-${view}`, uri, { mimeType: RESOURCE_MIME_TYPE, description: `Tenki ${view} app` }, async () => ({
      contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml(view, bridge) }],
    }));
  }
```

The host hands the page the tool's arguments and result. The page talks to the host with the MCP Apps bridge, which `server.mjs` reads out of `node_modules` and bakes into every page:

```js
// The MCP Apps browser bundle: one self-contained ES module, read out of
// node_modules and baked into each app page. No build step anywhere.
const bridge = readFileSync(createRequire(import.meta.url).resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");
```

The bridge travels inside the page as base64 and loads as a blob module, not from a URL. The page runs in the viewer's browser, which can't reach this server's localhost, and a cross-origin script would need the host's CSP to allow this origin. A blob module needs neither, so the same page works locally or in a hosted chat.

This is how the page loads the bridge and connects to the host, from the `SCRIPT` string in `widget.mjs`, right after the comment that explains the blob module:

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

The console's shell and the destroy button use two more tools, marked `visibility: ["app"]` (from `server.mjs`):

```js
  // ── app-only: the UI calls these, the model never sees them ──────────────
  const appOnly = { ui: { visibility: ["app"] } };

  registerAppTool(
    server,
    "sandbox_exec",
    { description: "Run a shell command in a sandbox (the console's terminal).", inputSchema: { sandbox_id: sandboxId, command: z.string().min(1) }, _meta: appOnly },
```

`sandbox_exec` and `sandbox_destroy` are hidden from the model. The page calls them through the host's proxy with `app.callServerTool`. This is what makes an app an app: the user acts without going back through the model. To hand work back to the agent, the page calls `app.sendMessage`, which posts a user message to the chat.

### The Tenki side

`sandboxes.mjs` holds every Tenki call: `createAndWait` for a machine, `writeFile` and `exec` to run a program, `exposePort` for a public URL, and `close` to destroy one. This is how a tool gets its sandbox:

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

Every sandbox it creates carries the `cookbook-mcp-apps` tag, and `assertOurs` refuses to reuse or destroy a sandbox without it, because a shared workspace can hold other people's sandboxes.

To serve a web app, `serveWebApp` starts the server under `systemd-run` when the sandbox has passwordless sudo, and with `setsid nohup` otherwise. `exec` returns when its command does, so a server that outlives the call has to belong to something else. It then probes the port 40 times, 0.25 seconds apart, before it exposes the port, so the preview never points at a server that isn't listening yet.

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

- `MCPAppsMiddleware`, from `@ag-ui/mcp-apps-middleware`, connects to the server at `MCP_URL`, gives the model the tools it may see, runs them, puts the app into the chat, and proxies the page's `callServerTool` calls back to the server.
- `ContinueAfterAppsMiddleware`, in `chat/app/continue-middleware.ts`, is the example's own. `MCPAppsMiddleware` runs a UI tool after the model's turn has ended and then finishes the run, so the model never reads the result. The wrapper holds back the end of the run and runs the model again with the tool results, up to 2 more times, so the agent can explain a result or react to a failure in the same reply.
- For model IDs that contain "claude", the chat sends the `anthropic-beta: fine-grained-tool-streaming-2025-05-14` header. Without it, Claude buffers each tool argument until it is complete, so a page of HTML lands in one burst about 25 seconds after the call starts.
- `repairingFetch`, in `chat/app/stream-repair.ts`, fixes streamed tool-call indexes from relays in front of Anthropic models, such as Aisa. See Troubleshooting.

The server is plain MCP, so any MCP Apps host can drive it, not only CopilotKit.

## Troubleshooting

**❌ `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** The server, started by `npm start` or by `verify.mjs`, found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`, and exits at startup. Export one, or run `tenki login --api-key <key>`.

**❌ `invalid auth token - API keys and service tokens must start with tk_`.** SDK 1.x accepts only `tk_` API keys. Create one at https://app.tenki.cloud and export it.

**❌ The agent answers in text, no app appears, and the chat's terminal logs `MCP tool discovery failed`.** The chat couldn't reach the MCP server at `MCP_URL`, so the model got no sandbox tools. Start the server with `npm start` in the example's root, and check that `MCP_URL` in `chat/.env` matches its port.

**❌ `Sandbox <id> was created without inbound access, so its ports cannot be exposed. Serve from a fresh sandbox (omit sandbox_id).`** `launch_web_app` was given the `sandbox_id` of a sandbox that `run_code_in_sandbox` created with inbound access off, which can't change after creation. Ask the agent to launch the app without a `sandbox_id`.

**❌ `The server never listened on port <port>.`** followed by `--- server log ---`. The `start_command` didn't accept connections on that port within the probe window. It must listen on `0.0.0.0` and the given port, which is also in `$PORT`. The lines after `--- server log ---` are the end of the server's log. The sandbox has no outbound access, so a start command that installs packages fails.

**❌ `Sandbox <id> was not created by this example; refusing to use it.`** A tool got a `sandbox_id` without the `cookbook-mcp-apps` tag. The server only touches sandboxes it created. Omit `sandbox_id` to get a fresh one.

**❌ A program that installs packages or fetches a URL fails in the console.** The example creates sandboxes with outbound access off. Ask the agent to run it in a new sandbox with `allow_internet: true`. Passing it with an existing `sandbox_id` changes nothing.

**❌ `OpenAI API key is missing. Pass it using the 'apiKey' parameter or the OPENAI_API_KEY environment variable.`** The chat found no `LLM_API_KEY`, usually because `chat/.env` doesn't exist. The message names OpenAI because the chat uses the AI SDK's OpenAI provider for any compatible endpoint. Copy `.env.example` to `.env` in `chat/` and set `LLM_API_KEY`. If `LLM_API_KEY` is unset and `OPENAI_API_KEY` is set in your shell, you get no error: the chat uses your OpenAI key and sends it to `LLM_BASE_URL`, which is Aisa by default. Set `LLM_API_KEY` explicitly.

**❌ `Cannot read properties of undefined (reading 'hasFinished')`.** A relay in front of an Anthropic model numbered a streamed tool call by Anthropic's content-block index, so the AI SDK's parser found a gap at index 0. `agent.ts` passes `fetch: repairingFetch` to `createOpenAI` to renumber those calls. Keep it if you rework the model setup.

## FAQ

**When shouldn't I use this?**
When the MCP server has to run anywhere but next to the chat on your machine. It has no authentication. `createMcpExpressApp({ host: "127.0.0.1" })` adds DNS-rebinding protection, a Host-header check that rejects requests not addressed to localhost. But `app.listen(PORT, …)` still listens on every network interface, and a client that sets `Host: localhost` itself gets through. So anyone who can reach port 3108 can run code in sandboxes on your Tenki account. Don't run it on a network you don't trust. Also skip it when programs need packages or the network by default, since this example creates sandboxes with outbound access off; when a single command runs longer than 60 seconds; when you need a language other than Python, JavaScript (Node) or shell; or when sandboxes must go away with the chat, since they last until destroyed or for an hour.

**Can I use another MCP Apps host instead of CopilotKit?**
Yes. The server is plain MCP with the MCP Apps extension. Point the host at `http://localhost:3108/mcp`, from the same machine. Each page carries its own copy of the bridge, so it loads nothing from this server.

**Which models work?**
Any tool-calling model behind an OpenAI-compatible endpoint that serves `/chat/completions`. The agent opens an app only by calling a tool. Set `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` in `chat/.env`. With the first two unset, the chat uses Aisa and `claude-sonnet-5`.

**How do I clean up the sandboxes?**
Press "Destroy sandbox" in each app. Anything you leave ends at its 1-hour `maxDurationMs` cap. An app that shows an error has no "Destroy sandbox" button, so a sandbox that booted before the error runs until that cap. `verify.mjs` destroys the sandbox it ran in, even when a later check fails.

## Related

- [MCP Apps](https://github.com/modelcontextprotocol/ext-apps): the spec and SDK (`@modelcontextprotocol/ext-apps`) this server uses.
- [CopilotKit](https://copilotkit.ai): the chat in `chat/`.
- [`@ag-ui/mcp-apps-middleware`](https://www.npmjs.com/package/@ag-ui/mcp-apps-middleware): the middleware that connects the chat's agent to the MCP server.
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox): the SDK `sandboxes.mjs` uses.
- [Tenki docs](https://tenki.cloud/docs). Product used: Tenki Sandbox, more at [tenki.cloud](https://tenki.cloud).
- [mcp-tenki-sandbox](../mcp-tenki-sandbox/): give Claude or Cursor Tenki's own MCP server, without app UIs.
- [expose-a-port](../expose-a-port/): the preview URL on its own, in a few lines of SDK code.
