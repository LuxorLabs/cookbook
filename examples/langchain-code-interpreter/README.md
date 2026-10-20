# How to give a LangChain.js agent a code interpreter that runs in a Tenki sandbox

A LangGraph ReAct agent answers a question by calling a `run_python` tool. The tool runs that Python in a disposable [Tenki](https://tenki.cloud) sandbox. A check of the tool passes with no model key.

About 5 minutes.

CI runs `verify.mjs`, which calls the `run_python` tool directly. `agent.mjs` needs an OpenAI key and, with today's `@langchain/openai` releases, Node 22 or newer. CI does not run `agent.mjs`.

## Why bother

This is the "code interpreter" pattern with Tenki as the execution backend. The agent writes Python, and the `run_python` tool runs it in an isolated sandbox instead of on your machine, then hands the output back to the agent. One sandbox serves the whole agent session and is reused across every tool call, which is cheaper than a sandbox per call. It's disposed when the agent finishes. The tool is one short file, `tenki-tool.mjs`, that you can copy into your own agent. It's built on LangChain.js v1 and the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK.

## Install

You need Node 20 or newer for `verify.mjs`, and Node 22 or newer for `agent.mjs`. The reason is below the dependency list.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/langchain-code-interpreter
npm install
```

Every later command runs from this directory.

The dependencies, from `package.json`:

```json
  "dependencies": {
    "@langchain/core": "^1.2.3",
    "@langchain/langgraph": "^1.4.8",
    "@langchain/openai": "^1.5.5",
    "@tenkicloud/sandbox": ">=1.4.1",
    "zod": "^4.4.3"
  }
```

The example ships no lockfile, so `npm install` takes the newest release in each range. For `@langchain/openai`, that's a release that declares Node 22 or newer: 1.5.9 and later do, while 1.5.8 and earlier declare Node 20. `verify.mjs` doesn't import `@langchain/openai`, which is why it runs on Node 20, the version CI uses.

## Authenticate

Create a `tk_` API key at https://app.tenki.cloud and export it:

```bash
export TENKI_AUTH_TOKEN=tk_...
```

Both scripts check `TENKI_AUTH_TOKEN` first. Two alternatives also work:

- `export TENKI_API_KEY=tk_...`, which is what CI sets.
- `tenki login --api-key <key>`, which stores the key in `~/.config/tenki/config.yaml`. Both scripts read its `auth_token` line.

The order differs between the scripts in one way. `verify.mjs` checks `TENKI_API_KEY` before the config file, but `agent.mjs` reads the config file first and leaves `TENKI_API_KEY` to the SDK as a fallback. So if the config file holds a key, `agent.mjs` uses it instead of an exported `TENKI_API_KEY`. `TENKI_AUTH_TOKEN` wins in both.

Tenki infers your workspace from the key. If you want a specific one, set `TENKI_WORKSPACE_ID`. Both scripts pass it through when it's set, and they also pick up a `current_workspace_id:` line from `~/.config/tenki/config.yaml` if one is there.

`agent.mjs` also needs a model key. It uses OpenAI's `gpt-4o-mini` through `ChatOpenAI`:

```bash
export OPENAI_API_KEY=sk-...
```

To use a different provider, swap `ChatOpenAI` for your provider's LangChain chat model. `verify.mjs` needs no model key.

## Use it

Run the agent:

```bash
node agent.mjs
```

This is `agent.mjs` from the point where it creates the sandbox:

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

The script creates one sandbox with 1 CPU core and 1024 MB of memory and waits for it to be ready. It builds a LangGraph ReAct agent with `gpt-4o-mini` and the `run_python` tool, asks for the 20th Fibonacci number, and prints the last message in the result, which is the model's final answer. The `finally` block disposes the sandbox whether the agent succeeds or throws.

To use the tool in your own agent, copy `tenki-tool.mjs`, create a sandbox, and pass `makeCodeTool(sandbox)` in the agent's `tools` list, as above.

## How the tool runs code

The tool, from `tenki-tool.mjs`:

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

Three things to know:

- **No shell in between.** `exec("python3", { args: ["-c", code] })` runs `python3` directly and passes the code as a single argument, so multi-line, model-generated code goes through without escaping problems. If you need shell syntax, run it through `sh -c` with `exec`.
- **The model sees one argument.** The zod schema exposes only `code`. The sandbox comes from the closure that `makeCodeTool(sandbox)` creates, so the model never sees or picks it.
- **The agent always gets text back.** The tool returns stdout followed by stderr, so a Python traceback reaches the agent as text. The SDK's `stdoutText` and `stderrText` trim each stream, and the tool joins them with nothing in between. If the code printed nothing, the tool returns `(no output; exit code N)`.

The sandbox has only Python's standard library by default. Outbound network is on by default in SDK 1.x, so the agent's code can `pip install` more packages. To cut the sandbox off from the network, add `allowOutbound: false` to the `createAndWait` options in `agent.mjs`.

## Check it works

```bash
node verify.mjs
```

On success it prints:

```
✓ langchain-code-interpreter: LangChain tool executed Python in a Tenki sandbox → 55
```

The core of `verify.mjs`:

```js
  sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });
  const runPython = makeCodeTool(sandbox);

  // Drive the LangChain tool exactly as an agent would.
  const out = await runPython.invoke({ code: "print(sum(range(11)))" });
  if (String(out).trim() !== "55") throw new Error(`tool returned ${JSON.stringify(out)}`);
