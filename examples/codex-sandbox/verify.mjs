/**
 * Proves the Tenki-facing half of this example without a model key: boot a sandbox with
 * the repo cloned, check the image's Codex CLI version and run.mjs's flags, check it still
 * reads CODEX_API_KEY, edit a file in the checkout, assert the diff round-trips. (The agent
 * turn needs a model key; CONTRIBUTING says CI verifies the backend, not the model.)
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
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

	const version = stdoutText(await sandbox.exec("codex", { args: ["--version"] })).trim();
	if (!/^codex-cli \d+\.\d+\.\d+$/.test(version)) throw new Error(`codex --version said ${JSON.stringify(version)}`);

	// The CLI comes with the default image and changes when Tenki rebuilds it,
	// so check run.mjs's flags still exist in it.
	const help = stdoutText(await sandbox.exec("codex", { args: ["exec", "--help"] }));
	const missing = ["--dangerously-bypass-approvals-and-sandbox", "-C, --cd"].filter((f) => !help.includes(f));
	if (missing.length) throw new Error(`codex exec --help no longer lists ${missing.join(", ")}`);

	// run.mjs forwards the model key as CODEX_API_KEY. A dummy key proves codex exec still reads that
	// name: OpenAI rejects a key it was sent ("Incorrect API key"), but reports a missing one differently.
	const probe = await sandbox.exec("codex", {
		args: ["exec", "--dangerously-bypass-approvals-and-sandbox", "say hi"],
		cwd: "repo",
		env: { CODEX_API_KEY: "sk-verify-dummy" },
		timeoutMs: 120_000,
	});
	if (!/Incorrect API key|invalid_api_key/.test(stdoutText(probe) + stderrText(probe))) {
		throw new Error("codex exec never sent CODEX_API_KEY to OpenAI; check which env var it reads now");
	}

	// Stand in for the agent's edit, then read it back the way run.mjs reads the agent's.
	await sandbox.exec("sh", { args: ["-c", "printf '\\nexport const verified = true;\\n' >> repo/index.js"] });
	const diff = await sandbox.git.diff({ directory: "repo" });
	if (!diff.includes("--- a/index.js") || !diff.includes("+export const verified = true;")) {
		throw new Error(`diff did not round-trip: ${JSON.stringify(diff.slice(0, 200))}`);
	}

	console.log(`✓ codex-sandbox: create + clone → ${version} on PATH → reads CODEX_API_KEY → edit → git diff → dispose`);
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
