# Vercel AI SDK

Use a Tenki sandbox as the [Vercel AI SDK](https://ai-sdk.dev)'s `experimental_sandbox`. AI SDK 7 passes that sandbox to every tool's `execute`, so tools run commands and file I/O in it. `tenki-sandbox.mjs` is a thin adapter from Tenki's `Session` to the SDK's `Experimental_SandboxSession`. Copy that one file into your project.

The adapter boots sandboxes with outbound network off. Pass `createTenkiSandbox({ allowOutbound: true })` if tools need `pip install` or downloads.

## Quick start

You need:

- Node.js 22 or later for `example.mjs` (`ai` 7 requires it). `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An OpenAI API key, for the model call in `example.mjs` only.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/vercel-ai-sdk
npm install
```

This installs `ai` 7, `@ai-sdk/openai` 4, `@tenkicloud/sandbox` 1.4.1 or later, and `zod`. `ai` 6 and earlier have no `experimental_sandbox`.

### 2. Set your keys

```bash
export TENKI_AUTH_TOKEN=tk_...
export OPENAI_API_KEY=sk-...
```

`createTenkiSandbox()` uses the first key it finds: its `authToken` option, `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, then the key saved by `tenki login --api-key <key>`. For a specific workspace, pass `workspaceId` or set `TENKI_WORKSPACE_ID`.

### 3. Run

```bash
node example.mjs
```

The model uses the `runCommand` tool to compute the 20th Fibonacci number with Python in the sandbox and prints its answer.

### 4. Verify

```bash
node verify.mjs
```

```
✓ vercel-ai-sdk: run (42) → file round-trip → missing→null → spawn, on live Tenki
```

`verify.mjs` calls the adapter's methods directly, as the AI SDK would. It checks all nine required members, runs `python3` with `run`, writes and reads `work/note.txt` (which also tests parent-directory creation), expects `null` for a missing file, and streams output from `spawn`. It doesn't load `ai` or call a model.

## Use it in your app

1. Copy `tenki-sandbox.mjs` into your project and `npm install @tenkicloud/sandbox`.
2. Call `createTenkiSandbox()` and pass the returned `sandbox` to `generateText` (or `streamText`) as `experimental_sandbox`.
3. In each tool's `execute`, read `experimental_sandbox` from the second argument.
4. Call `dispose()` in a `finally` block.

`example.mjs`:

```js
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
```

To use another provider, install its AI SDK package and swap `openai("gpt-4o-mini")` for its model.

## How the adapter works

`toSandboxSession(session)` maps a Tenki `Session` onto the AI SDK interface:

| AI SDK `Experimental_SandboxSession` | Tenki `Session` |
| --- | --- |
| `run({ command })` | `session.exec("sh", { args: ["-c", command] })` |
| `spawn({ command })` | `session.run(["sh", "-c", command])` |
| `readTextFile` / `readBinaryFile` | `session.readFile(path)` |
| `readFile` (stream) | `session.readFile(path)` → `ReadableStream` |
| `writeTextFile` / `writeBinaryFile` / `writeFile` | `session.writeFile(path, data)`, after a `mkdir -p` of the parent directory |

- **Commands run through `sh -c`.** The AI SDK passes a command string; Tenki's `exec` and `run` take an argv. Routing through `sh -c` makes pipes, `&&`, redirects, and quoting work. `workingDirectory` and `env` pass through as `cwd` and `env`. Aborting the SDK's signal kills a spawned process.
- **Files live under `/home/tenki`.** Use relative paths. Writes create missing parent directories. Reads return `null` for a missing file (the adapter converts Tenki's `FileNotFoundError`). The stream variants hold the whole file in memory.
- **The `description` isn't sent to the model automatically.** The default says the working directory is `/home/tenki` and that Python 3 and Unix tools are available. Put that in your system prompt or tool description if the model needs it. Override it with `createTenkiSandbox({ description })`.
- **Tool calls share one sandbox.** Files persist across calls. Shell state such as `cd` or exported variables doesn't, because each call starts a new `sh -c`.

```js
    // ---- processes ----
    run: async ({ command, workingDirectory, env, abortSignal }) => {
      const res = await session.exec("sh", { args: shArgs(command), cwd: workingDirectory, env, signal: abortSignal });
      return { exitCode: res.exitCode, stdout: stdoutText(res), stderr: stderrText(res) };
    },

    spawn: async ({ command, workingDirectory, env, abortSignal }) => {
      const handle = session.run(["sh", ...shArgs(command)], { cwd: workingDirectory, env });
      // Aborting the AI SDK signal terminates the running process.
      abortSignal?.addEventListener("abort", () => void handle.kill(), { once: true });
      const pid = await handle.pid.catch(() => undefined);
      return {
        pid,
        stdout: handle.stdout, // ReadableStream<Uint8Array>
        stderr: handle.stderr,
        wait: async () => ({ exitCode: (await handle).exitCode }),
        kill: async () => void (await handle.kill()),
      };
    },
```

## Options and lifetime

```js
export async function createTenkiSandbox(options = {}) {
  const authToken = options.authToken || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
  const workspaceId = options.workspaceId || process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id");
  if (!authToken) throw new Error("No Tenki token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");

  const client = new TenkiSandbox({ authToken });
  const session = await client.createAndWait({
    cpuCores: options.cpuCores ?? 1,
    memoryMb: options.memoryMb ?? 1024,
    allowOutbound: options.allowOutbound ?? false, // set true for pip/network
    workspaceId,
  });

  const sandbox = toSandboxSession(session, { description: options.description });
  const dispose = () => session[Symbol.asyncDispose]();
  return { sandbox, session, dispose, [Symbol.asyncDispose]: dispose };
}
```

`createTenkiSandbox()` accepts `cpuCores`, `memoryMb`, `allowOutbound`, `authToken`, `workspaceId`, and `description`. For other create options, such as `maxDurationMs`, create the `Session` yourself and wrap it with the exported `toSandboxSession(session)`.

The adapter sets no lifetime cap, and Tenki sandboxes don't pause when idle, so always call `dispose()`. The returned object also supports `await using` on Node 24 and later.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No Tenki token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | Export `TENKI_AUTH_TOKEN` or run `tenki login --api-key <key>`. |
| `invalid auth token - API keys and service tokens must start with tk_` | Use a `tk_` key from [app.tenki.cloud](https://app.tenki.cloud). A stale `TENKI_AUTH_TOKEN` hides a good `TENKI_API_KEY`. |
| `OpenAI API key is missing` | Export `OPENAI_API_KEY`. The sandbox is already disposed by the `finally` block. |
| `pip install` or a download fails | Pass `createTenkiSandbox({ allowOutbound: true })`. Network can't be turned on after create. |
| `permission_denied … path outside workdir` | Use a relative path under `/home/tenki`. |
| `✗ sandbox missing members`, `✗ run`, `✗ spawn`, or `✗ file round-trip mismatch` | An adapter check failed. If you changed `tenki-sandbox.mjs`, start with the method named. |

`experimental_sandbox` is experimental in the AI SDK; its interface was renamed from `Experimental_Sandbox` during the 5.0 prereleases.

## Related

- [Vercel AI SDK](https://ai-sdk.dev)
- [OpenAI Agents SDK](../openai-agents-sdk/): a code-execution tool backed by a Tenki sandbox
- [Work with files](../files-in-a-sandbox/): the file methods the adapter uses
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
