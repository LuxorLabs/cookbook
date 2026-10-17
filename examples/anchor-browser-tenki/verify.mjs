// Proves the Tenki side without an Anchor key: boot tenki/anchor:stable, find anchor-smoke on PATH,
// import the image's playwright-core from /home/tenki, and confirm the session env has no Anchor key.
// With ANCHOR_API_KEY set, also runs anchor.mjs (key in that process only) and checks no other process sees it.
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const authToken = process.env.TENKI_API_KEY || process.env.TENKI_AUTH_TOKEN || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_API_KEY, or run `tenki login`.");
	process.exit(1);
}
const anchorKey = process.env.ANCHOR_API_KEY;

const run = async (sandbox, cmd, args, env) => {
	const r = await sandbox.exec(cmd, { args, env, timeoutMs: 3 * 60_000 });
	if (r.status !== "SUCCEEDED") throw new Error(`${cmd} ${args[0]}: ${r.status} exit ${r.exitCode}, ${stderrText(r).trim().slice(-400)}`);
	return stdoutText(r).trim();
};

let sandbox;
try {
	const tenki = new TenkiSandbox({ authToken });
	sandbox = await tenki.createAndWait({ image: "tenki/anchor:stable", cpuCores: 2, memoryMb: 2048, maxDurationMs: 10 * 60_000, workspaceId });

	await run(sandbox, "sh", ["-c", "command -v anchor-smoke"]);
	await sandbox.writeFile("probe.mjs", 'import { chromium } from "playwright-core"; console.log(typeof chromium.connectOverCDP);');
	if ((await run(sandbox, "node", ["probe.mjs"])) !== "function") throw new Error("playwright-core import probe failed");
	const pw = JSON.parse(await run(sandbox, "cat", ["/home/tenki/node_modules/playwright-core/package.json"])).version;
	const sessionEnv = await run(sandbox, "sh", ["-c", 'printf %s "${ANCHOR_API_KEY:-}"']);
	if (sessionEnv) throw new Error("ANCHOR_API_KEY is set in the session environment");

	let leg = "ANCHOR_API_KEY unset, live Anchor leg skipped";
	if (anchorKey) {
		await sandbox.writeFile("anchor.mjs", readFileSync(new URL("./anchor.mjs", import.meta.url)));
		const out = JSON.parse(await run(sandbox, "node", ["anchor.mjs", "https://example.com"], { ANCHOR_API_KEY: anchorKey }));
		if (out.title !== "Example Domain") throw new Error(`Anchor leg: ${JSON.stringify(out)}`);
		if (await run(sandbox, "sh", ["-c", 'printf %s "${ANCHOR_API_KEY:-}"'])) throw new Error("key leaked into a later process");
		leg = "Anchor session over CDP (Example Domain), key scoped to one process";
	}

	console.log(`✓ anchor-browser-tenki: boot tenki/anchor:stable → anchor-smoke on PATH → playwright-core ${pw} → no key in session env → ${leg} → dispose`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (sandbox) {
		try {
			await sandbox[Symbol.asyncDispose]();
		} catch {
			/* maxDurationMs ends it within 10 minutes */
		}
	}
}
