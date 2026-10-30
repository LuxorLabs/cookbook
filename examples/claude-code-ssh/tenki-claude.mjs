#!/usr/bin/env node
// One command: boot a Tenki sandbox, SSH into it, run Claude Code, clean up when you exit.
//
//   tenki-claude [--repo URL] [--keep] [--shell] [--hours N] [-- claude args...]
//   tenki-claude attach <sandbox-id>     reconnect to a kept sandbox
//   tenki-claude rm <sandbox-id>         terminate a kept sandbox
import { TenkiSandbox, isReady } from "@tenkicloud/sandbox";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

// Forwarded to `claude` in the sandbox if set here. They travel as LC_* variables, the only
// custom names Tenki's sshd accepts, and are exported by the remote command: nothing is
// written to disk and nothing shows up in a process list.
const FORWARD = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"];

const USAGE = `usage: tenki-claude [--repo URL] [--keep] [--shell] [--hours N] [-- claude args...]
       tenki-claude attach <sandbox-id>
       tenki-claude rm <sandbox-id>`;

const proxy = new URL("./ssh-proxy.mjs", import.meta.url).pathname;
const quote = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

const configValue = (key) => {
	try {
		return (readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8").match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const fail = (msg) => {
	console.error(msg);
	process.exit(1);
};

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		repo: { type: "string" },
		keep: { type: "boolean", default: false },
		shell: { type: "boolean", default: false },
		hours: { type: "string", default: "2" },
		help: { type: "boolean", short: "h", default: false },
	},
});
if (opts.help) fail(USAGE);

const [command, target] = positionals[0] === "attach" || positionals[0] === "rm" ? positionals : [];
const claudeArgs = command ? [] : positionals;
if (command && !target) fail(USAGE);

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || configValue("auth_token");
if (!authToken) fail("No Tenki key. Set TENKI_AUTH_TOKEN (or TENKI_API_KEY), or run `tenki login`.");
const tenki = new TenkiSandbox({ authToken, workspaceId: process.env.TENKI_WORKSPACE_ID || undefined });

if (command === "rm") {
	await (await tenki.get(target)).close();
	console.log(`terminated ${target}`);
	process.exit(0);
}

try {
	execFileSync("ssh", ["-V"], { stdio: "ignore" });
} catch {
	fail("ssh not found; this tool needs an OpenSSH client.");
}

// A throwaway keypair: its public half is installed in the sandbox, and the whole directory
// is deleted when this process exits.
const keyDir = mkdtempSync(join(tmpdir(), "tenki-claude-"));
execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "tenki-claude", "-f", `${keyDir}/id`]);
const publicKey = readFileSync(`${keyDir}/id.pub`, "utf8").trim();

let sandbox;
let child;
let cleanupDone;

// Shared by the normal exit path and the signal handlers, so a second caller waits for the first.
const cleanup = () => (cleanupDone ??= runCleanup());

const runCleanup = async () => {
	rmSync(keyDir, { recursive: true, force: true });
	if (!sandbox) return;
	try {
		if (command === "attach" || opts.keep) {
			await sandbox.pause();
			console.error(`\nPaused ${sandbox.id}. Reconnect with: tenki-claude attach ${sandbox.id}   Delete with: tenki-claude rm ${sandbox.id}`);
		} else {
			await sandbox.close();
			console.error(`\nTerminated ${sandbox.id}.`);
		}
	} catch (err) {
		console.error(`\nCould not clean up ${sandbox.id}: ${err.message}\nDelete it with: tenki-claude rm ${sandbox.id}`);
	}
};

for (const sig of ["SIGTERM", "SIGHUP"]) {
	process.on(sig, async () => {
		child?.kill();
		await cleanup();
		process.exit(1);
	});
}

