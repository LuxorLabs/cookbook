/**
 * Proves the Tenki-facing half of this example without a model key: boot a sandbox with
 * OpenCode baked in and a repo cloned, start the headless server, expose it, and assert the
 * public URL is both password-protected and serving the checkout. (Driving the agent needs
 * a model key; CONTRIBUTING says CI verifies the backend, not the model.)
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

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

const PORT = 4096;
const PASSWORD = randomBytes(24).toString("hex");
const tenki = new TenkiSandbox({ authToken });
let sandbox;
try {
	const cloneRepoUrl = "https://github.com/sindresorhus/yocto-queue";
	sandbox = await tenki.createAndWait({ cpuCores: 2, memoryMb: 4096, enableOpenCode: true, allowInbound: true, cloneRepoUrl, workspaceId });

	// enableOpenCode should have baked the CLI in — no install step anywhere in this script.
	const version = stdoutText(await sandbox.exec("opencode", { args: ["--version"] })).trim();
	if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`opencode --version said ${JSON.stringify(version)}`);

	await sandbox.exec("sh", {
		args: ["-c", `cd repo && setsid opencode serve --port ${PORT} --hostname 0.0.0.0 >/tmp/opencode.log 2>&1 </dev/null & sleep 5`],
		env: { OPENCODE_SERVER_PASSWORD: PASSWORD },
	});

	const { previewUrl } = await sandbox.exposePort(PORT);
	const auth = { Authorization: "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64") };

	let project;
	for (let i = 0; i < 15; i++) {
		try {
			const res = await fetch(`${previewUrl}/project/current`, { redirect: "follow", headers: auth });
			if (res.status === 200) { project = await res.json(); break; }
		} catch { /* gateway warming up */ }
		await new Promise((r) => setTimeout(r, 2000));
	}
	if (project?.worktree !== "/home/tenki/repo" || project?.vcs !== "git") throw new Error(`unexpected project: ${JSON.stringify(project)}`);

	// The URL is public, so an unauthenticated caller must be turned away.
	const open = (await fetch(`${previewUrl}/project/current`, { redirect: "follow" })).status;
	if (open !== 401) throw new Error(`unauthenticated request returned ${open}, expected 401`);

	console.log(`✓ opencode-sandbox: create + clone → opencode ${version} serve → exposePort → 401 unauthed, 200 → ${project.worktree} → dispose`);
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
