/**
 * Proves the @tenkicloud/openclaw backend's plugin contract (the published
 * OpenClaw manifest: id "tenki", strict configSchema, extension entry, host
 * pin — the dist bundle externalizes `openclaw/plugin-sdk/*`, so it only
 * imports inside an OpenClaw host) and the live Tenki path it drives: tagged
 * find-or-create, `/bin/sh -c` with a `set --` positional-args prefix, stdin
 * staged as a session file, cert-based SSH over the gateway WebSocket stream.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (`tenki login`).
 */
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const require_ = createRequire(import.meta.url);
const pkgPath = require_.resolve("@tenkicloud/openclaw/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const manifest = JSON.parse(readFileSync(join(dirname(pkgPath), "openclaw.plugin.json"), "utf8"));

const TAG = "oc-tenki-cookbook-verify";
let client, session, keyDir;
try {
	// Part 1: the plugin contract OpenClaw loads.
	assert(manifest.id === "tenki", `manifest id is ${JSON.stringify(manifest.id)}`);
	assert(manifest.configSchema?.additionalProperties === false, "configSchema is not strict");
	const keys = "authToken baseUrl workspaceId image workspaceRoot idleTimeoutMinutes cpuCores memoryMb diskSizeGb tags";
	const missing = keys.split(" ").filter((k) => !(k in (manifest.configSchema?.properties ?? {})));
	assert(!missing.length, `configSchema missing keys: ${missing.join(", ")}`);
	assert(pkg.openclaw?.extensions?.length, "package.json openclaw.extensions is empty");
	assert(pkg.openclaw?.install?.minHostVersion, "openclaw.install.minHostVersion missing");
	assert(pkg.dependencies?.["@tenkicloud/sandbox"], "@tenkicloud/sandbox dependency missing");

	// Part 2: the live session lifecycle the backend rides on.
	client = new TenkiSandbox({ authToken });
	session = await client.create({
		name: TAG, tags: ["openclaw", TAG], workspaceId, cpuCores: 1, memoryMb: 1024, allowOutbound: true,
	});
	await session.waitReady();

	// Find-by-tag is how the backend reuses one session per sandbox scope.
	const found = await client.list({ tags: [TAG], workspaceId });
	assert(found.some((s) => s.id === session.id), `list({tags:["${TAG}"]}) did not return the session`);

	// Shell scripts run as `/bin/sh -c`, with a `set --` prefix that sets their arguments $1..$n.
	const r1 = await session.exec("/bin/sh", { args: ["-c", `set -- 'hello world'\necho "arg:$1"`] });
	assert(r1.exitCode === 0 && stdoutText(r1).trim() === "arg:hello world", `positional args: ${JSON.stringify(stdoutText(r1))}`);

	// The SDK's exec call has no input stream, so the plugin writes input to a file and the command reads it from there.
	const stdinFile = `/home/tenki/.openclaw-stdin-${randomUUID()}`;
	await session.writeFile(stdinFile, "stdin staged as a session file\n");
	const r2 = await session.exec("/bin/sh", {
		args: ["-c", `exec 0<"$OPENCLAW_STDIN_FILE" && rm -f -- "$OPENCLAW_STDIN_FILE"\ncat`],
		env: { OPENCLAW_STDIN_FILE: stdinFile },
	});
	assert(r2.exitCode === 0 && stdoutText(r2).trim() === "stdin staged as a session file", `stdin staging: ${JSON.stringify(stdoutText(r2))}`);

	// Interactive PTY = plain ssh, auth'd with an ed25519 key plus a short-lived
	// user cert, over the SDK's gateway WebSocket stream.
	keyDir = mkdtempSync(join(tmpdir(), "oc-tenki-verify-"));
	const keyPath = join(keyDir, "id_ed25519");
	const gen = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath]);
	assert(gen.status === 0, `ssh-keygen failed: ${gen.stderr}`);
	const cert = await client.issueSandboxSSHCert(session.id, readFileSync(`${keyPath}.pub`, "utf8").trim());
	assert(cert.sshCert.startsWith("ssh-ed25519-cert"), `unexpected cert type: ${cert.sshCert.slice(0, 40)}`);
	(await session.ssh()).close();

	console.log("✓ openclaw-tenki: plugin contract → live find-by-tag → sh positional args → stdin staging → SSH cert + gateway → dispose");
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (keyDir) rmSync(keyDir, { recursive: true, force: true });
	if (session) { try { await session.closeIfOpen(); } catch { /* self-reaps via idle timeout */ } }
	client?.close();
}
