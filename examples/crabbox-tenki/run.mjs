// Crabbox on Tenki, end to end: copy demo/ into a fresh Git repo, lease a sandbox with
// `crabbox warmup`, run the tests there, break them with an uncommitted edit, run them
// again, and stop the sandbox. Needs `crabbox` and a signed-in `tenki` CLI on PATH.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SLUG = "cookbook-demo";

if (spawnSync("crabbox", ["--version"]).status !== 0) {
	console.error("crabbox not found. Install it with `brew install openclaw/tap/crabbox`.");
	process.exit(1);
}

// Crabbox decides what to sync by asking Git, so the demo has to be its own repository.
const repo = join(mkdtempSync(join(tmpdir(), "crabbox-")), "crabbox-demo");
cpSync(new URL("demo", import.meta.url), repo, { recursive: true });
const sh = (cmd, args) => spawnSync(cmd, args, { cwd: repo, stdio: "inherit" }).status;
const git = (...args) => {
	if (sh("git", args) !== 0) throw new Error(`git ${args.join(" ")} failed`);
};
const crabbox = (...args) => sh("crabbox", args);

git("init", "-q");
git("add", "-A");
git("-c", "user.name=crabbox-demo", "-c", "user.email=crabbox-demo@example.com", "commit", "-qm", "demo");
// Git ignores .env, so it stays on this machine.
writeFileSync(join(repo, ".env"), "API_TOKEN=stays-on-this-machine\n");

let pass, broken, envOnBox;
try {
	// .crabbox.yaml sets warmup.keep: false, so the box gets lease.ttl (1h) as its max duration.
	if (crabbox("warmup", "--slug", SLUG) !== 0) throw new Error("crabbox warmup failed");
	pass = crabbox("run", "--id", SLUG, "--", "npm", "test");

	// An edit you haven't committed: drop the lowercasing. Crabbox syncs it anyway.
	const file = join(repo, "src/slug.js");
	writeFileSync(file, readFileSync(file, "utf8").replace(".toLowerCase()", ""));
	broken = crabbox("run", "--id", SLUG, "--", "npm", "test");

	envOnBox = crabbox("run", "--id", SLUG, "--shell", "test -e .env") === 0;
} finally {
	crabbox("stop", SLUG);
}

console.log(`\nclean tree: exit ${pass} · uncommitted edit: exit ${broken} · .env on the box: ${envOnBox ? "yes" : "no"}`);
if (pass !== 0 || broken === 0 || envOnBox) process.exitCode = 1;