```

This proves the Tenki-facing half of the example: the LangChain `run_python` tool runs code in a live sandbox and returns its output. The script calls the tool directly, with no model, so the LangGraph agent, `@langchain/openai`, and the model turn aren't exercised. This is what CI runs, on Node 20 with only `TENKI_API_KEY` set.

## Troubleshooting

**❌ ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or the `auth_token` line of `~/.config/tenki/config.yaml`. Export `TENKI_AUTH_TOKEN=tk_...`, or run `tenki login --api-key <key>`.

**❌ `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option` from `agent.mjs`.** The SDK found no key in the environment, and the config file has no `auth_token` line. It throws before any sandbox is created. Export `TENKI_AUTH_TOKEN=tk_...`, or run `tenki login --api-key <key>`.

**❌ `invalid auth token - API keys and service tokens must start with tk_`.** The key the script found isn't a `tk_` API key, and SDK 1.x accepts nothing else. Both scripts stop here before creating a sandbox. Create a key at https://app.tenki.cloud and use that. If you exported a `tk_` key as `TENKI_API_KEY` and only `agent.mjs` fails, an older token in `~/.config/tenki/config.yaml` is winning: export the key as `TENKI_AUTH_TOKEN` instead, or rerun `tenki login --api-key <key>`.

**❌ ``Missing credentials. Please pass an `apiKey`, …`` from `agent.mjs`.** `OPENAI_API_KEY` isn't set in the shell that runs the agent. `ChatOpenAI` reads it from the environment and fails on the first model call. Export it and run again. The sandbox already exists by then, and the `finally` block disposes it.

**❌ `npm warn EBADENGINE Unsupported engine` for `@langchain/openai`.** You're on a Node version older than 22, and current `@langchain/openai` releases declare Node 22 or newer. npm only warns, so the install finishes and `verify.mjs` runs. To run `agent.mjs`, use Node 22 or newer, or install `@langchain/openai@1.5.8`, the last release that declares Node 20.

**❌ `✗ tool returned "…"`.** The sandbox ran the check, but the tool returned something other than `55`. The quoted text is the sandbox's own stdout and stderr, or `(no output; exit code N)`, so read it for the actual error.

## FAQ

**Does the agent keep Python variables between tool calls?** No. Each call starts a new `python3 -c` process. The calls share one sandbox for the whole session, so a file one call writes is still there for the next, but variables are not. Relative paths land in `/home/tenki`, the sandbox's working directory.

**Why did the tool return `(no output; exit code 0)`?** The code ran and printed nothing. The tool returns only what the code writes to stdout and stderr, so the agent's code has to `print` its answer.

**Can the sandbox reach the internet?** Yes. Outbound network is on by default in SDK 1.x, and this example doesn't change it. Add `allowOutbound: false` to the `createAndWait` options if you want the agent's code cut off from the network.

**Can I use a model other than OpenAI?** Yes. Swap `ChatOpenAI` in `agent.mjs` for your provider's LangChain chat model and install its package. `tenki-tool.mjs` and the sandbox code stay the same.

**`createReactAgent` is marked deprecated. Does that matter here?** In `@langchain/langgraph` 1.x, `createReactAgent` carries a deprecation note that points to `createAgent` in the `langchain` package. It's still exported, and `agent.mjs` uses it. `makeCodeTool` returns an ordinary `@langchain/core` tool, so you pass it in the `tools` list of whichever agent you build.

**How long does the sandbox live?** Until the `finally` block in `agent.mjs` disposes it. The script sets no `maxDurationMs`. In your own agent, set `maxDurationMs` in the `createAndWait` options to cap a sandbox's lifetime in case your process exits before it disposes the sandbox.

**When shouldn't I use this?** When you need a notebook-style interpreter that keeps variables between calls, since every call here is a fresh process. When the tool has to hand back files or images, since it returns only text. When the model's code must not reach the network and you haven't set `allowOutbound: false`. When you can't run Node 22 for the agent and don't want to hold `@langchain/openai` at 1.5.8. And if your agent is written in Python, start from [`langchain-python`](../langchain-python/) instead.

## Related

- LangChain.js: https://github.com/langchain-ai/langchainjs
- LangGraph.js: https://github.com/langchain-ai/langgraphjs
- Tenki JavaScript SDK: [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox)
- Tenki docs: https://tenki.cloud/docs
- [`langchain-python`](../langchain-python/): the same `run_python` tool for a LangChain Python agent
- [`run-code-in-a-sandbox`](../run-code-in-a-sandbox/): the bare Tenki SDK loop in Node, with no agent framework
