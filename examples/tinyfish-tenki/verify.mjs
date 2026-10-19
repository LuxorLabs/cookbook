// Proves the TinyFish image runs in a live Tenki sandbox: boot tenki/tinyfish:stable, confirm
// the tinyfish CLI, and import @tiny-fish/sdk + playwright-core. With TINYFISH_API_KEY set,
// also runs tinyfish.mjs in the VM (fetch, search, remote browser over CDP); without it, that
// leg is skipped.
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
const tfKey = process.env.TINYFISH_API_KEY;

const run = async (sandbox, cmd, args) => {
	const r = await sandbox.exec(cmd, { args });
	if (r.exitCode !== 0) throw new Error(`${cmd} ${args[0]}: exit ${r.exitCode}, ${stderrText(r).trim().slice(-400)}`);
	return stdoutText(r).trim();
};

let sandbox;
try {
	const tenki = new TenkiSandbox({ authToken });
	// tenki/tinyfish:stable restores at 2 vCPU / 4096 MiB; a smaller size is rejected.
	sandbox = await tenki.createAndWait({
		image: "tenki/tinyfish:stable",
		cpuCores: 2,
		memoryMb: 4096,
		maxDurationMs: 10 * 60_000,
		workspaceId,
		...(tfKey ? { env: { TINYFISH_API_KEY: tfKey } } : {}),
	});

	await run(sandbox, "tinyfish", ["--version"]);
	const probe = await run(sandbox, "node", [
		"--input-type=module",
		"-e",
		'const { TinyFish } = await import("@tiny-fish/sdk"); const { chromium } = await import("playwright-core");' +
			'const c = new TinyFish({ apiKey: "sk-tinyfish-probe" });' +
			'console.log([typeof c.browser.sessions.create, typeof c.fetch.getContents, typeof c.search.query, typeof c.agent.run, typeof chromium.connectOverCDP].join(","));',
	]);
	if (probe !== "function,function,function,function,function") throw new Error(`import probe: ${probe}`);

	let leg = "TINYFISH_API_KEY unset, live TinyFish leg skipped";
	if (tfKey) {
		await sandbox.writeFile("tinyfish.mjs", readFileSync(new URL("./tinyfish.mjs", import.meta.url)));
		const out = await run(sandbox, "node", ["tinyfish.mjs", "https://example.com"]);
		if (!/^fetch: Example Domain$/m.test(out)) throw new Error(`fetch leg: ${out}`);
		if (!/^search: https?:\/\//m.test(out)) throw new Error(`search leg: ${out}`);
		if (!/^browser: Example Domain$/m.test(out)) throw new Error(`browser leg: ${out}`);
		leg = "fetch + search + remote browser over CDP (Example Domain)";
	}

	console.log(`✓ tinyfish-tenki: boot tenki/tinyfish:stable → tinyfish CLI → import → ${leg} → dispose`);
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
