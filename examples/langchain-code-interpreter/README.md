# LangChain (JavaScript)

Give a LangChain.js agent a `run_python` code-interpreter tool that runs in a Tenki sandbox. The agent writes Python, the tool runs it in one sandbox shared for the session, and the output goes back to the agent. The tool is one file, `tenki-tool.mjs`, that you can copy into your own agent. For Python agents, see [LangChain (Python)](../langchain-python/).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "LangChain (JavaScript)" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/langchain-code-interpreter, check that Node.js is 22 or later, and run npm install.
2. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud) and, for agent.mjs, OPENAI_API_KEY. If either is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs first (no model call, expects 55), then node agent.mjs.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then add tenki-tool.mjs to my own LangChain.js agent: create one sandbox per session, pass makeCodeTool(sandbox) in the tools list, and dispose the sandbox in a finally block.
```

## Quick start

You need:

- Node.js 22 or later for `agent.mjs` (current `@langchain/openai` requires it). `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An OpenAI API key, for the agent run only.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/langchain-code-interpreter
npm install
```

This installs `@langchain/core`, `@langchain/langgraph`, `@langchain/openai`, `@tenkicloud/sandbox`, and `zod`. On Node 20, npm warns `EBADENGINE` for `@langchain/openai`; `verify.mjs` still runs.

### 2. Set your keys

```bash
export TENKI_AUTH_TOKEN=tk_...
export OPENAI_API_KEY=sk-...
```

`TENKI_API_KEY` and a key saved with `tenki login --api-key <key>` also work. `TENKI_AUTH_TOKEN` always wins. After that, `agent.mjs` prefers the `tenki login` key over `TENKI_API_KEY`, while `verify.mjs` prefers `TENKI_API_KEY`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run the agent

```bash
node agent.mjs
```

A LangGraph ReAct agent on `gpt-4o-mini` computes the 20th Fibonacci number with `run_python` and prints its answer.

### 4. Verify

```bash
node verify.mjs
```

```
✓ langchain-code-interpreter: LangChain tool executed Python in a Tenki sandbox → 55
```

`verify.mjs` calls the tool directly with `print(sum(range(11)))` and checks for `55`. It needs no OpenAI key.

## The agent

`agent.mjs`, from where it creates the sandbox:

```js
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || cfg("auth_token") });

// One sandbox for the whole agent session, reused across every tool call.
const sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id"),
});

try {
  const agent = createReactAgent({
    llm: new ChatOpenAI({ model: "gpt-4o-mini" }), // needs OPENAI_API_KEY
    tools: [makeCodeTool(sandbox)], // the tool runs the agent's code in Tenki
  });

  const result = await agent.invoke({
    messages: [{ role: "user", content: "What is the 20th Fibonacci number? Compute it with Python." }],
  });

  console.log(result.messages.at(-1).content);
} finally {
  await sandbox[Symbol.asyncDispose](); // dispose the sandbox when the agent is done
}
```

To use a different model provider, swap `ChatOpenAI` for its LangChain chat model. `createReactAgent` is marked deprecated in `@langchain/langgraph` 1.x in favor of `createAgent` from `langchain`. `makeCodeTool` returns an ordinary `@langchain/core` tool, so it works with either.

## The tool

`tenki-tool.mjs`:

```js
// A LangChain tool that runs Python in a Tenki sandbox.
//
// Given a live Tenki sandbox, returns a LangChain tool the agent can call to
// execute code. `exec(command, { args })` passes args directly (no shell), so
// multi-line agent-generated code goes through as a single `-c` argument
// without escaping surprises.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { stdoutText, stderrText } from "@tenkicloud/sandbox";

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
```

Things to know:

- **No shell.** The code goes to `python3 -c` as one argument, so multi-line code needs no escaping. Use `sh -c` through `exec` if you need shell syntax.
- **The model only sees `code`.** The sandbox comes from the closure.
- **Errors come back as text.** The tool returns stdout then stderr, so tracebacks reach the agent. Code that prints nothing returns `(no output; exit code N)`, so the agent has to `print` its answer.
- **No state between calls.** Each call is a new `python3` process. Files persist in the shared sandbox; variables don't.
- **Standard library only by default.** Outbound network is on, so the code can `pip install`. Add `allowOutbound: false` to `createAndWait` to cut it off.
- **Set a lifetime cap.** `agent.mjs` disposes of the sandbox in `finally` but sets no `maxDurationMs`. Set one in your agent in case the process dies first.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | Export `TENKI_AUTH_TOKEN` or run `tenki login --api-key <key>`. |
| `invalid auth token - API keys and service tokens must start with tk_` | Use a `tk_` key. If only `agent.mjs` fails, an old key in `~/.config/tenki/config.yaml` is winning over `TENKI_API_KEY`; export `TENKI_AUTH_TOKEN` instead. |
| ``Missing credentials. Please pass an `apiKey`, …`` | Export `OPENAI_API_KEY`. |
| `npm warn EBADENGINE` for `@langchain/openai` | Use Node 22 for `agent.mjs`, or install `@langchain/openai@1.5.8`, the last release that supports Node 20. |
| `✗ tool returned "…"` | The quoted text is the sandbox's output. Read it for the error. |

## Related

- [LangChain (Python)](../langchain-python/): the same tool for a Python agent
- [Run code in a sandbox](../run-code-in-a-sandbox/): the bare SDK loop
- [LangChain.js](https://github.com/langchain-ai/langchainjs) and [LangGraph.js](https://github.com/langchain-ai/langgraphjs)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
