/**
 * Proves the Tenki side of the E2B->Tenki migration end to end:
 * create -> run a command -> capture output -> dispose. Exits non-zero on any failure.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
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
	// E2B: await Sandbox.create()  ->  Tenki: createAndWait() boots + waits for ready.
	sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });
	if (!sandbox.id) throw new Error("no sandbox id returned from createAndWait");

	// E2B: sandbox.commands.run("...") runs via a shell. Tenki: exec() runs a bare binary
	// + args, so port a shell command by wrapping it in `sh -c`.
	const shell = await sandbox.exec("sh", { args: ["-c", "echo hello-from-tenki"] });
	// E2B: result.stdout is a string. Tenki: bytes -> decode with stdoutText().
	const out = stdoutText(shell).trim();
	if (shell.exitCode !== 0 || out !== "hello-from-tenki") {
		throw new Error(`shell exec: exit ${shell.exitCode}, stdout ${JSON.stringify(out)}`);
	}

	// A bare binary + args needs no shell (the direct exec form).
	const py = await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });
	if (py.exitCode !== 0 || stdoutText(py).trim() !== "42") {
		throw new Error(`python exec: exit ${py.exitCode}, stdout ${JSON.stringify(stdoutText(py).trim())}`);
	}

	console.log(`✓ e2b-to-tenki-migration: create (${sandbox.id.slice(0, 8)}…) → exec sh + python3 → "${out}" / 42 → dispose`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (sandbox) {
		// E2B: await sandbox.kill()  ->  Tenki: close() terminates the sandbox.
		try {
			await sandbox.close();
		} catch {
			/* self-reaps via idle/lifetime caps */
		}
	}
}
