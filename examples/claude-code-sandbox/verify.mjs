/**
 * Proves the Tenki-facing half of this example without a model key: boot a sandbox with
 * the repo cloned, check the image's Claude Code CLI version and run.mjs's flags,
 * edit a file in the checkout, assert the diff round-trips. (The agent turn needs a
 * model key; CONTRIBUTING says CI verifies the backend, not the model.)
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
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
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id");
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const tenki = new TenkiSandbox({ authToken });
let sandbox;
try {
	const cloneRepoUrl = "https://github.com/sindresorhus/yocto-queue";
	sandbox = await tenki.createAndWait({ cpuCores: 2, memoryMb: 4096, cloneRepoUrl, workspaceId });

	const pkg = JSON.parse(stdoutText(await sandbox.exec("cat", { args: ["repo/package.json"] })));
	if (pkg.name !== "yocto-queue") throw new Error(`clone landed wrong: repo/package.json is ${pkg.name}`);

	const version = stdoutText(await sandbox.exec("claude", { args: ["--version"] })).trim();
	if (!/^\d+\.\d+\.\d+ \(Claude Code\)$/.test(version)) throw new Error(`claude --version said ${JSON.stringify(version)}`);

	// The CLI comes with the default image and changes when Tenki rebuilds it,
	// so check run.mjs's flags still exist in it.
	const help = stdoutText(await sandbox.exec("claude", { args: ["--help"] }));
	const missing = ["-p, --print", "--dangerously-skip-permissions"].filter((f) => !help.includes(f));
	if (missing.length) throw new Error(`claude --help no longer lists ${missing.join(", ")}`);

	// Stand in for the agent's edit, then read it back the way run.mjs reads the agent's.
	await sandbox.exec("sh", { args: ["-c", "printf '\\nexport const verified = true;\\n' >> repo/index.js"] });
	const diff = await sandbox.git.diff({ directory: "repo" });
	if (!diff.includes("--- a/index.js") || !diff.includes("+export const verified = true;")) {
		throw new Error(`diff did not round-trip: ${JSON.stringify(diff.slice(0, 200))}`);
	}

	console.log(`✓ claude-code-sandbox: create + clone → ${version} on PATH → edit → git diff → dispose`);
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
