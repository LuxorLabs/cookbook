# Claude Agent SDK

Run every tool call from the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) in a Tenki sandbox. The example turns off the SDK's built-in Bash, Read, Write, and Edit tools, which run on your machine, and replaces them with `bash`, `write_file`, and `read_file` tools backed by one sandbox per session. The agent writes `fib.py`, runs it, and answers `832040`.

`query()` and the model calls still run locally. Only tool execution moves into the sandbox.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Claude Agent SDK" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/claude-agent-sdk, check that Node.js is 24 or later, and run npm install.
2. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud) and ANTHROPIC_API_KEY. If either is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs first (it doesn't call the model), then node agent.mjs, and confirm the agent answers 832040 and the final ls shows fib.py in the sandbox.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to add tenki-tools.mjs to my own Agent SDK project with tools: [] so no tool runs on my machine.
```

## Quick start

You need:

- Node.js 24 or later for `agent.mjs`, which uses top-level `await using`. `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An Anthropic API key, for the agent run only.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/claude-agent-sdk
npm install
```

This installs `@anthropic-ai/claude-agent-sdk`, `@tenkicloud/sandbox`, and `zod`. The Agent SDK pulls a platform package of about 250 MB, so the first install takes a while.

### 2. Set your keys

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
export ANTHROPIC_API_KEY=...
```

`agent.mjs` reads both from the environment only. `verify.mjs` also accepts a Tenki key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run the agent

```bash
node agent.mjs
```

```
→ mcp__tenki__write_file {"path":"fib.py","content":"def fib(n):\n    a, b = 0, 1\n    for _ in
→ mcp__tenki__bash {"command":"python3 fib.py"}
The 30th Fibonacci number is **832040**.
-rw-r--r-- 1 tenki tenki 136 … fib.py
```

It prints each tool call (first 70 characters of its input), the agent's answer, and an `ls` run inside the sandbox. The model writes its own code, so your output can differ.

### 4. Verify

```bash
node verify.mjs
```

```
✓ claude-agent-sdk: write_file → bash python3 fib.py → 832040 → read_file → dispose
```

`verify.mjs` calls the three tool handlers directly against a live sandbox: it writes `fib.py`, runs it, asserts `832040`, and reads the file back. It needs no Anthropic key, so it doesn't run `query()`.

## The agent

`agent.mjs`:

```js
// The Claude Agent SDK with Tenki as its execution backend: every command the
// agent runs and every file it writes lands in a disposable sandbox, not on this box.
//
// Needs a model key: export ANTHROPIC_API_KEY=...
import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";
import { makeTenkiTools } from "./tenki-tools.mjs";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// One sandbox for the whole agent session, reused across every tool call.
await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

for await (const message of query({
  prompt: "Write fib.py, a Python script that computes the 30th Fibonacci number, run it, and tell me the number.",
  options: {
    tools: [], // empty array disables every built-in tool — nothing can execute locally
    mcpServers: { tenki: createSdkMcpServer({ name: "tenki", version: "1.0.0", tools: makeTenkiTools(sandbox) }) },
    // In-process MCP tools are still namespaced mcp__<server>__<tool>.
    allowedTools: ["mcp__tenki__bash", "mcp__tenki__write_file", "mcp__tenki__read_file"],
    maxTurns: 12,
  },
})) {
  // Every tool call printed here ran in the sandbox. There is no local one to fall back to.
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "tool_use") console.log(`→ ${block.name} ${JSON.stringify(block.input).slice(0, 70)}`);
    }
  }
  if (message.type === "result") console.log(message.result);
}

// The proof: the script the agent wrote is in the sandbox, and nowhere on this machine.
const proof = await sandbox.exec("ls", { args: ["-l", "fib.py"] });
console.log(proof.exitCode === 0 ? stdoutText(proof) : `fib.py is not in the sandbox: ${stderrText(proof).trim()}`);
```

## The tools

`tenki-tools.mjs`:

```js
// Claude Agent SDK tools backed by a Tenki sandbox.
//
// The SDK's built-in Bash/Read/Write run on whatever host called query(). These
// three route the same capabilities into a disposable sandbox instead, so the
// agent's execution surface is a machine you delete rather than your laptop.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { stdoutText, stderrText } from "@tenkicloud/sandbox";
import { z } from "zod";

const say = (text) => ({ content: [{ type: "text", text }] });

export function makeTenkiTools(sandbox) {
  return [
    // The schema argument is a raw Zod shape — a bare object of fields, not z.object({...}).
    tool("bash", "Run a shell command in the sandbox and return its stdout and stderr.", { command: z.string() }, async ({ command }) => {
      // Unbounded by default, so one `sleep infinity` would stall the agent for the sandbox's
      // whole lifetime. A spent budget resolves (status TIMED_OUT, exitCode -1) rather than
      // rejecting, and "exit -1" alone tells the model nothing, so name it.
      const r = await sandbox.exec("sh", { args: ["-c", command], timeoutMs: 120_000 });
      const out = `${stdoutText(r)}${stderrText(r)}`.trim();
      if (r.status === "TIMED_OUT") return say(`timed out after 120s\n${out}`.trim());
      // Nothing carries the exit status to the model, so a failure that printed to
      // stderr looks like success. Say it out loud instead.
      return say(r.exitCode === 0 ? out || "(no output)" : `exit ${r.exitCode}\n${out}`.trim());
    }),

    tool("write_file", "Write a file in the sandbox.", { path: z.string(), content: z.string() }, async ({ path, content }) => {
      await sandbox.writeFile(path, content); // relative paths resolve under /home/tenki
      return say(`wrote ${path}`);
    }),

    // readFile hands back bytes, not a string. It throws on a missing path, which the
    // SDK turns into an is_error tool result — the agent sees it and can recover.
    tool("read_file", "Read a file from the sandbox.", { path: z.string() }, async ({ path }) =>
      say(new TextDecoder().decode(await sandbox.readFile(path)))),
  ];
}
```

Things to know:

- **`tools: []` keeps execution off your machine.** Without it, the built-in tools stay available and run locally.
- **`tool()` takes a raw Zod shape**, `{ command: z.string() }`, not `z.object(...)`.
- **List the full tool names in `allowedTools`.** In-process MCP tools are still named `mcp__<server>__<tool>`. Otherwise the agent asks for permission on every call.
- **Report the exit status.** The model only sees the text a tool returns, so `bash` prefixes `exit N` on failure. It also caps each command at 120 seconds, since `exec` is unbounded by default. A timeout resolves with status `TIMED_OUT` rather than throwing.
- **Thrown errors reach the agent.** The SDK turns a throwing handler into an `is_error` result, so `read_file` on a missing path shows the agent `[not_found]` and it can recover.
- **SDK file methods are confined to `/home/tenki`.** Commands run through `bash` can write anywhere. `write_file` and `read_file` handle text only.
- **One sandbox per session.** Files persist between tool calls, and `await using` terminates the sandbox when the script ends. Outbound network is on; pass `allowOutbound: false` to `createAndWait` to isolate it.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `agent.mjs` reads only the environment. Export the key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `SyntaxError` at `await using` | Use Node 24 or later. |
| The agent asks for permission on every call | `allowedTools` must list the full `mcp__tenki__*` names. Update it if you rename the server or add tools. |
| `timed out after 120s` | Raise `timeoutMs` in `tenki-tools.mjs`. |
| `permission_denied … path outside workdir` | Use a path under `/home/tenki`, or write it with `bash`. |

## Related

- [Claude Code](../claude-code-sandbox/): run Claude Code itself headless in a sandbox
- [OpenAI Agents SDK](../openai-agents-sdk/): the same one-sandbox-per-session pattern
- [`@anthropic-ai/claude-agent-sdk` on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [Tenki Sandbox](https://tenki.cloud/products/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
