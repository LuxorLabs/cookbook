# How to give each user of your Convex app its own Tenki sandbox

**Audience:** Developers building a [Convex](https://www.convex.dev) app (TypeScript actions on the server, `useQuery` in a React UI) who want each signed-in user to get their own isolated cloud machine.
**Time:** ~10 minutes for the whole walkthrough, ~3 minutes if you only run the verify script.
**Outcome:** A Convex dev deployment whose actions create, run commands in, pause, resume and destroy one [Tenki](https://tenki.cloud) microVM per signed-in user. Each sandbox's state lives in a Convex table that your UI can subscribe to.

> **Honesty note:** `maxDurationMs` limits each run, not the sandbox's total life. At the deadline Tenki pauses the sandbox, and the next `create` resumes it with a new lifetime of the same length. The sandbox's row in Convex keeps its last known phase until something re-reads it from Tenki, which is what the reconcile cron in Step 7 is for.

## Why bother

The official [`@tenkicloud/convex`](https://www.npmjs.com/package/@tenkicloud/convex) component creates and drives sandboxes from your Convex actions and keeps each one's state in a Convex table. Your UI updates live as a sandbox goes from `provisioning` to `ready` to `paused`, through a query subscription, with no polling in the client.

- One sandbox per identity. Sandboxes are keyed by `(ownerId, key)`. `create` is safe to retry and to call concurrently: every call with the same `(ownerId, key)` ends up with the same sandbox.
- Crash-safe. If a `create` dies mid-flight, the sandbox it started is already tagged with its `(ownerId, key)`, so the next `create` for that pair picks it up instead of starting another. `destroy` cleans up such orphans too.
- The API key stays on the server as a Convex environment variable.

## Prerequisites

- Node.js 20 or later and npm (`convex` 1.46 requires Node 20+; CI runs the verify script on Node 20). For the Convex deployment, `"use node"` actions need a Node version that Convex's local deployment supports.
- A Tenki API key. Create one at https://app.tenki.cloud. Keys start with `tk_`.
- Nothing else to install globally: `npm install` adds the Convex CLI (the `convex` package), and you call it with `npx convex`. The Tenki CLI is optional (see Step 8).

If you only want to confirm the component works against your Tenki account, do Steps 1 and 2, then skip to [Step 8](#step-8--check-it-works). The verify script needs no Convex deployment.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/convex-tenki
```

Every later command runs from this directory. The example's code is five files under `convex/`, plus `verify.mjs` and `package.json`:

- `convex/convex.config.ts` registers the component.
- `convex/sandboxes.ts` holds the actions: start, run, save, pause, destroy.
- `convex/sandboxQueries.ts` holds the query your UI subscribes to.
- `convex/crons.ts` and `convex/maintenance.ts` keep rows in sync with Tenki.
- [`verify.mjs`](verify.mjs) checks the component against live Tenki (Step 8).
- `package.json` lists the dependencies Step 2 installs.

## Step 2 — Install

```bash
npm install
```

This installs `@tenkicloud/convex` (`^0.1.1`), `convex` (`^1.46.0`) and, for the verify script only, `convex-test`, pinned to exactly `0.0.60`. The component runs on the Tenki SDK, `@tenkicloud/sandbox` `^1.4.1`, which npm pulls in for you.

To add the component to your own Convex app instead, run this from your app's root, not from this example (the component's peer dependency is `convex` `^1.43.0`):

```bash
npm install @tenkicloud/convex convex
```

Then register it in [`convex/convex.config.ts`](convex/convex.config.ts). The example already has this file:

```ts
import { defineApp } from "convex/server";
import tenki from "@tenkicloud/convex/convex.config.js";

const app = defineApp();
app.use(tenki);

export default app;
```

## Step 3 — Provision a deployment and give it your Tenki key

```bash
npx convex dev --once                       # provision a dev deployment and push convex/
npx convex env set TENKI_API_KEY tk_...     # a key from the Tenki dashboard
```

The `Tenki` class reads `TENKI_API_KEY` from the deployment's environment the first time an action needs it, so the key stays on the server, out of your client code. You can pass `apiKey` to the constructor instead, as `verify.mjs` does.

## Step 4 — Create, run, pause and destroy from actions

The Tenki SDK needs Node.js, so `Tenki` lives in a `"use node"` file. Here is all of [`convex/sandboxes.ts`](convex/sandboxes.ts):

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

What to notice:

- `defaults` apply to every `create`: 2 CPU cores, 4096 MB of memory, and a 30-minute `maxDurationMs`. Options passed to a single `create` call win over them.
- **`ownerId` is the only thing separating tenants.** Always derive it from `ctx.auth`, never from client input. Every action here uses the key `"main"`, so each user gets exactly one sandbox.
- `maxActiveSandboxes` caps spend. `create`, `fork` and `resume` throw `capacity_exceeded` once 20 sandboxes are active across all owners. Paused sandboxes don't count, and creates still in flight do.
- `exec` limits: a string command runs under `bash -lc`. Output is capped at 1 MiB per stream by default, and the timeout is capped at 9 minutes so `exec` fits inside Convex's action limit.
- `save` paths: the SDK's file methods are confined to `/home/tenki`, the sandbox's working directory. A relative path such as `note.txt` lands there.

## Step 5 — Drive a sandbox from the CLI

```bash
ID='{"subject":"user-1","issuer":"https://example.test"}'
npx convex run --identity "$ID" sandboxes:start             # phase: "ready"
npx convex run --identity "$ID" sandboxes:run '{"command":"python3 -c \"print(6*7)\""}'   # stdout: "42\n"
npx convex run --identity "$ID" sandboxes:pause             # phase: "paused"
npx convex run --identity "$ID" sandboxes:start             # resumed, phase: "ready"
npx convex run --identity "$ID" sandboxes:destroy           # phase: "terminated"
```

`--identity` stands in for a signed-in user. In an app, wire up any Convex auth provider.

Pausing keeps the sandbox's memory and disk, and pausing is free. A pause takes tens of seconds. The second `start` resumes the paused sandbox instead of creating a new one, because `create` resumes a paused sandbox for the same `(ownerId, key)`. After `destroy`, the key can be reused.

## Step 6 — Subscribe to the sandbox from your UI

Queries read the component's table directly and run in Convex's default runtime, so the UI can subscribe. Here is all of [`convex/sandboxQueries.ts`](convex/sandboxQueries.ts):

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

In a React component, subscribe with `useQuery`. This snippet is from the component's README:

```tsx
const sandbox = useQuery(api.sandboxQueries.mine);
// sandbox?.phase: "provisioning" | "ready" | "pausing" | "paused" | "resuming" | "terminated" | "error"
```

`mine` returns `null` for a visitor who isn't signed in, so the UI can render that case without an error.

## Step 7 — Keep rows in sync with a cron

A sandbox runs for at most `maxDurationMs` at a time. At the deadline Tenki pauses it, but its row in the component's table keeps its last known phase. [`convex/crons.ts`](convex/crons.ts) runs the reconcile every 5 minutes:

```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("reconcile tenki sandboxes", { minutes: 5 }, internal.maintenance.reconcile);

export default crons;
```

It calls `tenki.reconcile` in [`convex/maintenance.ts`](convex/maintenance.ts):

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

Each run re-reads the least recently updated live sandboxes across all owners from Tenki (50 per run by default) and updates their rows. Step 3 pushed both files with the rest of `convex/`, so the cron is already scheduled on your deployment.

The next `create` resumes a paused sandbox with its memory and disk intact. Tenki keeps a sandbox it paused at the deadline for 7 days, then deletes it. To change that, set `pauseRetentionMs`: it's a `@tenkicloud/sandbox` create option, so it goes in `defaults` or in a `create` call's `options`.

## Step 8 — Check it works

[`verify.mjs`](verify.mjs) reads your Tenki key from your shell or your local Tenki config, not from a Convex deployment:

```js
const apiKey = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
```

Export `TENKI_API_KEY` (or `TENKI_AUTH_TOKEN`) with your `tk_` key. The Tenki CLI is optional: if you have it, you can run `tenki login --api-key <key>` instead, and `cfg("auth_token")` reads the key it stores in `~/.config/tenki/config.yaml`. Then run:

```bash
node verify.mjs
```

On success it prints:

```
✓ convex-tenki: tenki.create → row ready → exec (42) → file round-trip → destroy → row terminated
```

This proves the published component drives live Tenki with your key; it doesn't exercise a Convex deployment, its `TENKI_API_KEY`, a real auth provider, pause/resume, or the reconcile cron. [`convex-test`](https://www.npmjs.com/package/convex-test) hosts the component in memory, and the script defines its own actions that mirror `convex/sandboxes.ts`, with smaller defaults (1 CPU core, 1024 MB, 10 minutes). It destroys its sandbox in a `finally` block even when a check fails.

If a check fails, it prints a line starting with `✗` and exits with code 1.

## Troubleshooting

Errors from the component are `ConvexError`s with a `code`, for example `not_found`, `capacity_exceeded`, `insufficient_credits` or `unauthenticated`.

- ❌ **``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY` or `~/.config/tenki/config.yaml`. Export one of the variables with your `tk_` key, or, if you have the Tenki CLI, run `tenki login --api-key <key>`.
- ❌ **`unauthenticated`.** `TENKI_API_KEY` is missing from the deployment, or it's invalid. If the message says `TENKI_API_KEY is not set`, run `npx convex env set TENKI_API_KEY tk_...`: the actions run on the Convex deployment and read its environment variables, not your shell's. Otherwise check that the value is a `tk_` key from https://app.tenki.cloud.
- ❌ **`Unauthenticated` from a `sandboxes:*` action.** The action ran without a user identity, and `ownerId` in `convex/sandboxes.ts` throws when `ctx.auth` has no user. Pass `--identity "$ID"` to `npx convex run`, or sign the user in through a Convex auth provider.
- ❌ **`capacity_exceeded`.** 20 sandboxes are already active across all owners, the cap set by `maxActiveSandboxes` in `convex/sandboxes.ts`. Pause or destroy sandboxes you don't need, or raise the cap.
- ❌ **`not_ready` from `sandboxes:run` after `sandboxes:pause`.** Commands run only while the row's phase is `ready`, and the error includes the current phase. Call `sandboxes:start` first: `create` resumes a paused sandbox.
- ❌ **The row says `ready` for a sandbox that reached its deadline.** Tenki paused it, and the row keeps its last known phase. The reconcile cron catches it up on a later run: each 5-minute run re-reads the 50 least recently updated live rows, paused ones included. Calling `sandboxes:start` resumes it without waiting for the cron.
- ❌ **The row's phase is `error`.** A failed `create` records `phase: "error"` and `lastError` on the row. Fix what `lastError` names (`insufficient_credits`, for example, means the Tenki workspace's balance is empty), then call `sandboxes:start` again: the next `create` retries.
- ❌ **`save` fails with `permission_denied … path outside workdir`.** The SDK's file methods only reach `/home/tenki`. Use a relative path or one under `/home/tenki`. A shell command sent through `sandboxes:run` can write anywhere.

## FAQ

**When shouldn't I use this?**

- Your app isn't on Convex. The component exists to call Tenki from Convex actions and keep sandbox state in a Convex table, so use [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) directly instead.
- You need a cap on a sandbox's total life enforced for you. Each resume starts a new `maxDurationMs` lifetime, so you have to enforce a total limit yourself.
- You move large files through actions. `readFile` returns at most 16 MiB by default (Convex's limit for a function's return value), and Convex caps action arguments at 5 MiB, which limits what `writeFile` can take.

A command that runs longer than 9 minutes doesn't rule the component out, but `exec` can't wait that long: start it with `spawn` and poll it with `processStatus`.

**Can two Convex deployments share one Tenki workspace?**
Yes. The `Tenki` class scopes sandbox identities by a `namespace`, which defaults to the deployment's `CONVEX_CLOUD_URL`, so deployments never adopt each other's sandboxes. `verify.mjs` passes its own namespace, `cookbook-verify-` plus a timestamp, on every run.

**What else can the component do?**
Beyond this example: `spawn`/`processStatus`/`kill` for background processes, `exposePort` for public preview URLs (recorded on the row's `previews`), `extend`, `snapshot`, and `fork` to clone a sandbox under a new key. The component source, full API and a React demo app are in [LuxorLabs/tenki-convex](https://github.com/LuxorLabs/tenki-convex).

## Related

- [`@tenkicloud/convex` on npm](https://www.npmjs.com/package/@tenkicloud/convex) and its source, [LuxorLabs/tenki-convex](https://github.com/LuxorLabs/tenki-convex)
- [Convex](https://www.convex.dev) and [`convex-test`](https://www.npmjs.com/package/convex-test)
- [Tenki docs](https://tenki.cloud/docs)
- [`../run-code-in-a-sandbox/`](../run-code-in-a-sandbox/): the create, run, destroy loop with `@tenkicloud/sandbox` and no Convex
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/): pause, resume and snapshots with the SDK directly
