/**
 * Proves the pyramid works against the live API with the scripted brain (no model key):
 * 85 agents split "Count the primes in [0, 10000000)" three levels deep, every agent runs code
 * in a sandbox of its own, the root's answer is 664579, and every sandbox is terminated.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { runPyramid } from "./pyramid.mjs";
import { scriptedBrain } from "./scripted.mjs";

const cfg = (key) => {
	try {
		return (readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8").match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};
const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const events = [];
const t0 = Date.now();
try {
	const root = await runPyramid({ tenki: new TenkiSandbox({ authToken }), brain: scriptedBrain, prompt: "Count the primes in [0, 10000000).", workspaceId, emit: (e) => events.push(e) });
	const agents = new Set(events.map((e) => e.id)).size;
	const ready = events.filter((e) => e.box === "ready").length;
	const gone = events.filter((e) => e.box === "gone").length;
	const leaves = events.filter((e) => e.level === 3 && e.state === "waiting").length;
	const check = (ok, what) => {
		if (!ok) throw new Error(what);
	};
	check(root.answer === "664579", `root answered ${JSON.stringify(root.answer)}, expected 664579`);
	check(agents === 85, `${agents} agents, expected 85`);
	check(leaves === 64, `${leaves} bottom-level agents, expected 64`);
	check(ready === 85, `${ready} sandboxes booted, expected one per agent`);
	check(gone === ready, `${ready - gone} sandboxes were not terminated`);
	check(!events.some((e) => e.state === "failed"), "an agent failed");
	console.log(`✓ agent-pyramid-tenki: 85 agents, 85 sandboxes, root answer 664579, all terminated (${Math.round((Date.now() - t0) / 1000)} s)`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
}
