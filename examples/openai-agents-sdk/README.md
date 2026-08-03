# OpenAI Agents SDK on Tenki (code interpreter)

Give an [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/) agent a **code interpreter** — a `run_python` tool that executes the model's Python in a disposable [Tenki](https://tenki.cloud) sandbox and hands the output back. The agent reasons and writes code; [Tenki](https://tenki.cloud/docs/sandbox) is the execution backend — an isolated microVM, not your process. One sandbox per agent session, reused across every tool call.

## The tool (`tenki-tool.mjs`)

`makeCodeTool(sandbox)` closes over a live Tenki sandbox and returns an Agents SDK function tool:

```js
import { tool } from "@openai/agents";
import { z } from "zod";
import { stdoutText, stderrText } from "@tenkicloud/sandbox";

export function makeCodeTool(sandbox) {
  return tool({
    name: "run_python",
    description: "Execute Python in a secure, disposable sandbox and return its output.",
    parameters: z.object({ code: z.string() }),
    execute: async ({ code }) => {
      const res = await sandbox.exec("python3", { args: ["-c", code] });
      return `${stdoutText(res)}${stderrText(res)}`.trim() || `(exit ${res.exitCode})`;
    },
  });
}
```

`exec("python3", { args: ["-c", code] })` passes the code as a single argument (no shell), so multi-line, model-generated code goes across without escaping surprises.

## The agent (`agent.mjs`)

Create one sandbox, wire the tool into an `Agent`, and `run` it on a question that needs real computation:

```js
import { Agent, run } from "@openai/agents";

const agent = new Agent({
  name: "Code Interpreter",
  instructions: "Solve problems by writing Python and running it with run_python.",
  model: "gpt-4o-mini",           // needs OPENAI_API_KEY
  tools: [makeCodeTool(sandbox)], // the tool runs the agent's code in Tenki
});

const result = await run(agent, "What is the 20th Fibonacci number? Compute it with Python.");
console.log(result.finalOutput);
```

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...                    # from `tenki login`
export TENKI_WORKSPACE_ID=...
export OPENAI_API_KEY=sk-...                   # the Agents SDK's model provider
node agent.mjs
```

## Verify (no LLM needed)

```bash
node verify.mjs   # calls the tool directly → runs Python in Tenki → asserts the output
```

`verify.mjs` builds the tool over a live sandbox and invokes it exactly as the Agents runner would (`tool.invoke(new RunContext(), JSON.stringify({ code }))`), asserting the result. This is what CI runs: it proves the Tenki integration end-to-end without a model key.

## Notes

- **One sandbox per session, reused across tool calls** — cheaper than a sandbox per call; disposed (`Symbol.asyncDispose`) when the agent finishes.
- `exec("python3", { args: ["-c", code] })` passes the code as a single argument (no shell), so multi-line agent-generated code goes through without escaping issues.
- Stdlib only by default — sandboxes have no outbound network unless you create them with `allowOutbound: true` (needed for `pip install`).
- Tenki confines file I/O to `/home/tenki` — write to relative paths.
- Built on the [OpenAI Agents SDK (JS)](https://openai.github.io/openai-agents-js/) + [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox). The same tool-backed-by-a-sandbox pattern is the [LangChain](../langchain-code-interpreter/) and [Vercel AI SDK](../vercel-ai-sdk/) examples too.
