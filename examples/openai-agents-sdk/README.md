# OpenAI Agents SDK

Give an [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/) agent a `run_python` code-interpreter tool that runs in a Tenki sandbox. The agent writes Python, the tool runs it in one sandbox shared for the session, and the output goes back to the agent. The tool is one file, `tenki-tool.mjs`, that you can copy into your own agent.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "OpenAI Agents SDK" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/openai-agents-sdk, check that Node.js is 22 or later, and run npm install.
2. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud) and, for agent.mjs, OPENAI_API_KEY. If either is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs first (no model call, expects 55), then node agent.mjs.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then add tenki-tool.mjs to my own Agents SDK agent: one sandbox per session with a maxDurationMs cap, makeCodeTool(sandbox) in tools, and dispose in a finally block.
```

## Quick start

You need:

- Node.js 22 or later for `agent.mjs` (the Agents SDK's supported version). `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An OpenAI API key, for the agent run only.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/openai-agents-sdk
npm install
```

This installs `@openai/agents` `^0.13.5` (0.13.x only; CI tests 0.13.5), `@tenkicloud/sandbox`, and `zod` 4.

### 2. Set your keys

```bash
export TENKI_AUTH_TOKEN=tk_...
export OPENAI_API_KEY=sk-...
```

`TENKI_API_KEY` and a key saved with `tenki login --api-key <key>` also work. `TENKI_AUTH_TOKEN` always wins; after it, `agent.mjs` prefers the `tenki login` key over `TENKI_API_KEY`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run the agent

```bash
node agent.mjs
```

The agent computes the 20th Fibonacci number with `run_python` on `gpt-4o-mini` and prints `result.finalOutput`.

### 4. Verify

```bash
node verify.mjs
```

```
✓ openai-agents-sdk: OpenAI Agents SDK tool executed Python in a Tenki sandbox → 55
```

`verify.mjs` invokes the tool the way the Agents runner does, with a `RunContext` and JSON arguments, runs `print(sum(range(11)))`, and checks for `55`. It needs no OpenAI key.

## The agent

`agent.mjs`, after the imports and the `cfg` helper that reads `~/.config/tenki/config.yaml`:

```js
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || cfg("auth_token") });

// One sandbox for the whole agent session, reused across every tool call.
const sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id"),
});

try {
  const agent = new Agent({
    name: "Code Interpreter",
    instructions: "You solve problems by writing Python and running it with the run_python tool. Always run code to get the answer, then report the result.",
    model: "gpt-4o-mini", // needs OPENAI_API_KEY
    tools: [makeCodeTool(sandbox)], // the tool runs the agent's code in Tenki
  });

  const result = await run(agent, "What is the 20th Fibonacci number? Compute it with Python.");
  console.log(result.finalOutput);
} finally {
  await sandbox[Symbol.asyncDispose](); // dispose the sandbox when the agent is done
}
```

## The tool

`tenki-tool.mjs`:

```js
// An OpenAI Agents SDK tool that runs Python in a Tenki sandbox.
//
// Given a live Tenki sandbox, `makeCodeTool(sandbox)` returns a function tool the
// agent can call to execute code. `exec(command, { args })` passes args directly
// (no shell), so multi-line, model-generated code goes through as a single `-c`
// argument without escaping surprises.
import { tool } from "@openai/agents";
import { z } from "zod";
import { stdoutText, stderrText } from "@tenkicloud/sandbox";

export function makeCodeTool(sandbox) {
  return tool({
    name: "run_python",
    description:
      "Execute Python code in a secure, disposable sandbox and return its stdout/stderr. " +
      "Use it for calculations, data work, or anything that needs real execution.",
    parameters: z.object({
      code: z.string().describe("The Python code to run."),
    }),
    execute: async ({ code }) => {
      const res = await sandbox.exec("python3", { args: ["-c", code] });
      const out = `${stdoutText(res)}${stderrText(res)}`.trim();
      return out || `(no output; exit code ${res.exitCode})`;
    },
  });
}
```

Things to know:

- **No shell.** The code goes to `python3 -c` as one argument. Wrap shell syntax in `sh -c` if you change the tool.
- **The model only sees `code`.** The sandbox comes from the closure.
- **Errors come back as text.** Python tracebacks arrive on stderr. If the `exec` call itself throws, the Agents SDK returns `An error occurred while running the tool. Please try again. Error: …` to the model and the run continues. Code that prints nothing returns `(no output; exit code N)`.
- **No state between calls.** Each call is a new `python3` process. Files and installed packages persist in the shared sandbox; variables don't. Relative paths land in `/home/tenki`.
- **Standard library only.** Outbound network is on, so the code can `pip install`. Add `allowOutbound: false` to `createAndWait` to cut it off.
- **Set a lifetime cap.** `agent.mjs` disposes of the sandbox in `finally` but sets no `maxDurationMs`, and idle sandboxes don't pause. Set one in your agent.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | Export `TENKI_AUTH_TOKEN` or run `tenki login --api-key <key>`. |
| `invalid auth token - API keys and service tokens must start with tk_` | Use a `tk_` key. If only `agent.mjs` fails, an old key in `~/.config/tenki/config.yaml` is winning; export `TENKI_AUTH_TOKEN`. |
| ``Missing credentials. Please pass an `apiKey`, …`` | Export `OPENAI_API_KEY`. |
| `✗ tool returned "…"` | The quoted text is the sandbox's output or the SDK's tool error. Read it for the cause. |

## Related

- [LangChain (JavaScript)](../langchain-code-interpreter/): the same tool for LangChain.js
- [Vercel AI SDK](../vercel-ai-sdk/): a Tenki sandbox as `experimental_sandbox`
- [OpenAI Agents SDK for JavaScript](https://openai.github.io/openai-agents-js/)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
