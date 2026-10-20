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
