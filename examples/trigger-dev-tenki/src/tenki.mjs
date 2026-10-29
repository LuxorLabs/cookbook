// Tenki sandbox helpers for the Trigger.dev tasks in src/trigger/.
// Plain ESM so verify.mjs can drive the same code on Node 20 without a Trigger.dev account.
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";

// Created on first use: Trigger.dev imports task files to index them, before env vars matter.
// Reads TENKI_API_KEY (or TENKI_AUTH_TOKEN) from the Trigger.dev environment.
let client;
const tenki = () => (client ??= new TenkiSandbox());

/**
 * Boot a sandbox. Backstops for a worker that dies before its `finally`: Tenki pauses the sandbox
 * after maxDurationMs of running time, and drops a paused sandbox after pauseRetentionMs.
 */
export function createSandbox({ maxDurationMs = 15 * 60_000, pauseRetentionMs = 60 * 60_000 } = {}) {
	return tenki().createAndWait({
		cpuCores: 1,
		memoryMb: 1024,
		maxDurationMs,
		pauseRetentionMs,
		workspaceId: process.env.TENKI_WORKSPACE_ID,
	});
}

/** Run a shell command in the sandbox. exec() takes argv with no shell splitting, so wrap in sh -c. */
export async function runCommand(sandbox, command) {
	const res = await sandbox.exec("sh", { args: ["-c", command] });
	return { exitCode: res.exitCode, stdout: stdoutText(res), stderr: stderrText(res) };
}

/** Pause and wait until the snapshot is durable. Memory, processes, and /home/tenki survive; /tmp does not. */
export async function pauseSandbox(sandbox) {
	await sandbox.pause();
	await sandbox.waitPaused();
	return sandbox.id;
}

/** Look a paused sandbox up by id and bring it back to RUNNING. */
export async function resumeSandbox(id) {
	const sandbox = await tenki().get(id);
	await sandbox.resume();
	await sandbox.waitResumed();
	return sandbox;
}

// ---- run-scoped sandboxes for chat.agent (one per Trigger.dev run id) ----
const sandboxes = new Map();

/** Start booting a sandbox for this run without awaiting it. Safe to call every turn. */
export function warmSandbox(runId) {
	if (!sandboxes.has(runId)) {
		const pending = createSandbox();
		pending.catch(() => sandboxes.delete(runId)); // the next call retries instead of reusing a failure
		sandboxes.set(runId, pending);
	}
}

export function sandboxFor(runId) {
	warmSandbox(runId);
	return sandboxes.get(runId);
}

export async function disposeSandbox(runId) {
	const pending = sandboxes.get(runId);
	if (!pending) return;
	sandboxes.delete(runId);
	const sandbox = await pending.catch(() => undefined);
	await sandbox?.close();
}

/** Body of the chat agent's executeCode tool: run model-written Python in this run's sandbox. */
export async function executeCode(runId, code) {
	const sandbox = await sandboxFor(runId);
	const res = await sandbox.exec("python3", { args: ["-c", code] });
	return { exitCode: res.exitCode, stdout: stdoutText(res), stderr: stderrText(res) };
}
