# Claude Agent SDK on Tenki

Anthropic's [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) with a [Tenki Sandbox](https://tenki.cloud/products/sandbox) microVM as its execution backend: the built-in tools are switched off and `bash`, `write_file`, and `read_file` are re-implemented against `sandbox.exec` / `sandbox.writeFile` / `sandbox.readFile`, so the agent has no way to touch the host that started it.

## The tools (`tenki-tools.mjs`)

```js
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { stdoutText, stderrText } from "@tenkicloud/sandbox";
import { z } from "zod";

const say = (text) => ({ content: [{ type: "text", text }] });

export function makeTenkiTools(sandbox) {
  return [
    // The schema argument is a raw Zod shape — a bare object of fields, not z.object({...}).
    tool("bash", "Run a shell command in the sandbox and return its stdout and stderr.", { command: z.string() }, async ({ command }) => {
      const r = await sandbox.exec("sh", { args: ["-c", command] });
      return say(`${stdoutText(r)}${stderrText(r)}`.trim() || `(no output; exit ${r.exitCode})`);
    }),

    tool("write_file", "Write a file in the sandbox.", { path: z.string(), content: z.string() }, async ({ path, content }) => {
      await sandbox.writeFile(path, content); // relative paths resolve under /home/tenki
      return say(`wrote ${path}`);
    }),

    // readFile hands back bytes, not a string.
    tool("read_file", "Read a file from the sandbox.", { path: z.string() }, async ({ path }) =>
      say(new TextDecoder().decode(await sandbox.readFile(path)))),
  ];
}
```

## The agent (`agent.mjs`)

One sandbox for the session, the tools registered through an in-process MCP server, and every built-in tool disabled:

```js
await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

for await (const message of query({
  prompt: "Write a Python script that computes the 30th Fibonacci number, run it, and tell me the number.",
  options: {
    tools: [], // empty array disables every built-in tool — nothing can execute locally
    mcpServers: { tenki: createSdkMcpServer({ name: "tenki", version: "1.0.0", tools: makeTenkiTools(sandbox) }) },
    // In-process MCP tools are still namespaced mcp__<server>__<tool>.
    allowedTools: ["mcp__tenki__bash", "mcp__tenki__write_file", "mcp__tenki__read_file"],
    maxTurns: 12,
  },
})) {
  if (message.type === "result") console.log(message.result);
}
```

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
export ANTHROPIC_API_KEY=...     # the agent turn
node agent.mjs                   # -> The 30th Fibonacci number is 832040.
```

Verify the Tenki half with no model key — this is what CI runs:

```bash
node verify.mjs   # calls the tool handlers directly → runs Python in Tenki → asserts 832040
```

## Notes

- **`tools: []` is the whole security argument.** Leave it out and the SDK keeps its built-in Bash, Read, Write, and Edit, which run on the machine that called `query()` — the sandbox tools would then be one option among several rather than the only way out. With it, the agent's entire execution surface is the microVM.
- **`tool()` takes a raw Zod shape, not a schema object.** Pass `{ command: z.string() }`; passing `z.object({ command: z.string() })` is the easy mistake.
- Tools registered through `createSdkMcpServer` run in this process, but they are still named `mcp__<server>__<tool>` — list those full names in `allowedTools` or the agent will ask for permission on every call.
- `sandbox.readFile` resolves to a `Uint8Array`, not a string; decode it before handing it back to the model. `exec(command, { args })` does no shell splitting, so `sh -c` is what makes `bash` behave like a shell.
- One sandbox per agent session, reused across every tool call — cheaper than one per call, and files the agent writes are still there on the next call. Top-level `await using` needs Node 24+; `verify.mjs` uses `try`/`finally`, so CI on Node 20 is fine.
