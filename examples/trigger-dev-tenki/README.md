# Trigger.dev

Run untrusted or agent-written code from [Trigger.dev](https://trigger.dev) tasks in [Tenki sandboxes](https://tenki.cloud) instead of on the Trigger.dev worker. A Trigger.dev worker is a long-running Node.js process with your environment variables in it; each Tenki sandbox is a separate microVM that you create, use, and close from the task.

The example has three tasks:

- `run-in-sandbox`: a plain `task()` that runs a command in a fresh sandbox and returns the output.
- `code-agent`: a `chat.agent()` with an AI SDK `executeCode` tool, following Trigger.dev's [code execution sandbox](https://trigger.dev/docs/ai-chat/patterns/code-sandbox) pattern.
- `pause-during-wait`: pauses the sandbox across a `wait.for()`, so neither the run nor the sandbox is billed for compute while it waits.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Trigger.dev" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/trigger-dev-tenki, and run npm install (Node.js 22 or later).
2. node verify.mjs needs a Tenki API key (starts with tk_) in TENKI_API_KEY. If it isn't set, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it to a file.
3. Run node verify.mjs and confirm the ✓ line.
4. To run the tasks on Trigger.dev, ask me for my Trigger.dev project ref and put it in trigger.config.ts, then ask me to add TENKI_API_KEY (and OPENAI_API_KEY for code-agent) to a .env file myself. Run npm run dev and trigger run-in-sandbox with the command in the README.
5. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Node.js 22 or later. `verify.mjs` alone runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- For step 3 only: a [Trigger.dev](https://cloud.trigger.dev) project, and an OpenAI API key for `code-agent`.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/trigger-dev-tenki
npm install
```

This installs `@trigger.dev/sdk` and the `trigger.dev` CLI (both `4.8.2`), `@tenkicloud/sandbox`, and the AI SDK.

### 2. Set your API key

Tasks read the key from the Trigger.dev environment, not from your app. For `npm run dev`, the CLI loads `.env` from the project directory:

```bash
TENKI_API_KEY=tk_...
OPENAI_API_KEY=sk-...   # code-agent only
```

For `verify.mjs`, export the key in your shell instead: `export TENKI_API_KEY=tk_...` (`TENKI_AUTH_TOKEN` and a `tenki login --api-key <key>` key also work). `TENKI_WORKSPACE_ID` is optional.

### 3. Run

Set `project` in [`trigger.config.ts`](trigger.config.ts) to your project ref, then:

```bash
npm run dev    # trigger dev: logs in, registers the tasks, runs them locally
```

In a second terminal:

```bash
npx trigger tasks trigger run-in-sandbox --payload '{"command":"python3 -c \"print(6*7)\""}' --wait
```

The task returns `{ "exitCode": 0, "stdout": "42\n", "stderr": "" }`. Trigger `pause-during-wait` from the dashboard or the same command with a `{ "setup": "...", "after": "..." }` payload. `code-agent` takes messages from a chat frontend; see Trigger.dev's [AI chat docs](https://trigger.dev/docs/ai-chat/overview) for `useChat` with the Trigger.dev transport.

This step was not run for this example: it needs a Trigger.dev account and project. Step 4 covers the Tenki side.

### 4. Verify

```bash
node verify.mjs
```

```text
✓ trigger-dev-tenki: tsc → task exec (42) → executeCode ×2 on one run sandbox (12) → dispose → pause → resume (marker kept)
```

`verify.mjs` typechecks the task files against the installed `@trigger.dev/sdk` types (`tsc --noEmit`), then calls the helpers in [`src/tenki.mjs`](src/tenki.mjs) that the tasks call, against live Tenki: the `run-in-sandbox` body, two `executeCode` calls sharing one run-scoped sandbox followed by the `onChatSuspend` dispose, and pause, then resume by id with a file kept in `/home/tenki`. It needs no Trigger.dev account and no model key, and it closes every sandbox it opens. It does not run the Trigger.dev runtime, `wait.for()`, or a model.

## The code

### A task that runs a command: [`src/trigger/run-in-sandbox.ts`](src/trigger/run-in-sandbox.ts)

```ts
export const runInSandbox = task({
  id: "run-in-sandbox",
  maxDuration: 600, // seconds of compute for this run
  retry: { maxAttempts: 2 }, // a retried attempt boots a fresh sandbox
  run: async (payload: { command: string }) => {
    const sandbox = await createSandbox();
    try {
      return await runCommand(sandbox, payload.command);
    } finally {
      await sandbox.close();
    }
  },
});
```

`finally` closes the sandbox whether the command succeeds or the task throws. A retry runs `run` again from the top, so each attempt gets its own sandbox. If the run is killed before `finally` (the worker crashes, or the run exceeds `maxDuration`), the limits set in `createSandbox` apply:

```js
export function createSandbox({ maxDurationMs = 15 * 60_000, pauseRetentionMs = 60 * 60_000 } = {}) {
  return tenki().createAndWait({
    cpuCores: 1,
    memoryMb: 1024,
    maxDurationMs,
    pauseRetentionMs,
    workspaceId: process.env.TENKI_WORKSPACE_ID,
  });
}
```

When `maxDurationMs` of running time is used up, Tenki pauses the sandbox. A paused sandbox is kept for `pauseRetentionMs` (7 days if you don't set it).

`runCommand` wraps the command in `sh -c`, because `exec()` takes an argv and does no shell splitting.

### A chat agent with a code tool: [`src/trigger/code-agent.ts`](src/trigger/code-agent.ts)

```ts
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
  onTurnStart: async ({ runId }) => {
    sandboxRun.init({ runId });
    warmSandbox(runId);
  },
  onChatSuspend: async ({ runId }) => {
    await disposeSandbox(runId);
  },
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
```

- `warmSandbox` stores the `createAndWait` promise in a `Map` keyed by run id and returns without awaiting it, so the sandbox boots while the model generates. `executeCode` awaits that promise, so every tool call in the run uses the same sandbox and sees files from earlier calls.
- Tool `execute` functions don't receive hook payloads, so `chat.local` carries the run id to the tool.
- `onChatSuspend` fires right before the run suspends to wait for the next message. Closing the sandbox there, not in `onTurnComplete`, keeps it available during the idle window after a turn. The next turn's `onTurnStart` boots a new one. `onComplete` covers runs that end without suspending.
- Keep this file and `src/tenki.mjs` in task code. Your web app should import only the task type.

To keep sandbox files across turns, pause in `onChatSuspend` and resume in `onTurnStart` instead, as `pause-during-wait` does.

### Pause across a wait: [`src/trigger/pause-during-wait.ts`](src/trigger/pause-during-wait.ts)

```ts
let sandbox = await createSandbox({ pauseRetentionMs: 2 * 60 * 60_000 });
try {
  await runCommand(sandbox, payload.setup);

  const id = await pauseSandbox(sandbox);
  await wait.for({ hours: 1 });
  sandbox = await resumeSandbox(id);

  return await runCommand(sandbox, payload.after);
} finally {
  await sandbox.close();
}
```

During a `wait.for()` longer than a minute, Trigger.dev checkpoints the run and frees its machine. `pauseSandbox` calls `pause()` and `waitPaused()`; Tenki snapshots the VM's memory and disk and stops it. After the wait, `resumeSandbox` looks the sandbox up by id with `tenki.get(id)` and calls `resume()` and `waitResumed()`. Processes and files under `/home/tenki` survive; `/tmp` is cleared. Set `pauseRetentionMs` longer than the wait, or the paused sandbox is gone when the run comes back. In testing, time spent paused did not count toward `maxDurationMs`.

## Deploy

```bash
npx trigger env set TENKI_API_KEY tk_... --secret --env prod
npx trigger env set OPENAI_API_KEY sk-... --secret --env prod
npm run deploy
```

You can also add the variables on the project's Environment Variables page, or sync them from a secrets manager with the [`syncEnvVars`](https://trigger.dev/docs/deploy-environment-variables#using-the-syncenvvars-build-extension) build extension. `@tenkicloud/sandbox` is plain JavaScript (Connect RPC and `ws`), so `trigger.config.ts` needs no build extension or `external` entry for it. The deploy was not run for this example. The task files bundle with esbuild, which `trigger.dev` uses for builds, without warnings.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` in a run | The Trigger.dev environment has no key. Add `TENKI_API_KEY` to `.env` for dev, or to the deployed environment. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `Project not found: <your project ref>` | Set `project` in `trigger.config.ts` to the ref from your project settings. |
| `tsc --noEmit failed` from `verify.mjs` | The task files don't match the installed `@trigger.dev/sdk` types. Run `npm run typecheck` to see the errors. |
| `executeCode` reads a file an earlier turn wrote and gets `No such file` | The sandbox is closed in `onChatSuspend`, so files last one turn. Pause and resume instead (see above). |

## Notes

- `maxDurationMs` pauses a sandbox when it runs out; it doesn't terminate it. Set `pauseRetentionMs` too, so a sandbox left behind by a crashed worker isn't kept for the default 7 days.
- Outbound network is on by default. Pass `allowOutbound: false` to `createAndWait` for code that shouldn't reach the internet.
- `chat.agent`, `chat.local`, and `onChatSuspend` are in `@trigger.dev/sdk` `4.8.2`, the version this example was typechecked against.

## Related

- [Trigger.dev: code execution sandbox](https://trigger.dev/docs/ai-chat/patterns/code-sandbox)
- [Trigger.dev: wait for](https://trigger.dev/docs/wait-for)
- [Pause, snapshot, and resume](../snapshots-pause-resume/)
- [Vercel AI SDK](../vercel-ai-sdk/): Tenki as the AI SDK's sandbox
- [Covalent](../covalent-tenki/): each workflow task in its own sandbox
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox)
