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
	handle.stdout.pipeTo(Writable.toWeb(process.stdout)).catch(() => {});
	handle.stderr.pipeTo(Writable.toWeb(process.stderr)).catch(() => {});
	process.exit((await handle).exitCode ?? 1);
} catch (err) {
	// An unreachable sandbox becomes a clean spawn failure; pi-env retries on the next request.
	console.error(`bridge: ${err?.message ?? err}`);
	process.exit(1);
}
