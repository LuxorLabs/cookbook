/**
 * Runs the published @tenkicloud/convex component against live Tenki, with no Convex
 * deployment: convex-test hosts the component's tables and functions in memory, and the
 * actions below mirror convex/sandboxes.ts. create → row is "ready" → exec (42) →
 * writeFile/readFile → destroy → row is "terminated".
 * Token from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
import { convexTest } from "convex-test";
import { actionGeneric as action, anyApi, componentsGeneric, defineSchema, queryGeneric as query } from "convex/server";
import { v } from "convex/values";
import { Tenki } from "@tenkicloud/convex";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const apiKey = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
if (!apiKey) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const dir = new URL("./node_modules/@tenkicloud/convex/dist/component/", import.meta.url);
const componentModules = Object.fromEntries(
	["_generated/api.js", "_generated/server.js", "sandboxes.js", "schema.js", "convex.config.js"].map((f) => [`./${f}`, () => import(new URL(f, dir))]),
);
const components = componentsGeneric();
const tenki = new Tenki(components.tenki, {
	apiKey,
	namespace: `cookbook-verify-${Date.now().toString(36)}`,
	defaults: { cpuCores: 1, memoryMb: 1024, maxDurationMs: 10 * 60_000 },
});

const ownerId = async (ctx) => (await ctx.auth.getUserIdentity()).tokenIdentifier;
const sandboxes = {
	start: action({ args: {}, handler: async (ctx) => await tenki.create(ctx, { ownerId: await ownerId(ctx), key: "main" }) }),
	run: action({ args: { command: v.string() }, handler: async (ctx, { command }) => await tenki.exec(ctx, { ownerId: await ownerId(ctx), key: "main", command }) }),
	save: action({ args: { path: v.string(), data: v.string() }, handler: async (ctx, a) => await tenki.writeFile(ctx, { ownerId: await ownerId(ctx), key: "main", ...a }) }),
	load: action({ args: { path: v.string() }, handler: async (ctx, { path }) => await tenki.readFile(ctx, { ownerId: await ownerId(ctx), key: "main", path }) }),
	destroy: action({ args: {}, handler: async (ctx) => await tenki.destroy(ctx, { ownerId: await ownerId(ctx), key: "main" }) }),
};
const sandboxQueries = {
	mine: query({ args: {}, handler: async (ctx) => await ctx.runQuery(components.tenki.sandboxes.get, { ownerId: await ownerId(ctx), key: "main" }) }),
};

const t = convexTest(defineSchema({}), {
	"./_generated/api.js": async () => ({}),
	"./sandboxes.js": async () => sandboxes,
	"./sandboxQueries.js": async () => sandboxQueries,
});
t.registerComponent("tenki", (await import(new URL("schema.js", dir))).default, componentModules);
const user = t.withIdentity({ subject: "verify-user" });
const api = anyApi;

let started = false;
try {
	const created = await user.action(api.sandboxes.start, {});
	started = true;
	const row = await user.query(api.sandboxQueries.mine, {});
	if (row?.phase !== "ready" || row.sessionId !== created.sessionId) throw new Error(`row after create: ${JSON.stringify(row)}`);

	const r = await user.action(api.sandboxes.run, { command: "python3 -c 'print(6 * 7)'" });
	if (!(r.exitCode === 0 && r.stdout.trim() === "42")) throw new Error(`exec: exit ${r.exitCode}, stdout ${JSON.stringify(r.stdout)}, stderr ${JSON.stringify(r.stderr)}`);

	await user.action(api.sandboxes.save, { path: "note.txt", data: "written from a Convex action\n" });
	const back = await user.action(api.sandboxes.load, { path: "note.txt" });
	if (back !== "written from a Convex action\n") throw new Error(`file round-trip mismatch: ${JSON.stringify(back)}`);

	await user.action(api.sandboxes.destroy, {});
	started = false;
	const after = await user.query(api.sandboxQueries.mine, {});
	if (after?.phase !== "terminated") throw new Error(`row after destroy: ${JSON.stringify(after)}`);

	console.log("✓ convex-tenki: tenki.create → row ready → exec (42) → file round-trip → destroy → row terminated");
} catch (e) {
	console.error("✗ " + (e?.data ? JSON.stringify(e.data) : e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (started) await user.action(api.sandboxes.destroy, {}).catch(() => {});
}
