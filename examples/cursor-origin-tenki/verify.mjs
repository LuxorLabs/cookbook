import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";
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

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const starterApp = read("starter/src/app.mjs");
const prApp = read("pr/app.mjs");
const UNCHECKED = 'if (!user) throw new HttpError(401, "sign in required");\n\t\tconst totalCents';
const fixedApp = prApp.replace(UNCHECKED, "requireMember(user, team);\n\t\tconst totalCents");

const PROBE = `node -e 'import("./src/app.mjs").then(({ handle }) => console.log(handle({ user: "gus", method: "GET", path: "/teams/acme/invoice-totals" }).status))'`;

let sandbox;
try {
	const agents = read("starter/AGENTS.md");
	for (const h of ["## Always flag", "## Focus areas", "## Ignore"]) {
		if (!agents.includes(h)) throw new Error(`AGENTS.md is missing "${h}"`);
	}
	if (!agents.includes("requireMember(user, team)")) throw new Error("AGENTS.md doesn't name the membership rule");
	if (!prApp.includes(UNCHECKED) || fixedApp === prApp) throw new Error("pr/app.mjs no longer has the unchecked route");
	if (prApp.replace(/\t\["GET", \/\^\\\/teams\\\/\(\[\^\/\]\+\)\\\/invoice-totals[\s\S]*?\}\],\n/, "") !== starterApp) {
		throw new Error("pr/app.mjs should differ from starter/src/app.mjs only by the invoice-totals route");
	}

	const tenki = new TenkiSandbox({ authToken });
	sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });
	for (const f of ["package.json", "AGENTS.md", "src/app.mjs", "test/app.test.mjs"]) {
		await sandbox.writeFile(`invoices-api/${f}`, read(`starter/${f}`));
	}
	const sh = (cmd) => sandbox.exec("sh", { args: ["-c", `cd invoices-api && ${cmd}`] });

	const stages = [];
	for (const [name, app, want] of [["main", starterApp, "404"], ["pr", prApp, "200"], ["fixed", fixedApp, "403"]]) {
		await sandbox.writeFile("invoices-api/src/app.mjs", app);
		const tests = await sh("node --test 2>&1");
		if (tests.exitCode !== 0) throw new Error(`${name}: tests failed\n${stdoutText(tests)}`);
		const probe = await sh(PROBE);
		const status = stdoutText(probe).trim();
		if (status !== want) throw new Error(`${name}: non-member read of acme totals returned ${status}, expected ${want}`);
		stages.push(`${name} tests pass, leak probe ${status}`);
	}

	console.log(`✓ cursor-origin-tenki: AGENTS.md rules + planted bug checked → in a Tenki sandbox: ${stages.join(" → ")} → dispose`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (sandbox) {
		try {
			await sandbox[Symbol.asyncDispose]();
		} catch {
			/* self-reaps via idle/lifetime caps */
		}
	}
}
