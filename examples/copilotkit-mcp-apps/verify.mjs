/**
 * Proves the Tenki-facing part of this example: the MCP App server's tools,
 * driven by an MCP client exactly as CopilotKit's middleware drives them, against
 * LIVE Tenki. No LLM needed — the chat (which needs a model key) is in chat/.
 *
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
import { spawn } from "node:child_process";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 3199;
const URL_ = `http://localhost:${PORT}/mcp`;
const server = spawn(process.execPath, ["server.mjs"], { cwd: import.meta.dirname, env: { ...process.env, MCP_PORT: String(PORT) }, stdio: "inherit" });
const stop = () => server.kill();

const client = new Client({ name: "cookbook-verify", version: "1.0.0" });
let sandboxId;
try {
	for (let i = 0; ; i++) {
		try {
			await client.connect(new StreamableHTTPClientTransport(new URL(URL_)));
			break;
		} catch (err) {
			if (i > 40) throw err;
			await new Promise((r) => setTimeout(r, 250));
		}
	}

	// An MCP App tool is a normal tool that also names a UI resource.
	const { tools } = await client.listTools();
	const app = tools.find((t) => t.name === "run_code_in_sandbox");
	if (!app?._meta?.ui?.resourceUri) throw new Error("run_code_in_sandbox does not declare a UI resource");
	const { contents } = await client.readResource({ uri: app._meta.ui.resourceUri });
	if (!String(contents[0]?.text ?? "").includes("<!doctype html>")) throw new Error("the UI resource is not an HTML app");

	// Run real code in a real sandbox.
	const res = await client.callTool({ name: "run_code_in_sandbox", arguments: { language: "python", code: "print(6 * 7)", title: "verify" } });
	const data = res.structuredContent ?? {};
	if (res.isError) throw new Error(data.error ?? "run_code_in_sandbox failed");
	sandboxId = data.sandbox?.id;
	if (data.run?.stdout.trim() !== "42") throw new Error(`sandbox printed ${JSON.stringify(data.run?.stdout)}`);

	// The UI's own tool: a shell command in the same sandbox, no model involved.
	const shell = await client.callTool({ name: "sandbox_exec", arguments: { sandbox_id: sandboxId, command: "uname -s && nproc" } });
	if (shell.isError || !shell.structuredContent?.run?.stdout.includes("Linux")) throw new Error("sandbox_exec did not reach the sandbox");

	// The destroy button's tool, which also cleans up after this run.
	const gone = await client.callTool({ name: "sandbox_destroy", arguments: { sandbox_id: sandboxId } });
	if (gone.isError) throw new Error(gone.structuredContent?.error ?? "sandbox_destroy failed");
	sandboxId = undefined;

	console.log("✓ copilotkit-mcp-apps: ui resource → run python → 42 → app-only exec → destroy");
} catch (err) {
	console.error("✗ " + (err?.message ?? err));
	process.exitCode = 1;
} finally {
	if (sandboxId) {
		await client.callTool({ name: "sandbox_destroy", arguments: { sandbox_id: sandboxId } }).catch(() => {});
	}
	await client.close().catch(() => {});
	stop();
}
