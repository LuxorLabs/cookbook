# Convex

Give each signed-in user of a [Convex](https://www.convex.dev) app its own Tenki sandbox. The [`@tenkicloud/convex`](https://www.npmjs.com/package/@tenkicloud/convex) component creates, runs commands in, pauses, resumes, and destroys sandboxes from Convex actions, and keeps each sandbox's state in a Convex table your UI can subscribe to.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Add per-user Tenki sandboxes to a Convex app, following https://github.com/LuxorLabs/cookbook/tree/main/examples/convex-tenki.
1. Clone https://github.com/LuxorLabs/cookbook, cd into examples/convex-tenki, and run npm install. (If I want this in my own Convex app instead, install @tenkicloud/convex there and copy the files under convex/.)
2. Run npx convex dev --once to provision a dev deployment. Then the deployment needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud). Ask me to run npx convex env set TENKI_API_KEY myself. Never print the key or write it to a file.
3. Drive a sandbox with the npx convex run --identity commands in the README: start, run, pause, start, destroy. Confirm the run prints 42.
4. Run node verify.mjs (it needs TENKI_API_KEY exported in my shell; if it isn't, ask me to export it) and confirm the ✓ line.
5. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Node.js 20 or later and npm.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- A Convex account for step 3. Step 4 needs no deployment.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/convex-tenki
npm install
```

This installs `@tenkicloud/convex` (`^0.1.1`), `convex` (`^1.46.0`), and, for `verify.mjs`, `convex-test` `0.0.60`. The npm package `convex` includes the CLI, so run it with `npx convex`.

### 2. Set your API key

The actions run on your Convex deployment and read the key from its environment, not your shell:

```bash
npx convex dev --once                       # provision a dev deployment and push convex/
npx convex env set TENKI_API_KEY tk_...
```

For `verify.mjs`, export the key in your shell too: `export TENKI_API_KEY=tk_...` (`TENKI_AUTH_TOKEN` and a `tenki login` key also work).

### 3. Run

```bash
ID='{"subject":"user-1","issuer":"https://example.test"}'
npx convex run --identity "$ID" sandboxes:start             # phase: "ready"
npx convex run --identity "$ID" sandboxes:run '{"command":"python3 -c \"print(6*7)\""}'   # stdout: "42\n"
npx convex run --identity "$ID" sandboxes:pause             # phase: "paused"
npx convex run --identity "$ID" sandboxes:start             # resumed, phase: "ready"
npx convex run --identity "$ID" sandboxes:destroy           # phase: "terminated"
```

`--identity` stands in for a signed-in user. The second `start` resumes the paused sandbox instead of creating a new one, with its memory and disk intact.

### 4. Verify

```bash
node verify.mjs
```

```
✓ convex-tenki: tenki.create → row ready → exec (42) → file round-trip → destroy → row terminated
```

`verify.mjs` hosts the component in memory with `convex-test` and drives live Tenki with your shell's key. It doesn't use your Convex deployment, pause and resume, or the cron. It destroys its sandbox in a `finally` block.

## Add it to your own app

```bash
npm install @tenkicloud/convex convex
```

Register the component in `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import tenki from "@tenkicloud/convex/convex.config.js";

const app = defineApp();
app.use(tenki);

export default app;
```

## The code

### Actions: [`convex/sandboxes.ts`](convex/sandboxes.ts)

The Tenki SDK needs Node.js, so `Tenki` lives in a `"use node"` file:

```ts
"use node";
// The Tenki SDK needs Node.js, so Tenki is constructed and called from a "use node" file.
import { v } from "convex/values";
import { Tenki } from "@tenkicloud/convex";
import { action, type ActionCtx } from "./_generated/server";
import { components } from "./_generated/api";

const tenki = new Tenki(components.tenki, {
  defaults: { cpuCores: 2, memoryMb: 4096, maxDurationMs: 30 * 60_000 },
  maxActiveSandboxes: 20,
});

// ownerId is the only thing separating tenants: derive it from ctx.auth, never from client input.
async function ownerId(ctx: ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  return identity.tokenIdentifier;
}

export const start = action({
  args: {},
  handler: async (ctx) =>
    await tenki.create(ctx, { ownerId: await ownerId(ctx), key: "main" }),
});

export const run = action({
  args: { command: v.string() },
  handler: async (ctx, { command }) =>
    await tenki.exec(ctx, { ownerId: await ownerId(ctx), key: "main", command }),
});

export const save = action({
  args: { path: v.string(), data: v.string() },
  handler: async (ctx, { path, data }) =>
    await tenki.writeFile(ctx, { ownerId: await ownerId(ctx), key: "main", path, data }),
});

export const pause = action({
  args: {},
  handler: async (ctx) =>
    await tenki.pause(ctx, { ownerId: await ownerId(ctx), key: "main" }),
});

export const destroy = action({
  args: {},
  handler: async (ctx) =>
    await tenki.destroy(ctx, { ownerId: await ownerId(ctx), key: "main" }),
});
```

- **`ownerId` is the only thing separating tenants.** Derive it from `ctx.auth`, never from client input. Every action uses the key `"main"`, so each user gets one sandbox.
- `create` is keyed by `(ownerId, key)` and safe to retry or call concurrently. If a `create` dies mid-flight, the next one adopts the sandbox it started.
- `defaults` apply to every `create`. Options passed to one call override them.
- `maxActiveSandboxes` caps spend: `create`, `fork`, and `resume` throw `capacity_exceeded` once 20 sandboxes are active across all owners. Paused sandboxes don't count.
- A string command runs under `bash -lc`. Output is capped at 1 MiB per stream, and the timeout at 9 minutes to fit Convex's action limit. For longer commands, use `spawn` and poll `processStatus`.
- File methods are confined to `/home/tenki`. Relative paths land there.

### Query: [`convex/sandboxQueries.ts`](convex/sandboxQueries.ts)

```ts
// Queries read the component directly and run in Convex's default runtime, so the UI can subscribe.
import { query } from "./_generated/server";
import { components } from "./_generated/api";

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.runQuery(components.tenki.sandboxes.get, {
      ownerId: identity.tokenIdentifier,
      key: "main",
    });
  },
});
```

Subscribe from React with `useQuery`:

```tsx
const sandbox = useQuery(api.sandboxQueries.mine);
// sandbox?.phase: "provisioning" | "ready" | "pausing" | "paused" | "resuming" | "terminated" | "error"
```

`mine` returns `null` for a visitor who isn't signed in.

### Cron: [`convex/crons.ts`](convex/crons.ts) and [`convex/maintenance.ts`](convex/maintenance.ts)

`maxDurationMs` limits each run, not the sandbox's total life. At the deadline Tenki pauses the sandbox, but its row keeps its last known phase. A cron re-reads the 50 least recently updated live sandboxes from Tenki every 5 minutes:

```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("reconcile tenki sandboxes", { minutes: 5 }, internal.maintenance.reconcile);

