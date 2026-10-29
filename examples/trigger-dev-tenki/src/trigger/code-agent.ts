import { chat } from "@trigger.dev/sdk/ai";
import { openai } from "@ai-sdk/openai";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { disposeSandbox, executeCode, warmSandbox } from "../tenki.mjs";

// Tool execute() functions don't receive hook payloads, so the run id travels in chat.local.
const sandboxRun = chat.local<{ runId: string }>({ id: "sandboxRun" });

const tools = {
  executeCode: tool({
    description: "Run a Python 3 script in an isolated Linux sandbox and return its stdout, stderr, and exit code.",
    inputSchema: z.object({ code: z.string().describe("A complete Python 3 script. Print the results you need.") }),
    execute: async ({ code }) => executeCode(sandboxRun.runId, code),
  }),
};

export const codeAgent = chat.agent({
  id: "code-agent",
  tools,
  // Start booting the sandbox while the model thinks; the tool awaits it on first use.
  onTurnStart: async ({ runId }) => {
    sandboxRun.init({ runId });
    warmSandbox(runId);
  },
  // The run is about to suspend until the next message: stop paying for the sandbox.
  onChatSuspend: async ({ runId }) => {
    await disposeSandbox(runId);
  },
  // Safety net for runs that end without suspending (cancel, error, endRun).
  onComplete: async ({ ctx }) => {
    await disposeSandbox(ctx.run.id);
  },
  run: async ({ messages, tools, signal }) =>
    streamText({
      model: openai("gpt-5-mini"),
      system: "Use executeCode for any calculation or data processing. Report what the code printed.",
      messages,
      tools,
      stopWhen: stepCountIs(5),
      abortSignal: signal,
    }),
});
