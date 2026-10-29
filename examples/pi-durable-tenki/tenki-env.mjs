// Boot a Tenki sandbox and wire Pi Durable's ExecutionEnv surface to it via pi-env.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, RemoteExecutionEnv } from "@earendil-works/pi-env";
import { TenkiSandbox } from "@tenkicloud/sandbox";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Create a sandbox, upload the pi-env daemon, and return a Durable `ExecutionEnv`
 * backed by it. `harnessEnv` plugs into `HarnessOptions.env`; `dispose()` closes
 * the connection and terminates the sandbox.
 */
export async function createTenkiEnv({ cpuCores = 1, memoryMb = 1024, onLog } = {}) {
	const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY;
	const tenki = new TenkiSandbox({ authToken });
	const session = await tenki.createAndWait({ cpuCores, memoryMb, name: "pi-durable-env" });

	try {
		// The pi-env package ships a static linux-x64 daemon that runs on Tenki's stock image.
		const daemon = join(dirname(require.resolve("@earendil-works/pi-env")), "../bin/pi-env-linux-x64/pi-env");
		await session.writeFile("/home/tenki/pi-env", readFileSync(daemon));
		await session.exec(["chmod", "+x", "/home/tenki/pi-env"]);

		// pi-env recomputes `command` on every (re)connect, so a sandbox paused between
		// requests is resumed before the bridge spawns — the next call recovers on its own.
		const connection = new Connection({
			command: async () => {
				await session.refresh();
				if (session.state === "PAUSED") {
					await session.resume();
					await session.waitResumed();
				}
				return ["node", join(here, "bridge.mjs"), session.id];
			},
			onLog,
		});

		// Equal env ids mean the same files, so: one id (and one Connection) per sandbox.
		const env = new RemoteExecutionEnv({
			connection,
			id: `pi-env:tenki:${session.id}`,
			cwd: "/home/tenki",
		});

		return {
			session,
			connection,
			env,
			/** `HarnessOptions.env` for a Durable worker: every tool call runs in the sandbox. */
			harnessEnv: () => env,
			dispose: async () => {
				connection.close();
				await session.closeIfOpen();
			},
		};
	} catch (err) {
		// Setup failed before dispose() exists: free the VM rather than leak it.
		await session.closeIfOpen().catch(() => {});
		throw err;
	}
}

/**
 * Run `fn`, and run it once more if it fails with "pi-env connection lost".
 * Tenki can keep the old daemon's stream open for a while after a pause, so the
 * first request after it may reach the paused daemon and fail when that stream
 * closes. The retry reconnects, which resumes the sandbox. Use it only for
 * requests that are safe to repeat, such as reads.
 */
export async function retryIfLost(fn) {
	try {
		return await fn();
	} catch (err) {
		if (!String(err?.message ?? err).includes("connection lost")) throw err;
		return await fn();
	}
}
