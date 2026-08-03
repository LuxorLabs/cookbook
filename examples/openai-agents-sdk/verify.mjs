/**
 * Proves the Tenki-facing part of this example: an OpenAI Agents SDK tool that
 * executes Python in a live Tenki sandbox. No LLM needed — we call the tool
 * directly, exactly as the Agents runner would (a RunContext + a JSON string of
 * arguments), and assert its output. (The full agent, which needs a model key,
 * is in agent.mjs.)
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
import { RunContext } from "@openai/agents";
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { makeCodeTool } from "./tenki-tool.mjs";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id");
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const tenki = new TenkiSandbox({ authToken });
let sandbox;
try {
	sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });
	const runPython = makeCodeTool(sandbox);

	// Drive the Agents SDK function tool exactly as the runner would.
	const out = await runPython.invoke(new RunContext(), JSON.stringify({ code: "print(sum(range(11)))" }));
	if (String(out).trim() !== "55") throw new Error(`tool returned ${JSON.stringify(out)}`);

	console.log("✓ openai-agents-sdk: OpenAI Agents SDK tool executed Python in a Tenki sandbox → 55");
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (sandbox) {
		try {
			await sandbox[Symbol.asyncDispose]();
		} catch {
			/* self-reaps via idle/lifetime caps */
		}
	}
}
