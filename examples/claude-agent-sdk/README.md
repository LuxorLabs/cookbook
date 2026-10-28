# Claude Agent SDK

Build a Claude agent whose commands and files live in a Tenki sandbox instead of on your computer.

The [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) is a library for building agents: programs where Claude works through a task step by step, using **tools** (functions it can call) to run commands and read or write files. Out of the box, those tools act on the machine running your code. This example swaps them for three tools of its own, `bash`, `write_file`, and `read_file`, that do the same jobs inside a **sandbox**: a disposable cloud machine that Tenki creates for the session and deletes afterwards.

You ask the agent to write a Python script that computes the 30th Fibonacci number and run it. It writes `fib.py` in the sandbox, runs it there, and answers `832040`. Your own files are never touched.

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

- Node.js 24 or later. `verify.mjs` also runs on Node 20.
- A Tenki API key (starts with `tk_`) from [app.tenki.cloud](https://app.tenki.cloud).
- An Anthropic API key from [the Claude Console](https://platform.claude.com). Only `agent.mjs` uses it.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/claude-agent-sdk
npm install
```

This installs the Claude Agent SDK, the Tenki sandbox client (`@tenkicloud/sandbox`), and `zod`, a small library for describing what inputs a tool accepts. The Agent SDK downloads a platform package of about 250 MB, so the first install takes a while.

### 2. Set your API keys

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
export ANTHROPIC_API_KEY=...
```

`agent.mjs` reads both keys from the environment. `verify.mjs` also accepts a Tenki key saved with `tenki login --api-key <key>`. Set `TENKI_WORKSPACE_ID` if you want the sandbox in a specific workspace.

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

Each `→` line is a tool call the agent made, with the start of its input. Then comes the agent's answer, and last, a directory listing taken inside the sandbox that shows `fib.py` is there. Claude writes its own code, so your exact output will differ.

### 4. Verify

```bash
node verify.mjs
```

```
✓ claude-agent-sdk: write_file → bash python3 fib.py → 832040 → read_file → dispose
```

`verify.mjs` checks the sandbox side without involving Claude. It calls the three tools directly, the same way the agent would: it writes `fib.py`, runs it, checks for `832040`, reads the file back, and deletes the sandbox. It doesn't need an Anthropic key.

## How it works

There are three moving parts.

1. **Your script** runs on your computer. It starts a Tenki sandbox, then hands Claude a task and the list of tools it may use.
2. **Claude** decides what to do next. When it wants to run a command or write a file, it asks for a tool call, for example `bash` with `python3 fib.py`.
3. **The tool** carries out that request. Here every tool forwards the request to the sandbox and sends the result back to Claude as text. Claude reads it and decides the next step, until it has an answer.

Claude itself, and the loop that passes messages back and forth, still run on your computer through the SDK. Only the work the tools do happens in the sandbox.

A few terms you'll see in the code:

- **`query()`** is the SDK function that runs this loop. You give it a prompt and options, and it streams back each message: Claude's text, its tool calls, and the final result.
- **Built-in tools** are the SDK's own `Bash`, `Read`, `Write`, and `Edit` tools. They act on your computer, so the example turns them all off with `tools: []`.
- **MCP** (Model Context Protocol) is the standard format the SDK uses for custom tools. `createSdkMcpServer()` bundles the three Tenki tools so the SDK can offer them to Claude. It runs inside your script; there's no separate server to start. The SDK names each tool `mcp__<bundle name>__<tool name>`, which is why the output shows `mcp__tenki__bash`.
- **`allowedTools`** lists the tools Claude may use without asking you for permission first. Leave a tool out and the SDK pauses to ask every time Claude calls it.

## The agent

`agent.mjs` starts the sandbox, runs the agent, and prints what happened:

```js
// The Claude Agent SDK with Tenki as its execution backend: every command the
// agent runs and every file it writes lands in a Tenki sandbox, not on this computer.
//
// Needs a model key: export ANTHROPIC_API_KEY=...
import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";
import { makeTenkiTools } from "./tenki-tools.mjs";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// Start one sandbox and reuse it for every tool call, so files persist between steps.
// `await using` deletes the sandbox automatically when the script ends.
await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

for await (const message of query({
  prompt: "Write fib.py, a Python script that computes the 30th Fibonacci number, run it, and tell me the number.",
  options: {
    tools: [], // turn off the SDK's built-in tools, which would run on this computer
    // Offer Claude the three sandbox tools, bundled as an in-process MCP server named "tenki".
    mcpServers: { tenki: createSdkMcpServer({ name: "tenki", version: "1.0.0", tools: makeTenkiTools(sandbox) }) },
    // Let Claude call them without a permission prompt. The SDK names them mcp__<server>__<tool>.
    allowedTools: ["mcp__tenki__bash", "mcp__tenki__write_file", "mcp__tenki__read_file"],
    maxTurns: 12, // stop after 12 rounds of back-and-forth
  },
})) {
  // Print each tool call Claude makes. All of them run in the sandbox.
  if (message.type === "assistant") {
    for (const block of message.message.content) {
      if (block.type === "tool_use") console.log(`→ ${block.name} ${JSON.stringify(block.input).slice(0, 70)}`);
    }
  }
  if (message.type === "result") console.log(message.result);
}

// Show that the script Claude wrote is in the sandbox, not on this computer.
const proof = await sandbox.exec("ls", { args: ["-l", "fib.py"] });
console.log(proof.exitCode === 0 ? stdoutText(proof) : `fib.py is not in the sandbox: ${stderrText(proof).trim()}`);
```

`await using` is the reason for the Node 24 requirement. It's newer JavaScript syntax that cleans up a resource, here the sandbox, when the script finishes, even if it fails partway.

## The tools

`tenki-tools.mjs` defines the three tools. Copy this file into your own project to give any Agent SDK agent the same sandbox tools.

Each tool is made with the SDK's `tool()` function, which takes four things: a name, a description Claude reads to decide when to use it, the inputs it accepts (described with `zod`), and the function that does the work. Whatever that function returns is what Claude sees.

```js
// Claude Agent SDK tools backed by a Tenki sandbox.
//
// The SDK's built-in Bash, Read, and Write tools act on the computer that runs
// query(). These three do the same jobs inside a Tenki sandbox instead, so
// everything the agent runs or writes stays on a machine you can throw away.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { stdoutText, stderrText } from "@tenkicloud/sandbox";
import { z } from "zod";

// Tools return their result to Claude as a list of content blocks; these return plain text.
const say = (text) => ({ content: [{ type: "text", text }] });

export function makeTenkiTools(sandbox) {
  return [
    // The inputs are a plain object of fields ({ command: z.string() }), not z.object({...}).
    tool("bash", "Run a shell command in the sandbox and return its stdout and stderr.", { command: z.string() }, async ({ command }) => {
      // Commands have no time limit by default, so cap each one at 2 minutes. A command
      // that runs out of time comes back with status TIMED_OUT instead of throwing.
      const r = await sandbox.exec("sh", { args: ["-c", command], timeoutMs: 120_000 });
      const out = `${stdoutText(r)}${stderrText(r)}`.trim();
      if (r.status === "TIMED_OUT") return say(`timed out after 120s\n${out}`.trim());
      // Claude only sees the text we return, so say when a command failed.
      return say(r.exitCode === 0 ? out || "(no output)" : `exit ${r.exitCode}\n${out}`.trim());
    }),

    tool("write_file", "Write a file in the sandbox.", { path: z.string(), content: z.string() }, async ({ path, content }) => {
      await sandbox.writeFile(path, content); // relative paths resolve under /home/tenki
      return say(`wrote ${path}`);
    }),

    // readFile returns raw bytes, so decode them to text. If the file doesn't exist it throws;
    // the SDK passes that error to Claude, which can then try something else.
    tool("read_file", "Read a file from the sandbox.", { path: z.string() }, async ({ path }) =>
      say(new TextDecoder().decode(await sandbox.readFile(path)))),
  ];
}
```

Things to know when you adapt it:

- **Keep `tools: []`.** Without it, Claude also gets the built-in tools, and those run on your computer.
- **Add new tools to `allowedTools` by their full name**, such as `mcp__tenki__my_tool`. If you rename the `tenki` server, update the names to match.
- **Tell Claude when something fails.** Claude only sees the text a tool returns, so `bash` starts its reply with `exit N` when a command fails, and with `timed out after 120s` when it runs too long.
- **Errors are fine to throw.** If a tool throws, the SDK reports the error to Claude instead of crashing, so Claude can recover. For example, reading a missing file shows Claude a `[not_found]` error.
- **`write_file` and `read_file` work under `/home/tenki` and handle text only.** Commands run through `bash` can reach any path in the sandbox.
- **The sandbox can reach the internet.** Pass `allowOutbound: false` to `createAndWait` to cut it off.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no Tenki key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `agent.mjs` only reads the environment. Export the key in the same terminal. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `SyntaxError` at `await using` | Upgrade to Node 24 or later. |
| The agent asks for permission on every call | `allowedTools` must list the full `mcp__tenki__*` names. Update it if you rename the server or add tools. |
| `timed out after 120s` | The command ran longer than 2 minutes. Raise `timeoutMs` in `tenki-tools.mjs`. |
| `permission_denied … path outside workdir` | `write_file` and `read_file` only work under `/home/tenki`. Use a path there, or write the file with `bash`. |

## Related

- [Claude Code](../claude-code-sandbox/): run Claude Code itself inside a sandbox
- [OpenAI Agents SDK](../openai-agents-sdk/): the same one-sandbox-per-session pattern with OpenAI's SDK
- [Claude Agent SDK docs](https://code.claude.com/docs/en/agent-sdk/overview) and [`@anthropic-ai/claude-agent-sdk` on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [Tenki Sandbox](https://tenki.cloud/products/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
