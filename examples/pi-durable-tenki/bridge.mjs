#!/usr/bin/env node
// pi-env starts this script as: node bridge.mjs <sessionId> serve --token <hex>
// It starts the pi-env daemon inside the Tenki sandbox and connects the daemon's
// input and output to this process's, using Tenki's command API instead of SSH.
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
	const piped = Promise.allSettled([
		handle.stdout.pipeTo(Writable.toWeb(process.stdout)),
		handle.stderr.pipeTo(Writable.toWeb(process.stderr)),
	]);
	const { exitCode } = await handle;
	// Drain the final framed stdout frame before exiting, or pi-env sees a half-response.
	await piped;
	process.exit(exitCode ?? 1);
} catch (err) {
	// If the sandbox can't be reached, exit with an error; pi-env tries again on the next request.
	console.error(`bridge: ${err?.message ?? err}`);
	process.exit(1);
}
