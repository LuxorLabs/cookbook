/**
 * Proves the golden-image flow: create a builder → install a tool → snapshot → terminate the
 * builder → create a NEW sandbox from the snapshot → the tool is there and runs. Token and
 * workspace from env (CI) or ~/.config/tenki/config.yaml. Exits non-zero on any failure;
 * terminates both sandboxes and deletes the snapshot it created.
 */
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";
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
const marker = `golden-${Date.now()}`;
const size = { cpuCores: 1, memoryMb: 1024, workspaceId };
let builder, restored, snapshot;
const dispose = async (s) => { try { await s?.[Symbol.asyncDispose](); } catch { /* self-reaps */ } };

try {
	// The builder: install a "tool" that prints a marker unique to this run.
	builder = await tenki.createAndWait(size);
	const install = await builder.exec(["sh", "-c", `mkdir -p ~/.local/bin && printf '#!/bin/sh\\necho ${marker}\\n' > ~/.local/bin/hello && chmod +x ~/.local/bin/hello`]);
	if (install.exitCode !== 0) throw new Error(`install failed: ${stderrText(install)}`);

	// Snapshot, then throw the builder away: the image is what we keep.
	snapshot = await tenki.createSnapshotAndWait(builder.id, { name: marker, expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
	if (snapshot.state !== "READY") throw new Error(`snapshot is ${snapshot.state}`);
	await dispose(builder);
	builder = undefined;

	// A new sandbox from the snapshot: new id, tool already installed.
	restored = await tenki.createAndWait({ ...size, snapshotId: snapshot.id });
	if (restored.id === snapshot.sessionId) throw new Error("restore reused the builder's id");
	const r = await restored.exec(["sh", "-lc", "~/.local/bin/hello"]);
	if (r.exitCode !== 0 || stdoutText(r).trim() !== marker) throw new Error(`tool missing after restore: exit ${r.exitCode}, stdout ${JSON.stringify(stdoutText(r))}`);

	console.log(`✓ golden-image: builder → install → snapshot ${snapshot.id.slice(0, 8)} → new sandbox from it → tool runs`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	await dispose(builder);
	await dispose(restored);
	if (snapshot) { try { await tenki.deleteSnapshot(snapshot.id); } catch { /* expires in an hour */ } }
}
