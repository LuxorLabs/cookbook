# How to run Claude Agent SDK tools in a Tenki sandbox

**Audience:** Node developers building an agent with Anthropic's [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) who want its shell and file tools to run somewhere other than their own machine.
**Time:** ~5 minutes.
**Outcome:** an agent that writes `fib.py`, runs it, and answers `832040`, with every tool call executed inside a [Tenki Sandbox](https://tenki.cloud/products/sandbox) sandbox, followed by an `ls` run inside the sandbox showing the file is there.

> **Honesty note:** Only tool execution moves into the sandbox. `query()` and the model calls still run on the machine that starts `agent.mjs`, and the isolation holds only because `tools: []` turns off the SDK's built-in tools, which would otherwise run on that machine.

## Why bother

The SDK's built-in Bash, Read, Write, and Edit tools run on whatever host called `query()`. This example switches all of them off and re-implements `bash`, `write_file`, and `read_file` against `sandbox.exec`, `sandbox.writeFile`, and `sandbox.readFile`. The agent's execution surface becomes a disposable sandbox rather than your laptop, so it has no way to touch the host that started it. One sandbox serves the whole agent session and is reused across every tool call.

## Install

You need Node 24 or newer to run `agent.mjs`, because it uses top-level `await using`. `verify.mjs` runs on Node 20.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/claude-agent-sdk
npm install
```

Every later command runs from this directory.

The dependencies, from `package.json`:

```json
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.3.233",
    "@tenkicloud/sandbox": ">=1.4.1",
    "zod": "^4.4.3"
  }
