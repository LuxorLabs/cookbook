// The Claude Agent SDK with Luxor Agent Cloud as its execution backend: every command the
// agent runs and every file it writes lands in a disposable sandbox, not on this box.
//
// Needs a model key: export ANTHROPIC_API_KEY=...
import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { LuxorSandbox, stdoutText, stderrText } from "@luxorai/sandbox";
import { makeLuxorTools } from "./luxor-tools.mjs";

const luxor = new LuxorSandbox({ authToken: process.env.LUXORAI_AUTH_TOKEN || process.env.LUXORAI_API_KEY || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });

// One sandbox for the whole agent session, reused across every tool call.
await using sandbox = await luxor.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	workspaceId: process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID,
});

for await (const message of query({
	prompt: "Write fib.py, a Python script that computes the 30th Fibonacci number, run it, and tell me the number.",
	options: {
		tools: [], // empty array disables every built-in tool — nothing can execute locally
		mcpServers: { luxor: createSdkMcpServer({ name: "luxor", version: "1.0.0", tools: makeLuxorTools(sandbox) }) },
		// In-process MCP tools are still namespaced mcp__<server>__<tool>.
		allowedTools: ["mcp__luxor__bash", "mcp__luxor__write_file", "mcp__luxor__read_file"],
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
