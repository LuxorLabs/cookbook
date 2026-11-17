// Proves the Luxor Agent Cloud side of the Trigger.dev tasks without a Trigger.dev account or model key:
// typechecks src/trigger/*.ts against @trigger.dev/sdk, then drives src/luxor.mjs live:
// the task's create → run → close, the chat agent's executeCode tool on a run-scoped sandbox,
// and pause → resume by id. Exits non-zero on failure; closes every sandbox it created.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const cfg = (key) => {
	try {
		const c = readFileSync(["luxor", "tenki"].map((d) => `${homedir()}/.config/${d}/config.yaml`).find(existsSync) ?? "", "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const authToken = process.env.LUXORAI_AUTH_TOKEN || process.env.LUXORAI_API_KEY || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
if (!authToken) {
	console.error("No token. Set LUXORAI_AUTH_TOKEN, or run `luxor login`.");
	process.exit(1);
}
(process.env.LUXORAI_AUTH_TOKEN || process.env.TENKI_AUTH_TOKEN) = authToken; // src/luxor.mjs lets the SDK read it from the environment

const { createSandbox, runCommand, pauseSandbox, resumeSandbox, executeCode, warmSandbox, sandboxFor, disposeSandbox } =
	await import("./src/luxor.mjs");

const runId = `run_verify_${Math.random().toString(36).slice(2, 8)}`;
const opened = [];
try {
	const cwd = fileURLToPath(new URL(".", import.meta.url));
	const tsc = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"], { cwd, encoding: "utf8" });
	if (tsc.status !== 0) throw new Error(`tsc --noEmit failed:\n${tsc.stdout}${tsc.stderr}`);

	// run-in-sandbox task body
	const s1 = await createSandbox({ maxDurationMs: 5 * 60_000 });
	opened.push(s1);
	const r1 = await runCommand(s1, "python3 -c 'print(6 * 7)'");
	if (r1.exitCode !== 0 || r1.stdout.trim() !== "42") throw new Error(`task: ${JSON.stringify(r1)}`);
	await s1.close();

	// code-agent: warm in onTurnStart, two tool calls share the sandbox, dispose in onChatSuspend
	warmSandbox(runId);
	await executeCode(runId, "open('data.txt', 'w').write('3 4 5')");
	const r2 = await executeCode(runId, "print(sum(map(int, open('data.txt').read().split())))");
	if (r2.exitCode !== 0 || r2.stdout.trim() !== "12") throw new Error(`executeCode: ${JSON.stringify(r2)}`);
	const chatBox = await sandboxFor(runId);
	await disposeSandbox(runId);
	await chatBox.refresh();
	if (!/^TERMINAT/.test(chatBox.state)) throw new Error(`dispose left the sandbox ${chatBox.state}`);

	// pause-during-wait: state in /home/tenki survives pause → resume by id
	const s3 = await createSandbox({ maxDurationMs: 5 * 60_000 });
	opened.push(s3);
	await runCommand(s3, `echo ${runId} > /home/tenki/marker`);
	const resumed = await resumeSandbox(await pauseSandbox(s3));
	opened.push(resumed);
	const r3 = await runCommand(resumed, "cat /home/tenki/marker");
	if (r3.stdout.trim() !== runId) throw new Error(`marker lost after resume: ${JSON.stringify(r3)}`);

	console.log("✓ trigger-dev-luxor: tsc → task exec (42) → executeCode ×2 on one run sandbox (12) → dispose → pause → resume (marker kept)");
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	await disposeSandbox(runId).catch(() => {});
	for (const s of opened) await s.close().catch(() => {}); // already-closed sandboxes just reject
}
