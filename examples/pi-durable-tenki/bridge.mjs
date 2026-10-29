#!/usr/bin/env node
// Spawned by pi-env's Connection as: node bridge.mjs <sessionId> serve --token <hex>
// Runs the daemon inside the Tenki sandbox and pipes its stdio through — the
// framed protocol rides Tenki's exec data plane, no SSH involved.
import { Readable, Writable } from "node:stream";
import { TenkiSandbox } from "@tenkicloud/sandbox";

const [sessionId, ...daemonArgs] = process.argv.slice(2);
const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY;

try {
	const client = new TenkiSandbox({ authToken });
	const session = await client.get(sessionId);
	const handle = session.run(["/home/tenki/pi-env", ...daemonArgs], {
		stdin: Readable.toWeb(process.stdin),
	});
	// Tenki keeps this exec stream open while another client pauses the sandbox, so
	// watch the state and exit once it leaves RUNNING: pi-env then respawns the
	// bridge, resuming the sandbox, on the next request.
	setInterval(async () => {
		try {
			await session.refresh();
			if (session.state !== "RUNNING") process.exit(1);
		} catch {
			/* a failed poll is not a pause; the next one decides */
		}
	}, 1000).unref();
	const piped = Promise.allSettled([
		handle.stdout.pipeTo(Writable.toWeb(process.stdout)),
		handle.stderr.pipeTo(Writable.toWeb(process.stderr)),
	]);
	const { exitCode } = await handle;
	// Drain the final framed stdout frame before exiting, or pi-env sees a half-response.
	await piped;
	process.exit(exitCode ?? 1);
} catch (err) {
	// An unreachable sandbox becomes a clean spawn failure; pi-env retries on the next request.
	console.error(`bridge: ${err?.message ?? err}`);
	process.exit(1);
}
