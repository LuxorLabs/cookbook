// The Claude Agent SDK with Tenki as its execution backend: every command the
// agent runs and every file it writes lands in a disposable microVM, not on this box.
//
// Needs a model key: export ANTHROPIC_API_KEY=...
import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { makeTenkiTools } from "./tenki-tools.mjs";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// One sandbox for the whole agent session, reused across every tool call.
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
