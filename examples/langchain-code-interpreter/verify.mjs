/**
 * Proves the sandbox-facing part of this example: a LangChain tool that executes
 * Python in a live Luxor sandbox. No LLM needed — we call the tool directly and
 * assert its output. (The full agent, which needs a model key, is in agent.mjs.)
 * Token/workspace from env (CI) or ~/.config/luxor/config.yaml (local `luxor login`).
 */
import { LuxorSandbox } from "@luxorai/sandbox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { makeCodeTool } from "./luxor-tool.mjs";

const cfg = (key) => {
	try {
		const c = readFileSync(["luxor", "tenki"].map((d) => `${homedir()}/.config/${d}/config.yaml`).find(existsSync) ?? "", "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id");
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `luxor login`.");
	process.exit(1);
}

const luxor = new LuxorSandbox({ authToken });
let sandbox;
try {
	sandbox = await luxor.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });
	const runPython = makeCodeTool(sandbox);

	// Drive the LangChain tool exactly as an agent would.
	const out = await runPython.invoke({ code: "print(sum(range(11)))" });
	if (String(out).trim() !== "55") throw new Error(`tool returned ${JSON.stringify(out)}`);

	console.log("✓ langchain-code-interpreter: LangChain tool executed Python in a Luxor sandbox → 55");
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
