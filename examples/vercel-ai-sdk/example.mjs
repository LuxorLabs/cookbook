// A minimal generateText() that gives the model a code-execution tool backed by
// a Tenki sandbox — wired through the AI SDK's `experimental_sandbox`.
//
// Needs a model key: export OPENAI_API_KEY=... (swap the provider for any other).
// The Tenki-facing part is proven without a model key in verify.mjs.
import { generateText, tool, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { createTenkiSandbox } from "./tenki-sandbox.mjs";

// Boot a disposable Tenki sandbox and adapt it to the AI SDK sandbox interface.
const { sandbox, dispose } = await createTenkiSandbox();

// The tool pulls the sandbox out of `experimental_sandbox` (the same object we
// pass to generateText below) and runs the model's command inside Tenki.
const runCommand = tool({
	description: "Run a shell command in a Linux sandbox and return its stdout/stderr.",
	inputSchema: z.object({
		command: z.string().describe("Shell command to run, e.g. python3 -c '...'"),
	}),
	execute: async ({ command }, { experimental_sandbox }) => {
		const { exitCode, stdout, stderr } = await experimental_sandbox.run({ command });
		return exitCode === 0 ? stdout : `exit ${exitCode}\n${stderr}`;
	},
});

try {
	const { text } = await generateText({
		model: openai("gpt-4o-mini"),
		tools: { runCommand },
		experimental_sandbox: sandbox, // ← Tenki is the AI SDK's sandbox
		stopWhen: stepCountIs(5),
		prompt: "Compute the 20th Fibonacci number with Python, then tell me the result.",
	});
	console.log(text);
} finally {
	await dispose(); // tear the sandbox down
}