```

`zod` is there because `tool()` takes its input schema as Zod fields, and the Agent SDK declares `zod ^4.0.0` as a peer dependency. `npm install` also pulls the Agent SDK's platform-specific package, which is about 250 MB unpacked, so the first install takes a while.

## Authenticate

`agent.mjs` reads everything from the environment:

```bash
export TENKI_AUTH_TOKEN=tk_...   # a Tenki API key from https://app.tenki.cloud
export ANTHROPIC_API_KEY=...     # the agent turn
export TENKI_WORKSPACE_ID=...    # optional
```

- `TENKI_API_KEY` works in place of `TENKI_AUTH_TOKEN`. When `TENKI_AUTH_TOKEN` is unset, the Tenki SDK falls back to `TENKI_API_KEY`. SDK 1.x accepts only `tk_` keys.
- `TENKI_WORKSPACE_ID` is optional. Tenki infers the workspace from a workspace API key, and the SDK leaves the field out when the variable is empty.
- If you stored your key with `tenki login --api-key <key>`, it's in `~/.config/tenki/config.yaml`. `verify.mjs` reads it from there (the `auth_token` line), but `agent.mjs` does not, so export it before running the agent.

## Use it

```bash
node agent.mjs
```

This is the whole of `agent.mjs`:

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

It creates one sandbox (1 CPU core, 1024 MB) for the session, registers the three tools through an in-process MCP server named `tenki`, disables every built-in tool, and caps the run at 12 turns. It prints each tool call the agent makes, the agent's final answer, and the output of an `ls` run inside the sandbox. `await using` terminates the sandbox when the script ends.

A run prints something like this:

```
→ mcp__tenki__write_file {"path":"fib.py","content":"def fib(n):\n    a, b = 0, 1\n    for _ in
→ mcp__tenki__bash {"command":"python3 fib.py"}
The 30th Fibonacci number is **832040**.
-rw-r--r-- 1 tenki tenki 136 … fib.py
```

Each tool-call line shows the first 70 characters of the call's input. The model writes its own `fib.py` and its own answer, so your tool calls and file size can differ.

## How the sandbox tools replace the built-ins

All three tools live in `tenki-tools.mjs`:

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

- **`tools: []` is the whole security argument.** Leave it out and the SDK keeps its built-in Bash, Read, Write, and Edit, which run on the machine that called `query()`. The sandbox tools would then be one option among several rather than the only way out. With it, the agent's entire execution surface is the sandbox.
- **`tool()` takes a raw Zod shape, not a schema object.** Pass `{ command: z.string() }`. Passing `z.object({ command: z.string() })` is the easy mistake.
- Tools registered through `createSdkMcpServer` run in this process, but they're still named `mcp__<server>__<tool>`. List those full names in `allowedTools`, or the agent asks for permission on every call.
- **A tool result carries no exit status.** `sandbox.exec` reports one, but the model only sees the text you return, so a command that failed after printing to stderr reads as success. `bash` prefixes `exit N` when the code is non-zero. It also gives each command 120 seconds, because `exec` is unbounded by default and one `sleep infinity` would stall the agent for the sandbox's whole lifetime. A spent budget resolves with status `TIMED_OUT` and exit code -1 rather than rejecting, so `bash` says `timed out after 120s` instead.
- A tool handler that throws is caught by the SDK and delivered as an `is_error` tool result. `read_file` on a missing path shows the agent the real `[not_found]` message, and it recovers on its own, so the tools need no `try`/`catch`.
- `sandbox.readFile` resolves to a `Uint8Array`, not a string, so `read_file` decodes it before handing it back to the model. `exec(command, { args })` does no shell splitting, so `bash` wraps the command in `sh -c` to get shell behavior.
- The SDK's file methods only work under `/home/tenki`, the sandbox's working directory. Relative paths resolve there. Commands run through `bash` can write anywhere.

## Check it works

```bash
node verify.mjs
```

It prints:

```
✓ claude-agent-sdk: write_file → bash python3 fib.py → 832040 → read_file → dispose
```

`verify.mjs` builds the tools against a live sandbox and calls their handlers directly, as the agent loop would: it writes `fib.py`, runs it with `bash` and asserts `832040`, reads the file back, and disposes of the sandbox. It needs no model key, so the agent turn itself (`query()`, `tools: []`, `allowedTools`) isn't exercised. This is what CI runs. It uses `try`/`finally` rather than `await using`, so it runs on Node 20, and it finds your key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Any failed check prints a `✗` line and exits non-zero.

## Troubleshooting

- ❌ **``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export a `tk_` key, or store one with `tenki login --api-key <key>`.
- ❌ **`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** `agent.mjs` reads the Tenki key from the environment only, not from `~/.config/tenki/config.yaml`. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY` before you run `node agent.mjs`.
- ❌ **`invalid auth token - API keys and service tokens must start with tk_`.** The value you exported isn't a Tenki API key, and SDK 1.x accepts only `tk_` keys. Create one at https://app.tenki.cloud.
- ❌ **`node agent.mjs` fails with a `SyntaxError` at the `await using` line.** Top-level `await using` needs Node 24, and Node 22 can't parse it. Upgrade to Node 24 or newer. `verify.mjs` still runs on Node 20.
- ❌ **The agent asks for permission on every tool call.** `allowedTools` doesn't list the tools' full `mcp__<server>__<tool>` names. If you rename the `tenki` server or add a tool, update `allowedTools` to match.
- ❌ **A `bash` result reads `timed out after 120s`.** The `bash` tool gives each command 120 seconds (`timeoutMs: 120_000` in `tenki-tools.mjs`). Raise that value if your commands need longer.
- ❌ **`write_file` or `read_file` fails with `permission_denied … path outside workdir`.** The SDK's file methods are confined to `/home/tenki`. The agent sees the error as an `is_error` result and can retry with a relative path, or use `bash`, which can write anywhere.

## FAQ

**When shouldn't I use this?**
- When you want the SDK's built-in tools. This example turns off Bash, Read, Write, and Edit on purpose and gives the agent exactly three replacements. To run Claude Code itself inside a sandbox, see [`../claude-code-sandbox/`](../claude-code-sandbox/).
- When the agent itself must not run on your machine. Only tool execution moves into the sandbox.
- When the agent works with binary files. `write_file` takes a string, and `read_file` decodes the file's bytes as text.
- When files must outlive the run. `await using` terminates the sandbox when `agent.mjs` ends.

**Why one sandbox per session instead of one per tool call?** It's cheaper than one per call, and files the agent writes are still there on the next call. That's how `bash` can run the `fib.py` that `write_file` wrote on an earlier call.

**Can code the agent runs reach the internet?** Yes. Outbound network is on by default, and `agent.mjs` doesn't change it. To isolate the sandbox, pass `allowOutbound: false` in the `createAndWait` options.

## Related

- [`@anthropic-ai/claude-agent-sdk` on npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [Tenki Sandbox](https://tenki.cloud/products/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
- [`../openai-agents-sdk/`](../openai-agents-sdk/): the same one-sandbox-per-session pattern with the OpenAI Agents SDK and a `run_python` tool.
- [`../claude-code-sandbox/`](../claude-code-sandbox/): runs Claude Code headless inside a Tenki sandbox and hands its work back as a patch.
