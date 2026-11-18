// An OpenAI Agents SDK agent that runs code in a Luxor sandbox (the "code interpreter" pattern).
// The agent writes Python; the run_python tool executes it in a disposable sandbox.
//
// Needs a model key: export OPENAI_API_KEY=... Run: node agent.mjs
import { Agent, run } from "@openai/agents";
import { LuxorSandbox } from "@luxorai/sandbox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { makeCodeTool } from "./luxor-tool.mjs";

const cfg = (key) => {
	try {
		return (readFileSync(["luxor", "tenki"].map((d) => `${homedir()}/.config/${d}/config.yaml`).find(existsSync) ?? "", "utf8").match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const luxor = new LuxorSandbox({ authToken: process.env.LUXORAI_AUTH_TOKEN || process.env.LUXORAI_API_KEY || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token") });

// One sandbox for the whole agent session, reused across every tool call.
const sandbox = await luxor.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	workspaceId: process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id"),
});

try {
	const agent = new Agent({
		name: "Code Interpreter",
		instructions: "You solve problems by writing Python and running it with the run_python tool. Always run code to get the answer, then report the result.",
		model: "gpt-4o-mini", // needs OPENAI_API_KEY
		tools: [makeCodeTool(sandbox)], // the tool runs the agent's code in Luxor Agent Cloud
	});

	const result = await run(agent, "What is the 20th Fibonacci number? Compute it with Python.");
	console.log(result.finalOutput);
} finally {
	await sandbox[Symbol.asyncDispose](); // dispose the sandbox when the agent is done
}
