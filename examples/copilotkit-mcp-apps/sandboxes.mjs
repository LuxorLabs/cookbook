/**
 * The Tenki half of the example: boot a sandbox, run a program in it, serve a
 * web app from it. Plain calls on the official SDK — no MCP in this file.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";

/** Every sandbox this example creates carries this tag, and it refuses to touch anything without it. */
export const DEMO_TAG = "cookbook-mcp-apps";
export const APP_DIR = "/home/tenki/app";

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
export const hasToken = Boolean(authToken);

const tenki = new TenkiSandbox(authToken ? { authToken } : {});

const FILE_FOR = {
	python: { file: "main.py", command: "python3" },
	javascript: { file: "main.js", command: "node" },
	shell: { file: "main.sh", command: "sh" },
};

/**
 * The sandbox named by `sandboxId`, or a fresh one.
 *
 * Reuse is what makes the chat feel like a session: the agent passes the id
 * back, the files are still there, and nothing boots. Demo sandboxes are small
 * and self-terminating, so an abandoned one costs an hour at most.
 */
export async function acquire({ sandboxId, name, allowInbound = false, allowOutbound = false }) {
	if (sandboxId) {
		const existing = await tenki.get(sandboxId);
		assertOurs(existing);
		return { session: existing, bootMs: null, reused: true };
	}
	const started = Date.now();
	const session = await tenki.createAndWait({
		name,
		workspaceId,
		cpuCores: 2,
		memoryMb: 4096,
		allowInbound,
		allowOutbound,
		// Bounds the sandbox's whole life: the SDK dropped idle timeouts, and a
		// forgotten demo sandbox should cost an hour at most.
		maxDurationMs: 60 * 60_000,
		tags: [DEMO_TAG],
	});
	return { session, bootMs: Date.now() - started, reused: false };
}

/** A shared workspace can hold other people's sandboxes; only ever touch our own. */
function assertOurs(session) {
	const tags = session.tags ?? [];
	if (!tags.includes(DEMO_TAG)) {
		throw new Error(`Sandbox ${session.id} was not created by this example; refusing to use it.`);
	}
}

export const describe = (session) => ({
	id: session.id,
	name: session.name ?? "",
	cpuCores: session.cpuCores ?? 2,
	memoryMb: session.memoryMb ?? 4096,
});

/** Write a program into the sandbox and run it, returning what a terminal would show. */
export async function runProgram(session, language, code) {
	const { file, command } = FILE_FOR[language];
	await session.mkdir(APP_DIR).catch(() => {});
	await session.writeFile(`${APP_DIR}/${file}`, code);
	return exec(session, command, [`${APP_DIR}/${file}`]);
}

export async function exec(session, command, args = []) {
	const started = Date.now();
	const result = await session.exec(command, { args, cwd: APP_DIR, timeoutMs: 60_000 });
	return {
		command: [command, ...args].join(" "),
		stdout: stdoutText(result),
		stderr: stderrText(result),
		exitCode: result.exitCode ?? 0,
		runMs: Date.now() - started,
	};
}

export const shell = (session, script) => exec(session, "sh", ["-c", script]);

const shQuote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

/**
 * Serve `files` from the sandbox and return a public URL for them.
 *
 * The server is started under systemd rather than straight from exec: exec
 * returns when its command does, and a web server that outlives the call has to
 * belong to something else. `setsid` covers images without passwordless sudo.
 */
export async function serveWebApp(session, { files, startCommand, port }) {
	await session.mkdir(APP_DIR).catch(() => {});
	for (const f of files) await session.writeFile(`${APP_DIR}/${f.path}`, f.content);

	const unit = `cookbook-app-${port}`;
	const log = `${APP_DIR}/.server.log`;
	await shell(
		session,
		[
			`: > ${log}`,
			`if command -v systemd-run >/dev/null 2>&1 && sudo -n true 2>/dev/null; then`,
			`  sudo -n systemctl stop ${unit} >/dev/null 2>&1 || true`,
			`  sudo -n systemd-run --unit=${unit} --collect -p WorkingDirectory=${APP_DIR} -E PATH="$PATH" -E PORT=${port} ` +
				`sh -c ${shQuote(`exec ${startCommand} >> ${log} 2>&1`)} >/dev/null`,
			`else`,
			`  cd ${APP_DIR} && PORT=${port} setsid nohup sh -c ${shQuote(startCommand)} >> ${log} 2>&1 < /dev/null &`,
			`fi`,
		].join("\n"),
	);

	// Wait for the port rather than guessing: a preview URL for a server that
	// isn't listening yet is a 502 in the user's face.
	const probe = `i=0; while [ $i -lt 40 ]; do python3 -c "import socket;socket.create_connection(('127.0.0.1',${port}),1)" 2>/dev/null && exit 0; i=$((i+1)); sleep 0.25; done; exit 1`;
	const listening = await shell(session, probe);
	if (listening.exitCode !== 0) {
		const { stdout } = await shell(session, `tail -c 2000 ${log} 2>/dev/null || true`);
		throw new Error(`The server never listened on port ${port}.\n--- server log ---\n${stdout}`);
	}

	const exposed = await session.exposePort(port, { ttlMs: 60 * 60_000 }).catch((err) => {
		// Inbound access is fixed at creation, and run_code_in_sandbox creates with it off.
		if (String(err?.message ?? err).includes("inbound")) {
			throw new Error(`Sandbox ${session.id} was created without inbound access, so its ports cannot be exposed. Serve from a fresh sandbox (omit sandbox_id).`);
		}
		throw err;
	});
	return { previewUrl: exposed.previewUrl };
}

export async function destroy(sandboxId) {
	const session = await tenki.get(sandboxId);
	assertOurs(session);
	await session.close();
}
