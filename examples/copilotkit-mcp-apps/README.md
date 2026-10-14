# MCP Apps: tools that bring their own UI

A normal MCP tool returns text and the chat prints it. An **[MCP App](https://github.com/modelcontextprotocol/ext-apps)** returns text *and* names a `ui://` resource — an HTML page the host renders in the conversation and wires to that tool call. The answer arrives as something you can keep working in.

This example gives an agent two of them, each backed by a [Tenki](https://tenki.cloud) sandbox:

| Tool | What the user gets |
| --- | --- |
| `run_code_in_sandbox` | A console: the program, its output, timings, and a live shell into the same sandbox |
| `launch_web_app` | The app the agent just wrote, served from the sandbox on a public URL, running in the chat |

Two more tools are marked `visibility: ["app"]` — hidden from the model, callable only from the UI through the host's proxy. That is what the terminal and the destroy button use, and it is the part that makes an app an app: the user acts without going back through the model.

The chat in [`chat/`](chat/) is [CopilotKit](https://copilotkit.ai), which renders MCP Apps natively. The server is plain MCP, so any MCP Apps host can drive it.

## Run it

```bash
cd examples/copilotkit-mcp-apps
npm install

export TENKI_AUTH_TOKEN="your-api-key"   # or: tenki login
npm start                                 # MCP App server on :3108
```

In a second terminal, start the chat with any OpenAI-compatible model:

```bash
cd examples/copilotkit-mcp-apps/chat
cp .env.example .env     # LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
npm install && npm run dev
```

Open http://localhost:3000 and ask for something that needs a computer:

> "Show me this sandbox is real: run uname -a, nproc and free -m."

The agent calls `run_code_in_sandbox`, Tenki boots a microVM in about half a second, and the console appears in the chat with the output. Type `ls -la` into its shell — that command goes from the app to the MCP server to the same sandbox, with no model in the loop.

## How a tool gets a UI

Declaring one is a single line of metadata ([`server.mjs`](server.mjs)):

```js
registerAppTool(server, "run_code_in_sandbox", {
  description: "Run a program in a Tenki sandbox and open a console…",
  inputSchema: { language: z.enum(["python", "javascript", "shell"]), code: z.string() },
  _meta: { ui: { resourceUri: "ui://tenki/console.html" } },   // ← the whole difference
}, async ({ language, code }) => { … });
```

The server then serves that `ui://` resource as HTML, and the host hands the page the tool's arguments and result. The page ([`widget.mjs`](widget.mjs)) is plain HTML and JavaScript — no framework, no build step. It talks to the host with the MCP Apps bridge, which this server inlines into the page so the app works wherever it is hosted:

```js
const app = new App({ name: "Tenki sandbox", version: "1.0.0" }, {}, { autoResize: true });
app.ontoolresult = (res) => render(res.structuredContent);
await app.connect();

// The shell in the console — the UI calling the server directly.
await app.callServerTool({ name: "sandbox_exec", arguments: { sandbox_id, command } });

// Handing work back to the agent.
app.sendMessage({ role: "user", content: [{ type: "text", text: "This failed — please fix it." }] });
```

## Why sandboxes

Every one of these tools runs code the model just wrote. [`sandboxes.mjs`](sandboxes.mjs) is the whole Tenki side: `createAndWait` for a machine, `writeFile` + `exec` to run something in it, `exposePort` for a public URL. Sandboxes are tagged, bounded to an hour, and the server refuses to touch anything it did not create — a workspace can hold other people's work.

Passing `sandbox_id` back into a tool reuses the machine: the files are still there, nothing boots, and the chat gains a session. The exception is `launch_web_app`, which must serve from a fresh sandbox — one created by `run_code_in_sandbox` has inbound off, and inbound access is fixed at creation.

## Verify

```bash
npm run verify
```

Boots a real sandbox through the MCP App tool, asserts the output, runs a shell command through the app-only tool, and cleans up. No model key needed.
