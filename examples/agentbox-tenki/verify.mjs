/**
 * Proves the AgentBox ↔ Tenki integration without the agentbox CLI: the
 * published plugin exposes the SDK v2 provider surface `agentbox plugin add`
 * records, and the live Tenki path every box rides on is healthy —
 * create → exec → file round-trip → dispose.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 * Exits non-zero on any failure.
 */
import * as plugin from "@tenkicloud/agentbox-provider";
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

// The provider-contract members AgentBox calls on a registered plugin.
const REQUIRED = ["create", "start", "reconnect", "pause", "resume", "stop", "destroy", "exec", "buildAttach"];

let sandbox;
try {
	// 1) structural — the provider contract
	if (plugin.PROVIDER_NAME !== "tenki") throw new Error(`PROVIDER_NAME is ${JSON.stringify(plugin.PROVIDER_NAME)}`);
	if (plugin.SDK_API_VERSION !== 2) throw new Error(`SDK_API_VERSION is ${plugin.SDK_API_VERSION}, AgentBox expects 2`);
	const missing = REQUIRED.filter((k) => typeof plugin.tenkiProvider?.[k] !== "function");
	if (typeof plugin.tenkiProvider?.checkpoint?.create !== "function") missing.push("checkpoint.create");
	if (missing.length) throw new Error(`tenkiProvider missing members: ${missing.join(", ")}`);

	// 2) live — the microVM surface a box boots on
	const tenki = new TenkiSandbox({ authToken });
	sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });

	const r = await sandbox.exec("sh", { args: ["-c", 'echo "box $(python3 -c \'print(6*7)\')"'] });
	if (!(r.exitCode === 0 && stdoutText(r).trim() === "box 42")) {
		throw new Error(`exec: exit ${r.exitCode}, stdout ${JSON.stringify(stdoutText(r))}`);
	}

	await sandbox.writeFile("workspace-note.txt", "agentbox workspace file\n");
	const back = new TextDecoder().decode(await sandbox.readFile("workspace-note.txt"));
	if (back !== "agentbox workspace file\n") throw new Error(`file round-trip mismatch: ${JSON.stringify(back)}`);

	console.log("✓ agentbox-tenki: plugin exposes the SDK v2 tenki provider → live boot → exec (box 42) → file round-trip → dispose");
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
