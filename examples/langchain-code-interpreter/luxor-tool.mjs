// A LangChain tool that runs Python in a Luxor sandbox.
//
// Given a live Luxor sandbox, returns a LangChain tool the agent can call to
// execute code. `exec(command, { args })` passes args directly (no shell), so
// multi-line agent-generated code goes through as a single `-c` argument
// without escaping surprises.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { stdoutText, stderrText } from "@luxorai/sandbox";

export function makeCodeTool(sandbox) {
	return tool(
		async ({ code }) => {
			const res = await sandbox.exec("python3", { args: ["-c", code] });
			const out = `${stdoutText(res)}${stderrText(res)}`.trim();
			return out || `(no output; exit code ${res.exitCode})`;
		},
		{
			name: "run_python",
			description:
				"Execute Python code in a secure, disposable sandbox and return its stdout/stderr. " +
				"Use it for calculations, data work, or anything that needs real execution.",
			schema: z.object({
				code: z.string().describe("The Python code to run."),
			}),
		},
	);
}
