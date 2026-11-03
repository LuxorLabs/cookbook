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
	// Pausing from another client leaves this stream open (it hangs until the session
	// ends), so watch the state and drop the connection; pi-env resumes on the next request.
	setInterval(async () => {
		try {
			await session.refresh();
		} catch {
			return;
		}
		if (session.state !== "RUNNING") {
			console.error(`bridge: sandbox ${session.state.toLowerCase()}`);
			process.exit(1);
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
