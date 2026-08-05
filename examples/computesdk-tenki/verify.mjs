/**
 * Proves the ComputeSDK Tenki provider works against live Tenki: create a
 * sandbox through `compute`, run a command (assert 42), round-trip a file
 * through the native filesystem API, then destroy the sandbox.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 * Exits non-zero on any failure.
 */
import { compute } from "computesdk";
import { tenki } from "@computesdk/tenki";
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

const apiKey = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!apiKey) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

compute.setConfig({ provider: tenki({ apiKey, ...(workspaceId ? { workspaceId } : {}) }) });

let sandbox;
try {
	sandbox = await compute.sandbox.create();

	// 1) runCommand → assert stdout
	const r = await sandbox.runCommand("python3 -c 'print(6 * 7)'");
	if (!(r.exitCode === 0 && r.stdout.trim() === "42")) {
		throw new Error(`runCommand: exit ${r.exitCode}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}`);
	}

	// 2) filesystem API → write, assert exists, read back
	const path = "/home/tenki/verify-note.txt";
	const content = "written via the ComputeSDK filesystem API\n";
	await sandbox.filesystem.writeFile(path, content);
	if (!(await sandbox.filesystem.exists(path))) throw new Error("exists() false after writeFile");
	const back = await sandbox.filesystem.readFile(path);
	if (back !== content) throw new Error(`file round-trip mismatch: ${JSON.stringify(back)}`);

	console.log("✓ computesdk-tenki: compute.sandbox.create → runCommand (42) → filesystem round-trip → destroy");
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (sandbox) {
		try {
			await sandbox.destroy();
		} catch {
			/* self-reaps via idle/lifetime caps */
		}
	}
}
