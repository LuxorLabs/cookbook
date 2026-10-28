// Claude Agent SDK tools backed by a Tenki sandbox.
//
// The SDK's built-in Bash, Read, and Write tools act on the computer that runs
// query(). These three do the same jobs inside a Tenki sandbox instead, so
// everything the agent runs or writes stays on a machine you can throw away.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { stdoutText, stderrText } from "@tenkicloud/sandbox";
import { z } from "zod";

// Tools return their result to Claude as a list of content blocks; these return plain text.
const say = (text) => ({ content: [{ type: "text", text }] });

export function makeTenkiTools(sandbox) {
	return [
		// The inputs are a plain object of fields ({ command: z.string() }), not z.object({...}).
		tool("bash", "Run a shell command in the sandbox and return its stdout and stderr.", { command: z.string() }, async ({ command }) => {
			// Commands have no time limit by default, so cap each one at 2 minutes. A command
			// that runs out of time comes back with status TIMED_OUT instead of throwing.
			const r = await sandbox.exec("sh", { args: ["-c", command], timeoutMs: 120_000 });
			const out = `${stdoutText(r)}${stderrText(r)}`.trim();
			if (r.status === "TIMED_OUT") return say(`timed out after 120s\n${out}`.trim());
			// Claude only sees the text we return, so say when a command failed.
			return say(r.exitCode === 0 ? out || "(no output)" : `exit ${r.exitCode}\n${out}`.trim());
		}),

		tool("write_file", "Write a file in the sandbox.", { path: z.string(), content: z.string() }, async ({ path, content }) => {
			await sandbox.writeFile(path, content); // relative paths resolve under /home/tenki
			return say(`wrote ${path}`);
		}),

		// readFile returns raw bytes, so decode them to text. If the file doesn't exist it throws;
		// the SDK passes that error to Claude, which can then try something else.
		tool("read_file", "Read a file from the sandbox.", { path: z.string() }, async ({ path }) =>
			say(new TextDecoder().decode(await sandbox.readFile(path)))),
	];
}
