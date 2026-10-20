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
