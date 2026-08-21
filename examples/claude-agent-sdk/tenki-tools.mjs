// Claude Agent SDK tools backed by a Tenki sandbox.
//
// The SDK's built-in Bash/Read/Write run on whatever host called query(). These
// three route the same capabilities into a disposable microVM instead, so the
// agent's execution surface is a machine you delete rather than your laptop.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { stdoutText, stderrText } from "@tenkicloud/sandbox";
import { z } from "zod";

const say = (text) => ({ content: [{ type: "text", text }] });

export function makeTenkiTools(sandbox) {
	return [
		// The schema argument is a raw Zod shape — a bare object of fields, not z.object({...}).
		tool("bash", "Run a shell command in the sandbox and return its stdout and stderr.", { command: z.string() }, async ({ command }) => {
			const r = await sandbox.exec("sh", { args: ["-c", command] });
			const out = `${stdoutText(r)}${stderrText(r)}`.trim();
			// Nothing carries the exit status to the model, so a failure that printed to
			// stderr looks like success. Say it out loud instead.
			return say(r.exitCode === 0 ? out || "(no output)" : `exit ${r.exitCode}\n${out}`.trim());
		}),

		tool("write_file", "Write a file in the sandbox.", { path: z.string(), content: z.string() }, async ({ path, content }) => {
			await sandbox.writeFile(path, content); // relative paths resolve under /home/tenki
			return say(`wrote ${path}`);
		}),

		// readFile hands back bytes, not a string. It throws on a missing path, which the
		// SDK turns into an is_error tool result — the agent sees it and can recover.
		tool("read_file", "Read a file from the sandbox.", { path: z.string() }, async ({ path }) =>
			say(new TextDecoder().decode(await sandbox.readFile(path)))),
	];
}
