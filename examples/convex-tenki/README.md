# Tenki sandboxes in a Convex app

Give every user of a [Convex](https://www.convex.dev) app its own [Tenki](https://tenki.cloud) microVM. The official [`@tenkicloud/convex`](https://www.npmjs.com/package/@tenkicloud/convex) component creates and drives sandboxes from your Convex actions and keeps each one's state in a Convex table, so your UI updates live as a sandbox goes from `provisioning` to `ready` to `paused` — no polling.

- **One sandbox per identity.** Sandboxes are keyed by `(ownerId, key)`; `create` is safe to retry and to call concurrently, and every call ends up with the same sandbox.
- **Crash-safe.** A `create` that dies mid-flight leaves a tagged session the next call adopts; `destroy` cleans up such orphans too.
- **The API key stays on the server** as a Convex environment variable.

## Install

```bash
npm install @tenkicloud/convex convex
```

Register the component ([`convex/convex.config.ts`](convex/convex.config.ts)):

```ts
import { defineApp } from "convex/server";
import tenki from "@tenkicloud/convex/convex.config.js";

const app = defineApp();
app.use(tenki);

export default app;
```

## Actions: create, run, pause, destroy

The Tenki SDK needs Node.js, so `Tenki` lives in a `"use node"` file ([`convex/sandboxes.ts`](convex/sandboxes.ts)):

```ts
"use node";
import { v } from "convex/values";
import { Tenki } from "@tenkicloud/convex";
import { action, type ActionCtx } from "./_generated/server";
import { components } from "./_generated/api";

const tenki = new Tenki(components.tenki, {
  defaults: { cpuCores: 2, memoryMb: 4096, maxDurationMs: 30 * 60_000 },
  maxActiveSandboxes: 20,
});

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
// save (writeFile), pause and destroy follow the same shape
```

`ownerId` is the only thing separating tenants: always derive it from `ctx.auth`, never from client input. `maxActiveSandboxes` caps spend — `create`, `fork` and `resume` throw `capacity_exceeded` once 20 sandboxes are active across all owners.

## Query: subscribe to the sandbox

Queries read the component's table directly and run in Convex's default runtime ([`convex/sandboxQueries.ts`](convex/sandboxQueries.ts)):

```ts
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

```tsx
const sandbox = useQuery(api.sandboxQueries.mine);
// sandbox?.phase: "provisioning" | "ready" | "pausing" | "paused" | "resuming" | "terminated" | "error"
```

## Keep rows in sync

A sandbox runs for at most `maxDurationMs` per run; at the deadline Tenki pauses it. [`convex/crons.ts`](convex/crons.ts) calls `tenki.reconcile` every 5 minutes ([`convex/maintenance.ts`](convex/maintenance.ts)) so rows catch up with sandboxes that hit their deadline. The next `create` resumes a paused sandbox with its memory and disk intact.

## Run it

```bash
npm install
npx convex dev --once                       # provision a dev deployment and push convex/
npx convex env set TENKI_API_KEY tk_...     # a key from the Tenki dashboard

ID='{"subject":"user-1","issuer":"https://example.test"}'
npx convex run --identity "$ID" sandboxes:start             # phase: "ready"
npx convex run --identity "$ID" sandboxes:run '{"command":"python3 -c \"print(6*7)\""}'   # stdout: "42\n"
npx convex run --identity "$ID" sandboxes:pause             # phase: "paused"
npx convex run --identity "$ID" sandboxes:start             # resumed, phase: "ready"
npx convex run --identity "$ID" sandboxes:destroy           # phase: "terminated"
```

`--identity` stands in for a signed-in user; in an app, wire up any Convex auth provider. `"use node"` actions need a Node version Convex's local deployment supports.

## Verify

```bash
npm install
node verify.mjs
```

No Convex deployment needed: [`verify.mjs`](verify.mjs) uses [`convex-test`](https://www.npmjs.com/package/convex-test) to host the published component's tables and functions in memory, then drives the real `Tenki` class against live Tenki through actions that mirror `convex/sandboxes.ts` — create → row `ready` → exec (`42`) → file round-trip → destroy → row `terminated`.

## Notes

- **Beyond this example:** `spawn`/`processStatus`/`kill` for background processes, `exposePort` for public preview URLs (recorded on the row's `previews`), `extend`, `snapshot`, and `fork` to clone a sandbox under a new key.
- **Errors** are `ConvexError`s with a `code` — e.g. `not_found`, `capacity_exceeded`, `insufficient_credits`, `unauthenticated` (`TENKI_API_KEY` missing or invalid). A failed `create` records `phase: "error"` and `lastError` on the row; the next `create` retries.
- **`exec` limits:** a string command runs under `bash -lc`; output is capped at 1 MiB per stream by default and the timeout at 9 minutes, inside Convex's action limit.
- Component source, full API and a React demo app: [LuxorLabs/tenki-convex](https://github.com/LuxorLabs/tenki-convex).
