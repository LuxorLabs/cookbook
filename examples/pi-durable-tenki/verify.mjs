/**
 * Proves the integration: boot a Tenki microVM, drive Pi Durable's ExecutionEnv
 * surface through the pi-env daemon, pause the sandbox, recover on the same env.
 * Token from env (CI) or ~/.config/tenki/config.yaml. Exits non-zero on failure.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { createTenkiEnv } from "./tenki-env.mjs";

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

let boot;
try {
	boot = await createTenkiEnv();
	const { session, connection, env } = boot;

	const info = await connection.info();
	assert(info.os === "linux", `daemon hello: unexpected os ${JSON.stringify(info.os)}`);

	let out = "";
	const exec = getOrThrow(await env.exec(["uname", "-s"], { onOutput: (t) => (out += t) }, BACKGROUND_CONTEXT));
	assert(exec.exitCode === 0 && out.trim() === "Linux", `exec: exit ${exec.exitCode}, out ${JSON.stringify(out)}`);

	const marker = `pi-durable-tenki ${Date.now()}`;
	getOrThrow(await env.writeFile("marker.txt", `${marker}\n`, BACKGROUND_CONTEXT));
	const echo = getOrThrow(await env.readTextFile("marker.txt", BACKGROUND_CONTEXT));
	assert(echo.trim() === marker, "file round-trip mismatch");

	await session.pause();
	await session.refresh();
	assert(session.state === "PAUSED", `expected PAUSED, got ${session.state}`);

	// Same env object: this read resumes the sandbox and respawns the daemon.
	const back = getOrThrow(await env.readTextFile("marker.txt", BACKGROUND_CONTEXT));
	assert(back.trim() === marker, "marker lost across pause/resume");
	await session.refresh();
	assert(session.state === "RUNNING", `expected RUNNING after recovery, got ${session.state}`);

	console.log("✓ pi-durable-tenki: boot + daemon → hello → exec → file round-trip → pause → same env resumes, file intact");
} catch (e) {
	console.error(`✗ ${e?.message ?? e}`);
	process.exitCode = 1;
} finally {
	if (boot) {
		await boot.dispose().catch(() => {
			/* sandbox self-reaps via lifetime caps */
		});
	}
}
