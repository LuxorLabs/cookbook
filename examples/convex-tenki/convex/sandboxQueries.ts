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
