# How to give an OpenAI Agents SDK agent a code interpreter that runs in a Tenki sandbox

**Audience:** JavaScript developers building agents with the [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/) who want the Python their agent writes to run somewhere other than their own process.
**Time:** ~5 minutes once you have a Tenki API key and an OpenAI API key.
**Outcome:** an Agents SDK agent that answers a question by calling a `run_python` tool, which runs its code in a disposable [Tenki](https://tenki.cloud) microVM, plus a passing check of that tool that needs no model key.

> **Honesty note:** CI runs only `verify.mjs`, which calls the `run_python` tool directly, with no model. Nothing in CI runs `agent.mjs`, which needs an OpenAI API key.

## Why bother

This is the "code interpreter" pattern with Tenki as the execution backend. The agent reasons and writes Python, and the `run_python` tool runs that code in an isolated [Tenki sandbox](https://tenki.cloud/docs/sandbox) instead of in your own process, then hands the output back. One sandbox serves the whole agent session and is reused across every tool call, which is cheaper than a sandbox per call. It's disposed when the agent finishes. The tool is one short file, `tenki-tool.mjs`, that you can copy into your own agent. It's built on the OpenAI Agents SDK for JavaScript and the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK.

## Install

Use Node.js 22 or newer to run `agent.mjs`, since the OpenAI Agents SDK lists Node.js 22 or later as its supported Node version. CI runs `verify.mjs` on Node 20, but that script calls the tool directly and never starts the `Agent` or the `run` loop.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/openai-agents-sdk
npm install
```

Every later command runs from this directory.

The Agents SDK pin, from `package.json`:

```json
    "@openai/agents": "^0.13.5",
```

The example ships no lockfile. A caret range on a 0.x version lets npm install only 0.13.x releases of `@openai/agents`, and 0.13.5 is the newest of those, so that's what CI tests. No `@openai/agents` line after 0.13 has been run against this example.

`tenki-tool.mjs` imports zod to declare the tool's parameters, and `@openai/agents` lists zod `^4.0.0` as a peer dependency, so the example depends on zod 4 directly, with `"zod": "^4.4.3"` in `package.json`.

## Authenticate

Create a `tk_` API key at https://app.tenki.cloud and export it:

```bash
export TENKI_AUTH_TOKEN=tk_...
```

Both scripts check `TENKI_AUTH_TOKEN` first. Two alternatives also work:

- `export TENKI_API_KEY=tk_...`, which is what CI sets.
- `tenki login --api-key <key>`, which stores the key in `~/.config/tenki/config.yaml`. Both scripts read its `auth_token` line.

`agent.mjs` reads `~/.config/tenki/config.yaml` before `TENKI_API_KEY`, so export `TENKI_AUTH_TOKEN` if you want an exported key to win.

Tenki infers your workspace from the key. If you want a specific one, set `TENKI_WORKSPACE_ID`. Both scripts pass it through when it's set, and they also pick up a `current_workspace_id:` line from `~/.config/tenki/config.yaml` if one is there.

`agent.mjs` also needs a model key. It uses OpenAI's `gpt-4o-mini` through the Agents SDK's default OpenAI provider, which reads the key from the environment:

```bash
export OPENAI_API_KEY=sk-...
```

`verify.mjs` needs no model key.

## Use it

Run the agent:

```bash
node agent.mjs
```

This is `agent.mjs` from line 19 on, after the imports and the `cfg` helper that reads `~/.config/tenki/config.yaml`:

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

The script creates one sandbox with 1 CPU core and 1024 MB of memory and waits for it to be ready. It builds an `Agent` with `gpt-4o-mini` and the `run_python` tool, runs it on a question that needs real computation, and prints `result.finalOutput`, the agent's final answer. The `finally` block disposes the sandbox whether the run succeeds or throws.

To use the tool in your own agent, copy `tenki-tool.mjs`, create a sandbox, and pass `makeCodeTool(sandbox)` in the agent's `tools` list, as above. Keep the imports from the top of `agent.mjs`, and drop `cfg(...)` if you pass the key and workspace another way.

## How the tool runs code

The tool, from `tenki-tool.mjs`:

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

Three things to know:

- `exec` runs `python3` with no shell, so the model's multi-line code goes through as one `-c` argument with no shell escaping. If you change the tool to run shell syntax, wrap it in `sh -c`.
- The model sees one argument. The zod schema exposes only `code`. The sandbox comes from the closure that `makeCodeTool(sandbox)` creates, so the model never sees or picks it.
- The agent always gets text back. The tool returns stdout followed by stderr, so a Python traceback reaches the agent as text. The SDK's `stdoutText` and `stderrText` trim each stream, and the tool joins them with nothing in between. If the code printed nothing, the tool returns `(no output; exit code N)`.

The sandbox has only Python's standard library by default. Outbound network is on by default in SDK 1.x, so the agent's code can `pip install` more packages. To cut the sandbox off from the network, add `allowOutbound: false` to the `createAndWait` options in `agent.mjs`.

The SDK's file methods are confined to `/home/tenki`, which is the sandbox's working directory. Code this tool runs goes through `exec`, so it can write anywhere, but relative paths land in `/home/tenki`, where the SDK's file methods can read them back. Have the agent write to relative paths.

## Check it works

```bash
node verify.mjs
```

On success it prints:

```
✓ openai-agents-sdk: OpenAI Agents SDK tool executed Python in a Tenki sandbox → 55
```

The core of `verify.mjs`:

```js
  sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });
  const runPython = makeCodeTool(sandbox);

  // Drive the Agents SDK function tool exactly as the runner would.
  const out = await runPython.invoke(new RunContext(), JSON.stringify({ code: "print(sum(range(11)))" }));
  if (String(out).trim() !== "55") throw new Error(`tool returned ${JSON.stringify(out)}`);
