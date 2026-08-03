# LangChain agent on Tenki (code interpreter)

A LangChain agent that writes Python and runs it in a disposable Tenki sandbox — the "code interpreter" pattern, with Tenki as the execution backend. One sandbox per agent session; a `run_python` tool the agent calls to execute code in an isolated microVM.

## The tool (`tenki-tool.mjs`)

```js
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { stdoutText, stderrText } from "@tenkicloud/sandbox";

export function makeCodeTool(sandbox) {
  return tool(
    async ({ code }) => {
      const res = await sandbox.exec("python3", { args: ["-c", code] });
      return `${stdoutText(res)}${stderrText(res)}`.trim() || `(exit ${res.exitCode})`;
    },
    {
      name: "run_python",
      description: "Execute Python in a sandbox and return its output.",
      schema: z.object({ code: z.string() }),
    },
  );
}
```

## The agent (`agent.mjs`)

Create one sandbox, wire the tool into a LangGraph ReAct agent, ask something that needs real computation:

```js
const agent = createReactAgent({
  llm: new ChatOpenAI({ model: "gpt-4o-mini" }),
  tools: [makeCodeTool(sandbox)],
});
const result = await agent.invoke({
  messages: [{ role: "user", content: "What is the 20th Fibonacci number? Compute it with Python." }],
});
```

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...                    # from `tenki login`
export TENKI_WORKSPACE_ID=...
export OPENAI_API_KEY=...                      # or swap ChatOpenAI for your provider
node agent.mjs
```

## Verify (no LLM needed)

```bash
node verify.mjs   # calls the tool directly → runs Python in Tenki → asserts the output
```

This is what CI runs: it proves the Tenki integration end-to-end without a model key.

## Notes

- **One sandbox per session, reused across tool calls** — cheaper than a sandbox per call; disposed when the agent finishes.
- `exec("python3", { args: ["-c", code] })` passes the code as a single argument (no shell), so multi-line agent-generated code goes through without escaping issues.
- Stdlib only by default — sandboxes have no outbound network unless you pass `allowOutbound: true` (needed for `pip install`).
- Built on LangChain.js v1 + [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox). The same tool-backed-by-a-sandbox pattern works in LangChain Python.
