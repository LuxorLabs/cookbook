/**
 * Proves the adapter works against live Tenki — no LLM key needed.
 * Boots a Tenki microVM through the adapter, then drives the exact
 * Experimental_SandboxSession surface the AI SDK calls: run (assert stdout),
 * writeTextFile + readTextFile (assert round-trip), a missing file (assert null),
 * and spawn (assert streamed output + exit code). Cleans up the microVM.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 * Exits non-zero on any failure.
 */
import { createTenkiSandbox } from "./tenki-sandbox.mjs";

// The members the AI SDK's Experimental_SandboxSession requires.
const REQUIRED = ["description", "readFile", "readBinaryFile", "readTextFile", "writeFile", "writeBinaryFile", "writeTextFile", "spawn", "run"];

let handle;
try {
	handle = await createTenkiSandbox(); // reads creds; throws if none
	const { sandbox } = handle;

	// 0) structural — the adapter satisfies the AI SDK sandbox shape
	const missing = REQUIRED.filter((k) => sandbox[k] === undefined);
	if (missing.length) throw new Error(`sandbox missing members: ${missing.join(", ")}`);

	// 1) run → assert stdout
	const r = await sandbox.run({ command: "python3 -c 'print(6 * 7)'" });
	if (!(r.exitCode === 0 && r.stdout.trim() === "42")) {
		throw new Error(`run: exit ${r.exitCode}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}`);
	}

	// 2) write + read a file (into a subdir → also proves parent-dir creation) → round-trip
	const path = "work/note.txt";
	const content = "written via the AI SDK adapter\n";
	await sandbox.writeTextFile({ path, content });
	const back = await sandbox.readTextFile({ path });
	if (back !== content) throw new Error(`file round-trip mismatch: ${JSON.stringify(back)}`);

	// 3) missing file → null (AI SDK contract)
	if ((await sandbox.readTextFile({ path: "does-not-exist.txt" })) !== null) {
		throw new Error("expected null reading a missing file");
	}

	// 4) spawn → stream stdout + wait for the exit code
	const proc = await sandbox.spawn({ command: "printf 'hi from spawn'" });
	const streamed = await new Response(proc.stdout).text();
	const { exitCode } = await proc.wait();
	if (!(exitCode === 0 && streamed.includes("hi from spawn"))) {
		throw new Error(`spawn: exit ${exitCode}, stdout ${JSON.stringify(streamed)}`);
	}

	console.log("✓ vercel-ai-sdk: run (42) → file round-trip → missing→null → spawn, on live Tenki");
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (handle) {
		try {
			await handle.dispose();
		} catch {
			/* self-reaps via idle/lifetime caps */
		}
	}
}