try {
	if (command === "attach") {
		sandbox = await tenki.get(target);
		if (!isReady(sandbox.state)) {
			console.error(`Resuming ${sandbox.id}...`);
			await sandbox.resume();
			const deadline = Date.now() + 120_000;
			while (!isReady(sandbox.state)) {
				if (Date.now() > deadline) throw new Error(`resume timed out: state is still ${sandbox.state}`);
				await sleep(1000);
				await sandbox.refresh();
			}
		}
	} else {
		console.error("Creating a sandbox...");
		try {
			sandbox = await tenki.createAndWait({
				name: `claude-${keyDir.slice(-6).toLowerCase()}`,
				tags: ["tenki-claude"],
				cpuCores: 2,
				memoryMb: 4096,
				cloneRepoUrl: opts.repo,
				sshAuthorizedKeys: [publicKey],
				// At the cap a sandbox pauses rather than terminates, so set the retention too.
				// These only matter if this process dies before it can clean up.
				maxDurationMs: Number(opts.hours) * 3_600_000,
				pauseRetentionMs: 24 * 3_600_000,
			});
		} catch (err) {
			// A sandbox that was admitted but never became ready still has to be terminated.
			sandbox = err.session;
			throw err;
		}
		console.error(`Sandbox ${sandbox.id} is up.`);
	}

	if (command === "attach") await sandbox.exec(["sh", "-c", `printf '%s\\n' ${quote(publicKey)} >> ~/.ssh/authorized_keys`]);
	const cert = await tenki.issueSandboxSSHCert(sandbox.id, publicKey);
	writeFileSync(`${keyDir}/id-cert.pub`, cert.sshCert.trim() + "\n");

	const forwarded = FORWARD.filter((name) => process.env[name]);
	if (!forwarded.length) console.error("No Anthropic credential in the environment; use /login inside claude, or export ANTHROPIC_API_KEY and run again.");

	// Runs in the sandbox's login shell. Tenki's sandbox user is `tenki`, so Claude Code's
	// --dangerously-skip-permissions works there.
	//
	// ANTHROPIC_API_KEY in claude's own environment makes it stop and ask "use this API key?",
	// defaulting to No. So the key goes in under another name, and an apiKeyHelper setting
	// that echoes that variable hands it to claude. The helper file holds no key.
	const settings = JSON.stringify({ apiKeyHelper: 'printf %s "$TENKI_CLAUDE_API_KEY"' });
	// Skips the theme picker, the trust dialog and the --dangerously-skip-permissions
	// confirmation, which block a fresh install.
	const state = (cwd) => JSON.stringify({ hasCompletedOnboarding: true, theme: "dark", bypassPermissionsModeAccepted: true, projects: { [cwd]: { hasTrustDialogAccepted: true } } });
	// The sandbox's ~/.bashrc starts every interactive shell with `cd /home/tenki`, so cd back.
	const interactiveShell = `exec bash --init-file <(printf '. "$HOME/.bashrc"; cd "%s"\\n' "$PWD")`;
	const remote = [
		...forwarded.map((name) => `export ${name === "ANTHROPIC_API_KEY" ? "TENKI_CLAUDE_API_KEY" : name}="$LC_${name}"; unset LC_${name}`),
		`[ -d "$HOME/repo" ] && cd "$HOME/repo"`,
		`mkdir -p "$HOME/.claude"`,
		`[ -f "$HOME/.claude/settings.json" ] || printf '%s' ${quote(settings)} > "$HOME/.claude/settings.json"`,
		`[ -f "$HOME/.claude.json" ] || printf '%s' ${quote(state("@@CWD@@"))} | sed "s|@@CWD@@|$PWD|" > "$HOME/.claude.json"`,
		opts.shell ? interactiveShell : `exec claude ${claudeArgs.map(quote).join(" ")}`,
	].join("; ");

	const sshArgs = [
		"-tt",
		"-o", "BatchMode=yes",
		"-o", "LogLevel=ERROR",
		// The transport is already a TLS WebSocket to Tenki, authenticated with your API key, and
		// the sandbox is new, so there is no stable host key to pin. See the README.
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"-o", "IdentitiesOnly=yes",
		"-o", "ServerAliveInterval=15",
		"-o", "ServerAliveCountMax=3",
		"-o", `ProxyCommand=node "${proxy}" ${sandbox.id}`,
		...forwarded.flatMap((name) => ["-o", `SendEnv=LC_${name}`]),
		"-i", `${keyDir}/id`,
		"tenki@sandbox",
		remote,
	];
	const env = { ...process.env, TENKI_AUTH_TOKEN: authToken };
	for (const name of forwarded) env[`LC_${name}`] = process.env[name];

	// Tenki's SSH gateway refuses a valid key ("Permission denied (publickey)") for the first
	// ~40 seconds of a new sandbox and intermittently after that. The refusal comes before any
	// shell starts, so retrying is safe; only that error is retried.
	const deadline = Date.now() + 3 * 60_000;
	let exitCode;
	for (let waiting = false; ; waiting = true) {
		let stderr = "";
		exitCode = await new Promise((resolve) => {
			child = spawn("ssh", sshArgs, { stdio: ["inherit", "inherit", "pipe"], env });
			child.stderr.on("data", (d) => (stderr += d));
			child.on("exit", (code) => resolve(code ?? 1));
		});
		const refused = exitCode === 255 && stderr.includes("Permission denied (publickey)");
		if (refused && Date.now() < deadline) {
			if (!waiting) console.error("Waiting for the sandbox's SSH gateway to accept the key...");
			await sleep(1000);
			continue;
		}
		if (stderr) process.stderr.write(stderr);
		break;
	}
	process.exitCode = exitCode;
} catch (err) {
	console.error(err.message);
	process.exitCode = 1;
} finally {
	await cleanup();
	tenki.close();
}