```

It invokes the tool over a live sandbox the way the Agents runner does (a `RunContext` plus JSON arguments), so the Tenki side is proven, but with no model key the `Agent`, the `run` loop, and the model turn aren't exercised.

## Troubleshooting

**❌ ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or the `auth_token` line of `~/.config/tenki/config.yaml`. Export `TENKI_AUTH_TOKEN=tk_...`, or run `tenki login --api-key <key>`.

**❌ `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option` from `agent.mjs`.** The SDK found no key in the environment, and the config file has no `auth_token` line. It throws before any sandbox is created. Export `TENKI_AUTH_TOKEN=tk_...`, or run `tenki login --api-key <key>`.

**❌ `invalid auth token - API keys and service tokens must start with tk_`.** The key the script found isn't a `tk_` API key, and SDK 1.x accepts nothing else. Both scripts stop here before creating a sandbox. Create a key at https://app.tenki.cloud and use that. If you exported a `tk_` key as `TENKI_API_KEY` and only `agent.mjs` fails, an older token in `~/.config/tenki/config.yaml` is winning: export the key as `TENKI_AUTH_TOKEN` instead, or rerun `tenki login --api-key <key>`.

**❌ ``Missing credentials. Please pass an `apiKey`, …`` from `agent.mjs`.** `OPENAI_API_KEY` isn't set in the shell that runs the agent. The Agents SDK creates its OpenAI client on the first model call inside `run`, so the error comes after the sandbox exists, and the `finally` block disposes it. Export the key and run again.

**❌ `✗ tool returned "…"`.** The tool returned something other than `55`. The quoted text is the sandbox's own stdout and stderr, or `(no output; exit code N)`. If the `exec` call itself failed, it's the Agents SDK's `An error occurred while running the tool. Please try again. Error: …` message, followed by the underlying error. Read it for the actual cause.

## FAQ

**Does the agent keep Python variables between tool calls?** No. Each call starts a new `python3 -c` process. The calls share one sandbox for the whole session, so a file one call writes is still there for the next, but variables are not.

**Why did the tool return `(no output; exit code 0)`?** The code ran and printed nothing. The tool returns only what the code writes to stdout and stderr, so the agent's code has to `print` its answer.

**What happens if the sandbox call fails during a run?** The run keeps going. `tool()` from the Agents SDK catches errors thrown inside `execute` by default and returns `An error occurred while running the tool. Please try again. Error: …` to the model as the tool's result. A Python exception is different: it doesn't throw at all, it comes back as traceback text on stderr.

**How long does the sandbox live?** Until the `finally` block in `agent.mjs` disposes it. The script sets no `maxDurationMs`, and sandboxes don't auto-pause when idle. In your own agent, set `maxDurationMs` in the `createAndWait` options to cap the sandbox's lifetime in case your process exits before it disposes the sandbox.

**When shouldn't I use this?** When you need a notebook-style interpreter that keeps variables between calls, since every call here is a fresh process. When the tool has to hand back files or images, since it returns only text. When tool calls must be isolated from each other, since they share one sandbox for the session and a file or package one call leaves behind is there for the next. When you're on Node 20 and need the full agent run, since the Agents SDK documents Node 22 or later. And when your project is on a newer `@openai/agents` line and you need a combination CI has tested, since CI covers only 0.13.5.

## Related

- OpenAI Agents SDK for JavaScript: https://openai.github.io/openai-agents-js/, and its supported environments: https://github.com/openai/openai-agents-js#supported-environments
- Tenki JavaScript SDK: [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox)
- Tenki sandbox docs: https://tenki.cloud/docs/sandbox, and the full docs at https://tenki.cloud/docs
- [`langchain-code-interpreter`](../langchain-code-interpreter/): the same `run_python` code-interpreter pattern for a LangChain.js agent
- [`vercel-ai-sdk`](../vercel-ai-sdk/): a Tenki sandbox behind the Vercel AI SDK's `experimental_sandbox`, the same tool-backed-by-a-sandbox idea
