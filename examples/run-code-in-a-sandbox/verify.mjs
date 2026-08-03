/**
 * Proves this example works: boot a sandbox, exec python3, assert "42", dispose.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 * Exits non-zero on any failure.
 */
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
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id");
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const tenki = new TenkiSandbox({ authToken });
let sandbox;
try {
	sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });
	const r = await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });
	if (!(r.exitCode === 0 && stdoutText(r).trim() === "42")) {
		throw new Error(`unexpected result: exit ${r.exitCode}, stdout ${JSON.stringify(stdoutText(r))}`);
	}
	console.log("✓ run-code-in-a-sandbox: create → exec python3 → 42 → dispose");
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
