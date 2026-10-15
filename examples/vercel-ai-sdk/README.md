# How to run Vercel AI SDK tool calls in a Tenki sandbox

**Audience:** JavaScript developers using the [Vercel AI SDK](https://ai-sdk.dev) 7 who want the shell commands and file reads and writes their model's tools make to happen in a disposable Linux VM, not in their own process.
**Time:** ~5 minutes once you have a Tenki API key and an OpenAI API key.
**Outcome:** a `generateText()` call whose `runCommand` tool runs the model's commands in a [Tenki](https://tenki.cloud) microVM through the AI SDK's `experimental_sandbox` option, plus a passing check of the adapter that needs no model key.

> **Honesty note:** `createTenkiSandbox()` in this example boots its sandbox with outbound network **off** (`allowOutbound: false`), even though the Tenki SDK's own default is on. `pip install` and downloads fail inside the sandbox until you pass `createTenkiSandbox({ allowOutbound: true })`.

## Why bother

AI SDK 7 lets you hand `generateText` a sandbox through `experimental_sandbox`. Each tool then gets that sandbox in its `execute` options and runs commands and file I/O through it. The SDK expects an `Experimental_SandboxSession`: a `description`, `run` and `spawn`, three read methods, and three write methods.

Tenki's official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK already has all of that on its `Session`, so this example is a thin adapter, not a new backend. Copy one file, `tenki-sandbox.mjs`, into your project, install `@tenkicloud/sandbox`, and any AI SDK tool that uses `experimental_sandbox` runs in a fresh Tenki microVM. The microVM boots in about 2 seconds, is billed per second, and is torn down when you call `dispose()`.

## Install

You need Node.js 22 or newer to run `example.mjs`, because `ai` 7 and `@ai-sdk/openai` 4 declare `"node": ">=22"` in their `engines`. `verify.mjs` loads only the adapter and `@tenkicloud/sandbox`, which declares `>=18`, and CI runs it on Node 20.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/vercel-ai-sdk
npm install
```

Every later command runs from this directory.

The dependencies, from `package.json`:

```json
  "dependencies": {
    "@ai-sdk/openai": "^4.0.0",
    "@tenkicloud/sandbox": ">=1.4.1",
    "ai": "^7.0.34",
    "zod": "^4.1.8"
  }
```

The example is built against `ai` 7 and `@ai-sdk/provider-utils` 5, which `ai` installs and which defines `Experimental_SandboxSession`, and against `@tenkicloud/sandbox` 1.4. All of them are on npm, so the example installs clean. The sandbox interface arrived in the `@ai-sdk/provider-utils` 5.0 prereleases, so `ai` 6 and earlier have no `experimental_sandbox` option. `zod` is a peer dependency of `ai` and `@ai-sdk/openai` (`^3.25.76 || ^4.1.8`), and `example.mjs` uses it for the tool's input schema. No lockfile ships, so npm installs the newest release in each range.

## Authenticate

Create a `tk_` API key at https://app.tenki.cloud and export it:

```bash
export TENKI_AUTH_TOKEN=tk_...
```

`createTenkiSandbox()` takes the first key it finds, in this order:

1. an `authToken` option passed to `createTenkiSandbox()`
2. `TENKI_AUTH_TOKEN`
3. `TENKI_API_KEY`, which is what CI sets
4. the `auth_token` line in `~/.config/tenki/config.yaml`, which `tenki login --api-key <key>` writes

Tenki infers your workspace from the key. If you want a specific one, pass `workspaceId` or set `TENKI_WORKSPACE_ID`. The adapter also picks up a `current_workspace_id:` line from `~/.config/tenki/config.yaml` if one is there.

`example.mjs` also needs a model key. It calls OpenAI's `gpt-4o-mini` through `@ai-sdk/openai`, which reads the key from the environment:

```bash
export OPENAI_API_KEY=sk-...
```

To use another provider, install that AI SDK provider's package, replace the `@ai-sdk/openai` import in `example.mjs`, and pass its model in place of `openai("gpt-4o-mini")`. The adapter doesn't depend on the model. `verify.mjs` needs no model key.

## Use it

Run the example:

```bash
node example.mjs
```

This is `example.mjs`:

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

// Boot a disposable Tenki microVM and adapt it to the AI SDK sandbox interface.
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
  await dispose(); // tear the microVM down
}
```

The script boots one microVM with the adapter's defaults: 1 CPU core, 1024 MB of memory, and no outbound network. The `runCommand` tool takes the sandbox from the second argument of `execute`, runs the model's command with `run({ command })`, and returns stdout when the exit code is 0, or the exit code and stderr otherwise. `generateText` passes `sandbox` to every tool call, and `stopWhen: stepCountIs(5)` ends the loop after at most five steps. The script prints the model's final `text`, and the `finally` block disposes the microVM whether the run succeeds or throws.

To use the adapter in your own app:

1. Copy `tenki-sandbox.mjs` into your project and add `@tenkicloud/sandbox`, which it imports, to your dependencies (`npm install @tenkicloud/sandbox`).
2. Call `createTenkiSandbox()` and pass the `sandbox` it returns to `generateText` as `experimental_sandbox`.
3. In each tool's `execute`, read `experimental_sandbox` from the second argument.
4. Call `dispose()` when you're done.

## How the adapter maps onto the AI SDK

`toSandboxSession(session)` in `tenki-sandbox.mjs` maps a live Tenki `Session` onto the AI SDK interface:

| AI SDK `Experimental_SandboxSession` | Tenki `Session` |
| --- | --- |
| `run({ command })` | `session.exec("sh", { args: ["-c", command] })` |
| `spawn({ command })` | `session.run(["sh", "-c", command])` |
| `readTextFile` / `readBinaryFile` | `session.readFile(path)` |
| `readFile` (stream) | `session.readFile(path)` → `ReadableStream` |
| `writeTextFile` / `writeBinaryFile` / `writeFile` | `session.writeFile(path, data)`, after a `mkdir -p` of the parent directory |

`createTenkiSandbox()` adds the lifecycle around `toSandboxSession()`: it boots a microVM and returns `{ sandbox, session, dispose }`.

### Commands go through `sh -c`

The AI SDK passes `run` and `spawn` one command string, but Tenki's `exec` and `run` take a bare argv with no shell splitting. The adapter routes every command through `sh -c` so pipes, `&&`, redirects, and quoting behave the way an agent expects. From `tenki-sandbox.mjs`:

```js
// The AI SDK hands `run`/`spawn` a single command *string*; Tenki's exec/run take
// a bare argv with no shell splitting. Route through `sh -c` so shell syntax
// (pipes, &&, redirects, quoting) behaves the way an agent expects.
const shArgs = (command) => ["-c", command];
```

The two process methods, from the object `toSandboxSession()` returns:

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

`workingDirectory` and `env` pass straight through as Tenki's `cwd` and `env`. `run` returns stdout and stderr trimmed, because the SDK's `stdoutText` and `stderrText` trim them.

### Files live under `/home/tenki`

Tenki confines its file methods to `/home/tenki`, which is the VM's working directory, so use relative paths, which resolve from there. Writes create missing parent directories (`mkdir -p`), as the AI SDK contract requires. Reads resolve to `null` when the file doesn't exist, which is the AI SDK contract. Tenki throws `FileNotFoundError` instead, and the adapter converts it. `readFile` and `writeFile`, the stream variants, hold the whole file in memory: `readFile` reads all of it before it wraps it in a `ReadableStream`, and `writeFile` collects the whole stream before it writes.

### The `description` is yours to surface

The adapter's default `description` says that the working directory is `/home/tenki`, that files should be referenced with relative paths, and that Python 3 and standard Unix tools are available. Override it with `createTenkiSandbox({ description })`. The AI SDK doesn't add `description` to the prompt on its own. It passes the sandbox to each tool's `execute`, and to a tool's `description` when that's a function. `example.mjs` doesn't use it, so if you want the model to know these details, put the text in your system prompt or tool description.

### Tune the VM with `createTenkiSandbox()` options

From `tenki-sandbox.mjs`:

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

So `createTenkiSandbox({ allowOutbound: true })` gives the sandbox network access for `pip install` or fetching, and `createTenkiSandbox({ cpuCores: 4, memoryMb: 4096 })` gives it a bigger VM. It forwards no other create options. For anything else, such as `maxDurationMs`, create the `Session` yourself with `@tenkicloud/sandbox` and wrap it with `toSandboxSession(session)`, which is exported and does no lifecycle of its own.

### Dispose of the sandbox yourself

`createTenkiSandbox()` sets no `maxDurationMs`, so the adapter doesn't choose a lifetime for you, and a Tenki sandbox doesn't pause when it goes idle. Call `dispose()` in a `finally` block, as `example.mjs` does. The returned object also has `[Symbol.asyncDispose]`, so `await using` works too. Top-level `await using` needs Node 24, and Node 22 can't parse it.

## Check it works

```bash
node verify.mjs
```

On success it prints:

```
✓ vercel-ai-sdk: run (42) → file round-trip → missing→null → spawn, on live Tenki
```

`verify.mjs` boots a sandbox through `createTenkiSandbox()` and calls the adapter's `Experimental_SandboxSession` methods directly, the way the AI SDK would. It checks that all nine required members exist, runs `python3 -c 'print(6 * 7)'` with `run` and expects exit code 0 and `42`, writes `work/note.txt` with `writeTextFile` and reads it back with `readTextFile` (the subdirectory also proves parent-directory creation), reads a missing file and expects `null`, and runs `printf 'hi from spawn'` with `spawn`, streaming its stdout and waiting for exit code 0. Then it disposes the microVM. It exits non-zero on any failure.

This proves the adapter satisfies the AI SDK's sandbox surface against a live Tenki sandbox. It never loads `ai` or calls a model, so the `generateText` tool loop in `example.mjs` isn't exercised. This is what CI runs, on Node 20 with only `TENKI_API_KEY` set.

## Troubleshooting

**❌ ``No Tenki token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `createTenkiSandbox()` found no key in its `authToken` option, `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or the `auth_token` line of `~/.config/tenki/config.yaml`. `verify.mjs` prints the same message after `✗ `. Export `TENKI_AUTH_TOKEN=tk_...`, or run `tenki login --api-key <key>`.

**❌ `invalid auth token - API keys and service tokens must start with tk_`.** The key the adapter found isn't a `tk_` API key, and SDK 1.x accepts nothing else. The SDK rejects it before any sandbox is created. Create a key at https://app.tenki.cloud and use that. `TENKI_AUTH_TOKEN` wins over `TENKI_API_KEY`, and both win over the config file, so an old value in `TENKI_AUTH_TOKEN` hides a good key set anywhere else.

**❌ `OpenAI API key is missing. Pass it using the 'apiKey' parameter or the OPENAI_API_KEY environment variable.`** `OPENAI_API_KEY` isn't set in the shell that runs `example.mjs`. The provider reads it on the first model call inside `generateText`, so the sandbox already exists by then, and the `finally` block disposes it. Export the key and run again.

**❌ `pip install` or a download fails inside the sandbox.** `createTenkiSandbox()` boots with `allowOutbound: false`. Network access is a create-time setting in the Tenki SDK, so you can't turn it on for a sandbox that's already running. Pass `createTenkiSandbox({ allowOutbound: true })`.

**❌ A read or write fails with `permission_denied … path outside workdir`.** Every adapter read and write uses the SDK's file methods, which are confined to `/home/tenki`. Use a relative path, which resolves from `/home/tenki`. Commands that `run` or `spawn` execute can write anywhere, but the file methods can read those files back only if they're under `/home/tenki`.

**❌ `✗ sandbox missing members: …`, `✗ run: …`, `✗ file round-trip mismatch: …`, `✗ expected null reading a missing file`, or `✗ spawn: …` from `verify.mjs`.** One of the adapter checks failed against the live sandbox. The message names the step. The `run` and `spawn` messages include the exit code and output that came back, and the round-trip message shows the text that was read. If you changed `tenki-sandbox.mjs`, start with the method the message names.

## FAQ

**Do tool calls share one sandbox?** Yes. `createTenkiSandbox()` boots one microVM, and every tool call in the `generateText` run goes to it. A file one call writes is still there for the next. Each `run` or `spawn` starts a new `sh -c` process, so shell state such as a `cd` or an exported variable doesn't carry over.

**Does it work with `streamText`?** AI SDK 7's `streamText` takes `experimental_sandbox` too and passes it to tool execution the same way. This example runs only `generateText`.

**How long does the sandbox live?** The adapter doesn't choose a lifetime. `createTenkiSandbox()` sets no `maxDurationMs`, and a sandbox doesn't pause when it goes idle, so dispose of it yourself, as `example.mjs` does. To choose a lifetime cap, create the `Session` yourself with `maxDurationMs` and wrap it with `toSandboxSession()`.

**Can the sandbox reach the internet?** Not with this adapter's defaults. Pass `createTenkiSandbox({ allowOutbound: true })`. The Tenki SDK's own default is on; the adapter turns it off.

**When shouldn't I use this?** When you can't build on an experimental API: the AI SDK marks it `experimental_`, and it renamed the interface from `Experimental_Sandbox` to `Experimental_SandboxSession` during the 5.0 prereleases. When you're on `ai` 6 or earlier, which has no `experimental_sandbox`. When your app has to run on Node 20, since `ai` 7 declares `node >=22`. When your tools move large files through `readFile` or `writeFile`, since the adapter holds each whole file in memory. When tool calls must be isolated from each other, since they share one sandbox for the run. And when you need the model loop tested in CI, since CI covers only the adapter methods.

## Related

- Vercel AI SDK: https://ai-sdk.dev
- Tenki JavaScript SDK: [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox)
- [Tenki Sandboxes](https://tenki.cloud), and the docs at https://tenki.cloud/docs
- [`openai-agents-sdk`](../openai-agents-sdk/): a code-execution tool backed by a Tenki sandbox, for the OpenAI Agents SDK
- [`files-in-a-sandbox`](../files-in-a-sandbox/): the Tenki SDK file methods this adapter's reads and writes use
