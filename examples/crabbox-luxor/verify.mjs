/**
 * Proves the Luxor Agent Cloud side of this example without the crabbox binary: build the demo's sync
 * manifest the way Crabbox does (`git ls-files --cached --others --exclude-standard`), copy
 * it into a sandbox under Crabbox's workspace layout, check the image has the rsync that
 * Crabbox syncs with, run the tests there, then check that an uncommitted edit changes the
 * result and that the ignored .env never leaves this machine.
 * Token/workspace from env (CI) or ~/.config/luxor/config.yaml (local `luxor login`).
 */
import { LuxorSandbox, stdoutText } from "@luxorai/sandbox";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

const cfg = (key) => {
	try {
		const c = readFileSync(["luxor", "tenki"].map((d) => `${homedir()}/.config/${d}/config.yaml`).find(existsSync) ?? "", "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const authToken = process.env.LUXORAI_AUTH_TOKEN || process.env.LUXORAI_API_KEY || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `luxor login`.");
	process.exit(1);
}

// A fresh Git repo holding the demo, with an ignored .env beside it.
const repo = join(mkdtempSync(join(tmpdir(), "crabbox-verify-")), "crabbox-demo");
cpSync(new URL("demo", import.meta.url), repo, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
git("init", "-q");
git("add", "-A");
git("-c", "user.name=verify", "-c", "user.email=verify@example.com", "commit", "-qm", "demo");
writeFileSync(join(repo, ".env"), "API_TOKEN=stays-on-this-machine\n");
const manifest = () => git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);

// Crabbox's Luxor Agent Cloud workspace is /home/tenki/crabbox/<lease-id>/<repo-name>; relative paths resolve under /home/tenki.
const ROOT = "crabbox/cbx_verify/crabbox-demo";
const luxor = new LuxorSandbox({ authToken });
let sandbox;
try {
	const files = manifest();
	if (files.includes(".env") || !files.includes("src/slug.js")) throw new Error(`unexpected manifest: ${files.join(", ")}`);

	sandbox = await luxor.createAndWait({ cpuCores: 2, memoryMb: 4096, maxDurationMs: 10 * 60_000, workspaceId });
	const sync = async () => {
		for (const f of manifest()) {
			await sandbox.mkdir(dirname(`${ROOT}/${f}`));
			await sandbox.writeFile(`${ROOT}/${f}`, readFileSync(join(repo, f)));
		}
	};
	const test = async () => (await sandbox.exec("npm", { args: ["test"], cwd: ROOT, timeoutMs: 120_000 })).exitCode;

	const rsync = await sandbox.exec("sh", { args: ["-c", "command -v rsync"] });
	if (rsync.exitCode !== 0) throw new Error("rsync is missing from the image, and Crabbox syncs with it");

	await sync();
	const pass = await test();
	if (pass !== 0) throw new Error(`npm test on the clean tree exited ${pass}`);

	// The uncommitted edit run.mjs makes: drop the lowercasing, sync again, expect a failure.
	const file = join(repo, "src/slug.js");
	writeFileSync(file, readFileSync(file, "utf8").replace(".toLowerCase()", ""));
	await sync();
	const broken = await test();
	if (broken === 0) throw new Error("npm test still passed after the uncommitted edit was synced");

	const env = await sandbox.exec("sh", { args: ["-c", `test -e ${ROOT}/.env && echo present || echo absent`] });
	if (stdoutText(env).trim() !== "absent") throw new Error(".env reached the sandbox");

	console.log(`✓ crabbox-luxor: git manifest (${files.length} files, .env left out) → sandbox with rsync → npm test passes → uncommitted edit → npm test fails → dispose`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (sandbox) {
		try {
			await sandbox[Symbol.asyncDispose]();
		} catch {
			/* maxDurationMs bounds it if dispose fails */
		}
	}
}
