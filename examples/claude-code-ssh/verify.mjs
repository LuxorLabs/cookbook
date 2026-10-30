/**
 * Proves the Tenki side of tenki-claude without a model key: run the launcher in --shell mode
 * with a dummy Anthropic key, drive the remote shell over the real SSH path, and check that
 * the sandbox opens with the repo cloned, claude is on PATH, the key arrives in the
 * environment but not on disk, claude reads it (Anthropic rejects the dummy key), and the
 * sandbox is gone when the session ends. The agent turn itself needs a model key.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
import { TenkiSandbox, isTerminal } from "@tenkicloud/sandbox";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const dummyKey = `sk-ant-verify-${randomBytes(12).toString("hex")}`;
// The terminal echoes each typed command, so a result is the R<n>: line that has no shell
// syntax left in it.
const script = [
	`echo "R1:user=$(whoami)"`,
	`echo "R2:cwd=$PWD"`,
	`echo "R3:env=\${TENKI_CLAUDE_API_KEY:+key-present} lc=\${LC_ANTHROPIC_API_KEY:-gone} plain=\${ANTHROPIC_API_KEY:-gone}"`,
	`echo "R4:claude=$(claude --version)"`,
	`echo "R5:keys-on-disk=$(grep -rlF ${dummyKey} "$HOME/.claude" "$HOME/.claude.json" "$HOME/.bash_history" 2>/dev/null | wc -l | tr -d ' ')"`,
	`echo "R6:helper=$(grep -c apiKeyHelper "$HOME/.claude/settings.json")"`,
	`echo "R7:probe=$(CLAUDE_CODE_MAX_RETRIES=0 timeout 60 claude -p hi 2>&1 | head -c 300 | tr '\\n' ' ')"`,
	"exit",
	"",
].join("\n");

const tenki = new TenkiSandbox({ authToken });
let sandboxId;
try {
	const run = spawn("node", ["tenki-claude.mjs", "--shell", "--repo", "https://github.com/sindresorhus/yocto-queue"], {
		env: { ...process.env, TENKI_AUTH_TOKEN: authToken, ANTHROPIC_API_KEY: dummyKey },
		stdio: ["pipe", "pipe", "pipe"],
	});
	let out = "";
	let err = "";
	run.stdout.on("data", (d) => (out += d));
	run.stderr.on("data", (d) => {
		err += d;
		sandboxId ??= err.match(/Sandbox ([0-9a-f-]{36}) is up/)?.[1];
	});
	run.stdin.write(script);
	const timer = setTimeout(() => run.kill("SIGTERM"), 6 * 60_000);
	const code = await new Promise((resolve) => run.on("exit", resolve));
	clearTimeout(timer);
	if (process.env.VERIFY_DEBUG) console.log(out);
	if (code !== 0) throw new Error(`tenki-claude exited ${code}\n${err.trim()}\n${out.slice(-600)}`);

	const field = (n) =>
		[...out.matchAll(new RegExp(`R${n}:[^\\r\\n]*`, "g"))].map((m) => m[0]).find((l) => !/\$[({A-Za-z]/.test(l)) ?? `R${n} missing`;
	const expect = (n, pattern) => {
		if (!pattern.test(field(n))) throw new Error(`${field(n)} (wanted ${pattern})`);
	};
	expect(1, /user=tenki$/);
	expect(2, /cwd=\/home\/tenki\/repo$/);
	expect(3, /env=key-present lc=gone plain=gone$/);
	expect(4, /claude=\d+\.\d+\.\d+ \(Claude Code\)$/);
	expect(5, /keys-on-disk=0$/);
	expect(6, /helper=1$/);
	// Anthropic only answers "invalid x-api-key" for a key it was sent, so this proves claude read ours.
	expect(7, /probe=Invalid API key/i);
	if (!/Terminated /.test(err)) throw new Error(`launcher did not report cleanup:\n${err.trim()}`);

	for (let i = 0; ; i++) {
		const gone = await tenki.get(sandboxId).then((s) => isTerminal(s.state), () => true);
		if (gone) break;
		if (i > 30) throw new Error(`${sandboxId} still running after the launcher exited`);
		await sleep(2000);
	}
	console.log(`✓ claude-code-ssh: create + clone → ssh as tenki in ~/repo → claude ${field(4).split("=")[1].split(" ")[0]} reads the forwarded key (not on disk) → exit → sandbox terminated`);
} catch (e) {
	console.error("✗ " + (e?.message || e));
	process.exitCode = 1;
} finally {
	if (sandboxId) {
		try { await (await tenki.get(sandboxId)).close(); } catch { /* already terminated */ }
	}
	tenki.close();
}