export default crons;
```

```ts
"use node";
import { Tenki } from "@tenkicloud/convex";
import { internalAction } from "./_generated/server";
import { components } from "./_generated/api";

const tenki = new Tenki(components.tenki);

// Catches rows up with sandboxes Tenki paused at their deadline.
export const reconcile = internalAction({
  args: {},
  handler: async (ctx) => await tenki.reconcile(ctx),
});
```

Step 2 pushed both files, so the cron is already scheduled. Tenki keeps a sandbox it paused at the deadline for 7 days. Change that with the `pauseRetentionMs` create option.

## Things to know

- Two Convex deployments can share one Tenki workspace. Sandbox identities are scoped by a `namespace` that defaults to the deployment's `CONVEX_CLOUD_URL`.
- Each resume starts a new `maxDurationMs` lifetime, so a cap on total life is yours to enforce.
- `readFile` returns at most 16 MiB and Convex caps action arguments at 5 MiB, which limits `writeFile`.
- The component also has `spawn`, `processStatus`, `kill`, `exposePort` (preview URLs recorded on the row), `extend`, `snapshot`, and `fork`. See [LuxorLabs/tenki-convex](https://github.com/LuxorLabs/tenki-convex) for the full API and a React demo.
- If your app isn't on Convex, use [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) directly.

## Troubleshooting

Component errors are `ConvexError`s with a `code`.

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key in your shell. Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `unauthenticated` with `TENKI_API_KEY is not set` | Run `npx convex env set TENKI_API_KEY tk_...`. Otherwise check the key is a valid `tk_` key. |
| `Unauthenticated` from a `sandboxes:*` action | No user identity. Pass `--identity "$ID"` to `npx convex run`, or sign the user in. |
| `capacity_exceeded` | 20 sandboxes are active. Pause or destroy some, or raise `maxActiveSandboxes`. |
| `not_ready` from `sandboxes:run` after a pause | Call `sandboxes:start` first; it resumes the sandbox. |
| Row says `ready` after the deadline | The cron catches it up within 5 minutes, or call `sandboxes:start`. |
| Row's phase is `error` | Fix what `lastError` names (`insufficient_credits` means the workspace balance is empty), then call `sandboxes:start`. |
| `permission_denied … path outside workdir` from `save` | Use a path under `/home/tenki`. |

## Related

- [`@tenkicloud/convex` on npm](https://www.npmjs.com/package/@tenkicloud/convex) and [LuxorLabs/tenki-convex](https://github.com/LuxorLabs/tenki-convex)
- [Run code in a sandbox](../run-code-in-a-sandbox/): the same loop with `@tenkicloud/sandbox` and no Convex
- [Pause, snapshot, and resume](../snapshots-pause-resume/)
