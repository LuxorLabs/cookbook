# Tenki as the Vercel AI SDK's sandbox

Give a [Vercel AI SDK](https://ai-sdk.dev) agent a real place to run code: wire its
`experimental_sandbox` to a disposable [Tenki](https://tenki.cloud) microVM. When the
model calls a code-execution tool, the command runs in a fresh Tenki **Sandbox** — boot
~2s, per-second billing, torn down when you're done.

The AI SDK's `experimental_sandbox` takes an `Experimental_SandboxSession` — an object with
`run` / `spawn`, file read/write methods, and a `description`. Tenki's official
[`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK already has all
of that on its `Session`, so this example is a **thin adapter**, not a new backend.

## The adapter (`tenki-sandbox.mjs`)

`toSandboxSession(session)` maps a live Tenki `Session` onto the AI SDK interface:

| AI SDK `SandboxSession`            | Tenki `Session`                              |
| ---------------------------------- | -------------------------------------------- |
| `run({ command })`                 | `session.exec("sh", { args: ["-c", command] })` |
| `spawn({ command })`               | `session.run(["sh", "-c", command])`         |
| `readTextFile` / `readBinaryFile`  | `session.readFile(path)`                     |
| `readFile` (stream)                | `session.readFile(path)` → `ReadableStream`  |
| `writeTextFile` / `writeBinaryFile` / `writeFile` | `session.writeFile(path, data)` (parents `mkdir -p`'d) |

`createTenkiSandbox()` adds the lifecycle around `toSandboxSession()`: it boots a microVM and returns
`{ sandbox, session, dispose }`.

## The minimal integration (`example.mjs`)

```js
import { generateText, tool, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { createTenkiSandbox } from "./tenki-sandbox.mjs";

const { sandbox, dispose } = await createTenkiSandbox();

// The tool reads the sandbox from `experimental_sandbox` and runs the model's command in Tenki.
const runCommand = tool({
  description: "Run a shell command in a Linux sandbox and return its stdout/stderr.",
  inputSchema: z.object({ command: z.string() }),
  execute: async ({ command }, { experimental_sandbox }) => {
    const { exitCode, stdout, stderr } = await experimental_sandbox.run({ command });
    return exitCode === 0 ? stdout : `exit ${exitCode}\n${stderr}`;
  },
});

const { text } = await generateText({
  model: openai("gpt-4o-mini"),
  tools: { runCommand },
  experimental_sandbox: sandbox, // ← Tenki is the AI SDK's sandbox
  stopWhen: stepCountIs(5),
  prompt: "Compute the 20th Fibonacci number with Python, then tell me the result.",
});
console.log(text);
await dispose();
```

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...   # from `tenki login` (~/.config/tenki/config.yaml)
export OPENAI_API_KEY=...     # or swap openai() for any AI SDK provider
node example.mjs
```

## Verify the integration (no LLM needed)

```bash
npm install
node verify.mjs        # or: TENKI_AUTH_TOKEN=... node verify.mjs
```

`verify.mjs` calls the adapter's `Experimental_SandboxSession` methods directly against a live
Tenki sandbox: `run` (expects 42), a `writeTextFile`/`readTextFile` round-trip, a read of a
missing file (expects `null`), and `spawn`. Then it disposes the microVM. No model key required. This is what CI runs.

## Notes

- **`run`/`spawn` take one command string.** The AI SDK passes a single `command` string, but Tenki's
  `session.exec`/`session.run` take a bare argv with no shell splitting, so the adapter
  routes through `sh -c` to preserve pipes, `&&`, redirects, and quoting.
- **Files live under `/home/tenki`.** Tenki confines file I/O there; use **relative paths**,
  which resolve from the VM's working directory (`/home/tenki`). Writes create missing parent
  directories (`mkdir -p`), per the AI SDK contract.
- **Network is off by default.** For `pip install` or fetching, boot with outbound enabled:
  `createTenkiSandbox({ allowOutbound: true })`. Tune the VM the same way:
  `createTenkiSandbox({ cpuCores: 4, memoryMb: 4096 })`.
- **Versions:** built against `ai@7` / `@ai-sdk/provider-utils@5` (`Experimental_SandboxSession`)
  and `@tenkicloud/sandbox@1.4`. Both are on npm — this example installs clean.
- Products used: [Tenki Sandboxes](https://tenki.cloud). Adapter + SDK:
  [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox).
