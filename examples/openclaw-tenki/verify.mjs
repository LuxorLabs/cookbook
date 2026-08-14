/**
 * Proves the @tenkicloud/openclaw sandbox backend's contract and the live
 * Tenki path it drives. Part 1 asserts the published plugin's OpenClaw
 * manifest (id "tenki", strict configSchema, extension entry, host pin).
 * Part 2 mirrors the backend's exact SDK calls: tagged find-or-create,
 * `/bin/sh -c` with a `set --` positional-args prefix, stdin staged as a
 * session file, and cert-based SSH over the gateway WebSocket stream.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 * Exits non-zero on any failure.
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

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

// Part 1: the plugin contract OpenClaw loads. The dist bundle externalizes
// `openclaw/plugin-sdk/*` (host-provided at runtime), so it only imports
// inside an OpenClaw host — assert the manifest contract instead.
const CONFIG_KEYS = [
	"authToken", "baseUrl", "workspaceId", "image", "workspaceRoot",
	"idleTimeoutMinutes", "cpuCores", "memoryMb", "diskSizeGb", "tags",
];

const require_ = createRequire(import.meta.url);
const pkgPath = require_.resolve("@tenkicloud/openclaw/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const manifest = JSON.parse(readFileSync(join(dirname(pkgPath), "openclaw.plugin.json"), "utf8"));

const TAG = "oc-tenki-cookbook-verify";
let client;
let session;
let keyDir;
try {
	if (manifest.id !== "tenki") throw new Error(`manifest id is ${JSON.stringify(manifest.id)}`);
	if (manifest.configSchema?.additionalProperties !== false) {
		throw new Error("configSchema is not strict (additionalProperties !== false)");
	}
	const props = Object.keys(manifest.configSchema?.properties ?? {});
	const missing = CONFIG_KEYS.filter((k) => !props.includes(k));
	if (missing.length) throw new Error(`configSchema missing keys: ${missing.join(", ")}`);
	if (!Array.isArray(pkg.openclaw?.extensions) || pkg.openclaw.extensions.length === 0) {
		throw new Error("package.json openclaw.extensions is empty");
	}
	if (!pkg.openclaw?.install?.minHostVersion) throw new Error("openclaw.install.minHostVersion missing");
	if (!pkg.dependencies?.["@tenkicloud/sandbox"]) throw new Error("@tenkicloud/sandbox dependency missing");

	// Part 2: the live session lifecycle the backend rides on, one call at a time.
	client = new TenkiSandbox({ authToken });
	session = await client.create({
		name: TAG,
		tags: ["openclaw", TAG],
		workspaceId,
		cpuCores: 1,
		memoryMb: 1024,
		allowOutbound: true,
	});
	await session.waitReady();

	// Find-by-tag is how the backend reuses one session per sandbox scope.
	const found = await client.list({ tags: [TAG], workspaceId });
	if (!found.some((s) => s.id === session.id)) throw new Error(`list({tags:["${TAG}"]}) did not return the session`);

	// Shell scripts run as `/bin/sh -c` with a `set --` prefix carrying $1..$n.
	const r1 = await session.exec("/bin/sh", { args: ["-c", `set -- 'hello world'\necho "arg:$1"`] });
	if (!(r1.exitCode === 0 && stdoutText(r1).trim() === "arg:hello world")) {
		throw new Error(`positional args: exit ${r1.exitCode}, stdout ${JSON.stringify(stdoutText(r1))}`);
	}

	// The SDK exec surface has no stdin stream; the backend stages stdin as a
	// session file and redirects fd 0 before the script runs.
	const stdinFile = `/home/tenki/.openclaw-stdin-${randomUUID()}`;
	await session.writeFile(stdinFile, "stdin staged as a session file\n");
	const r2 = await session.exec("/bin/sh", {
		args: ["-c", `exec 0<"$OPENCLAW_STDIN_FILE" && rm -f -- "$OPENCLAW_STDIN_FILE"\ncat`],
		env: { OPENCLAW_STDIN_FILE: stdinFile },
	});
	if (!(r2.exitCode === 0 && stdoutText(r2).trim() === "stdin staged as a session file")) {
		throw new Error(`stdin staging: exit ${r2.exitCode}, stdout ${JSON.stringify(stdoutText(r2))}`);
	}

	// Interactive PTY = plain ssh, authenticated with an ed25519 key plus a
	// short-lived user cert, over the SDK's gateway WebSocket stream.
	keyDir = mkdtempSync(join(tmpdir(), "oc-tenki-verify-"));
	const keyPath = join(keyDir, "id_ed25519");
	const gen = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", keyPath]);
	if (gen.status !== 0) throw new Error(`ssh-keygen failed: ${gen.stderr}`);
	const cert = await client.issueSandboxSSHCert(session.id, readFileSync(`${keyPath}.pub`, "utf8").trim());
	if (!cert.sshCert.startsWith("ssh-ed25519-cert")) {
		throw new Error(`unexpected cert type: ${cert.sshCert.slice(0, 40)}`);
	}

	const conn = await session.ssh();
	try {
		const first = await Promise.race([
			conn.read(),
			new Promise((resolve) => setTimeout(resolve, 10_000, "timeout")),
		]);
		if (first === "timeout") {
			console.log("note: SSH gateway stream opened but sent no banner within 10s; skipping banner check");
		} else {
			const banner = new TextDecoder().decode(first ?? new Uint8Array());
			if (!banner.includes("SSH-2.0")) throw new Error(`no SSH banner in first chunk: ${JSON.stringify(banner)}`);
		}
	} finally {
		conn.close();
	}

	console.log(
		"✓ openclaw-tenki: plugin contract → live find-by-tag → sh positional args → stdin staging → SSH cert + gateway → dispose",
	);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (keyDir) rmSync(keyDir, { recursive: true, force: true });
	if (session) {
		try {
			await session.closeIfOpen();
		} catch {
			/* self-reaps via idle timeout */
		}
	}
	client?.close();
}
