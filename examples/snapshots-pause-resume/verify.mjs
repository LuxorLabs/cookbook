/**
 * Proves pause/resume persists sandbox state: create → write a unique marker →
 * pause → resume → read the marker back → assert it survived. Also asserts pause
 * produced a durable snapshot. Token/workspace from env (CI) or ~/.config/tenki/config.yaml.
 * Exits non-zero on any failure; terminates the sandbox it created.
 */
import { TenkiSandbox } from "@tenkicloud/sandbox";
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
const marker = `persist-${Date.now()}`;
let sandbox;
// pause()/resume() resolve as the transition begins; poll refresh() until it settles.
const waitState = async (want) => {
	for (let i = 0; i < 40; i++) {
		await sandbox.refresh();
		if (sandbox.state === want) return;
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`expected ${want}, got ${sandbox.state}`);
};

try {
	sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });
	await sandbox.writeFile("marker.txt", marker);

	// pause() snapshots memory + disk, then frees the VM. Capture the id now — it clears on resume.
	await sandbox.pause();
	await waitState("PAUSED");
	const snap = sandbox.pauseSnapshotId;
	if (!snap) throw new Error("pause did not produce a durable snapshot");

	// resume() boots the same sandbox back from its pause snapshot.
	await sandbox.resume();
	await waitState("RUNNING");

	const back = new TextDecoder().decode(await sandbox.readFile("marker.txt"));
	if (back !== marker) throw new Error(`marker lost: wrote ${JSON.stringify(marker)}, read ${JSON.stringify(back)}`);

	console.log(`✓ snapshots-pause-resume: create → write → pause (snapshot ${snap.slice(0, 8)}) → resume → marker survived`);
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
