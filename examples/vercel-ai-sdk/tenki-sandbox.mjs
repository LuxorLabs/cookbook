// Tenki as the Vercel AI SDK's sandbox.
//
// `toSandboxSession()` wraps a live @tenkicloud/sandbox `Session` so it satisfies
// the AI SDK's `Experimental_SandboxSession` interface (from `ai` /
// `@ai-sdk/provider-utils`): description + read/write file methods + run/spawn.
// Pass the result to `generateText({ experimental_sandbox })` and the model's
// tools execute inside a disposable Tenki microVM.
//
// `createTenkiSandbox()` is a convenience that boots a microVM and hands back the
// adapter plus a `dispose()`.
import { TenkiSandbox, stdoutText, stderrText, FileNotFoundError } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

// The AI SDK hands `run`/`spawn` a single command *string*; Tenki's exec/run take
// a bare argv with no shell splitting. Route through `sh -c` so shell syntax
// (pipes, &&, redirects, quoting) behaves the way an agent expects.
const shArgs = (command) => ["-c", command];

// AI SDK reads resolve to `null` when the file is missing; Tenki throws instead.
const isNotFound = (e) =>
	e instanceof FileNotFoundError ||
	e?.name === "FileNotFoundError" ||
	/no such file or directory/i.test(String(e?.message ?? ""));

// Honor the AI SDK write contract ("creates parent directories recursively").
// Tenki's mkdir is `mkdir -p`; ignore "already exists".
const ensureParent = async (session, path) => {
	const i = path.lastIndexOf("/");
	if (i > 0) {
		try {
			await session.mkdir(path.slice(0, i));
		} catch {
			/* already there, or created concurrently */
		}
	}
};

const DEFAULT_DESCRIPTION =
	"A disposable Tenki Linux microVM. The working directory is /home/tenki; " +
	"reference files with relative paths. Python 3 and standard Unix tools are available.";

/**
 * Adapt a live Tenki `Session` to the AI SDK `Experimental_SandboxSession`.
 * Pure interface mapping — no lifecycle. `session` is a @tenkicloud/sandbox Session.
 */
export function toSandboxSession(session, { description = DEFAULT_DESCRIPTION } = {}) {
	const readBytes = async (path) => {
		try {
			return await session.readFile(path); // Uint8Array
		} catch (e) {
			if (isNotFound(e)) return null; // AI SDK contract: null when missing
			throw e;
		}
	};

	return {
		description,

		// ---- reads (resolve null when the file does not exist) ----
		readBinaryFile: ({ path }) => readBytes(path),

		readFile: async ({ path }) => {
			const bytes = await readBytes(path);
			if (bytes === null) return null;
			return new ReadableStream({
				start(c) {
					c.enqueue(bytes);
					c.close();
				},
			});
		},

		readTextFile: async ({ path, encoding = "utf-8", startLine, endLine }) => {
			const bytes = await readBytes(path);
			if (bytes === null) return null;
			const text = new TextDecoder(encoding).decode(bytes);
			if (startLine === undefined && endLine === undefined) return text;
			// Line ranges are 1-based, inclusive; endLine past EOF returns through EOF.
			const lines = text.split("\n");
			return lines.slice((startLine ?? 1) - 1, endLine ?? lines.length).join("\n");
		},

		// ---- writes (create parents recursively, overwrite existing) ----
		writeBinaryFile: async ({ path, content }) => {
			await ensureParent(session, path);
			await session.writeFile(path, content);
		},

		writeTextFile: async ({ path, content, encoding = "utf-8" }) => {
			await ensureParent(session, path);
			// Tenki encodes a string as UTF-8; convert other encodings to bytes first.
			const data = /^utf-?8$/i.test(encoding) ? content : Uint8Array.from(Buffer.from(content, encoding));
			await session.writeFile(path, data);
		},

		writeFile: async ({ path, content }) => {
			await ensureParent(session, path);
			const bytes = new Uint8Array(await new Response(content).arrayBuffer());
			await session.writeFile(path, bytes);
		},

		// ---- processes ----
		run: async ({ command, workingDirectory, env, abortSignal }) => {
			const res = await session.exec("sh", { args: shArgs(command), cwd: workingDirectory, env, signal: abortSignal });
			return { exitCode: res.exitCode, stdout: stdoutText(res), stderr: stderrText(res) };
		},

		spawn: async ({ command, workingDirectory, env, abortSignal }) => {
			const handle = session.run(["sh", ...shArgs(command)], { cwd: workingDirectory, env });
			// Aborting the AI SDK signal terminates the running process.
			abortSignal?.addEventListener("abort", () => void handle.kill(), { once: true });
			const pid = await handle.pid.catch(() => undefined);
			return {
				pid,
				stdout: handle.stdout, // ReadableStream<Uint8Array>
				stderr: handle.stderr,
				wait: async () => ({ exitCode: (await handle).exitCode }),
				kill: async () => void (await handle.kill()),
			};
		},
	};
}

// Read a key out of ~/.config/tenki/config.yaml (written by `tenki login`).
const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

/**
 * Boot a fresh Tenki microVM and expose it as an AI SDK sandbox.
 * Credentials resolve from options → env → ~/.config/tenki/config.yaml.
 * Returns `{ sandbox, session, dispose }`: pass `sandbox` to `generateText`,
 * and `await dispose()` (or `await using`) when finished.
 */
export async function createTenkiSandbox(options = {}) {
	const authToken = options.authToken || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
	const workspaceId = options.workspaceId || process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id");
	if (!authToken) throw new Error("No Tenki token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");

	const client = new TenkiSandbox({ authToken });
	const session = await client.createAndWait({
		cpuCores: options.cpuCores ?? 1,
		memoryMb: options.memoryMb ?? 1024,
		allowOutbound: options.allowOutbound ?? false, // set true for pip/network
		workspaceId,
	});

	const sandbox = toSandboxSession(session, { description: options.description });
	const dispose = () => session[Symbol.asyncDispose]();
	return { sandbox, session, dispose, [Symbol.asyncDispose]: dispose };
}
