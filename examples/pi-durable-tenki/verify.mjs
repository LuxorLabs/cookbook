/**
 * Proves the integration: boot a Tenki sandbox, drive Pi Durable's ExecutionEnv
 * surface through the pi-env daemon, pause the sandbox, recover on the same env.
 * Token from env (CI) or ~/.config/tenki/config.yaml. Exits non-zero on failure.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { createTenkiEnv, retryIfLost } from "./tenki-env.mjs";

if (!process.env.TENKI_AUTH_TOKEN && !process.env.TENKI_API_KEY) {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		process.env.TENKI_API_KEY = (c.match(/^auth_token:\s*(.+)$/m)?.[1] ?? "").trim();
	} catch {
		/* fall through to the check below */
	}
	if (!process.env.TENKI_API_KEY) {
		console.error("No token. Set TENKI_API_KEY, or run `tenki login`.");
		process.exit(1);
	}
}

const assert = (cond, msg) => {
	if (!cond) throw new Error(msg);
};

// pause()/resume() return as the transition starts; poll until it settles.
const waitState = async (session, want) => {
	for (let i = 0; i < 40; i++) {
		await session.refresh();
		if (session.state === want) return;
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`expected ${want}, got ${session.state}`);
};

// The daemon's and bridge's stderr: printed only if a step fails.
let log = "";
let step = "boot";
let boot;
try {
	boot = await createTenkiEnv({ onLog: (t) => (log += t) });
	const { session, connection, env } = boot;

	step = "daemon hello";
	const info = await connection.info();
	assert(info.os === "linux", `daemon hello: unexpected os ${JSON.stringify(info.os)}`);

	step = "exec";
	let out = "";
	const exec = getOrThrow(await env.exec(["uname", "-s"], { onOutput: (t) => (out += t) }, BACKGROUND_CONTEXT));
	assert(exec.exitCode === 0 && out.trim() === "Linux", `exec: exit ${exec.exitCode}, out ${JSON.stringify(out)}`);

	step = "file round-trip";
	const marker = `pi-durable-tenki ${Date.now()}`;
	getOrThrow(await env.writeFile("marker.txt", `${marker}\n`, BACKGROUND_CONTEXT));
	const echo = getOrThrow(await env.readTextFile("marker.txt", BACKGROUND_CONTEXT));
	assert(echo.trim() === marker, "file round-trip mismatch");

	step = "pause";
	await session.pause();
	await waitState(session, "PAUSED");

	step = "read after pause";
	// Same env object: this read resumes the sandbox and respawns the daemon.
	const back = await retryIfLost(async () => getOrThrow(await env.readTextFile("marker.txt", BACKGROUND_CONTEXT)));
	assert(back.trim() === marker, "marker lost across pause/resume");
	await waitState(session, "RUNNING");

	console.log("✓ pi-durable-tenki: boot + daemon → hello → exec → file round-trip → pause → same env resumes, file intact");
} catch (e) {
	console.error(`✗ ${step}: ${e?.message ?? e}`);
	if (log.trim()) console.error(log.trimEnd());
	process.exitCode = 1;
} finally {
	if (boot) {
		await boot.dispose().catch(() => {
			/* sandbox self-reaps via lifetime caps */
		});
	}
}
