// Give a prompt to the agent pyramid and watch it in 3D. Each agent splits its prompt into up to
// 4 prompts for sub-agents, three levels deep, so up to 1 + 4 + 16 + 64 = 85 agents, each with a
// sandbox of its own to run code in. Open the printed URL while it runs.
//   node run.mjs "your prompt"   a model splits and answers (OPENAI_API_KEY or OPENROUTER_API_KEY)
//   node run.mjs --offline       the scripted brain counts primes below 10,000,000, no model key
//   node run.mjs --replay        replay the last run in the viewer without creating sandboxes
//   node run.mjs --no-viz        no viewer; exit when done
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pickBrain, runPyramid } from "./pyramid.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const fanout = Number(process.env.FANOUT || 4);
const depth = Number(process.env.DEPTH || 3);
const port = Number(process.env.PORT || 4321);
const OUT = new URL("out/", import.meta.url).pathname;

// Every event goes to the viewer; a viewer that opens late gets the history first.
const events = [];
const clients = new Set();
let finished = null;
const send = (res, ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
const end = (res, msg) => res.write(`event: end\ndata: ${msg}\n\n`);
const replay = has("--replay") ? JSON.parse(readFileSync(join(OUT, "run.json"), "utf8")) : null;

if (!has("--no-viz")) {
	createServer((req, res) => {
		if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(readFileSync(new URL("pyramid.html", import.meta.url)));
		if (req.url !== "/events") return res.writeHead(404).end();
		res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
		if (replay) {
			const t0 = replay.events[0].t;
			const timers = replay.events.map((ev) => setTimeout(() => send(res, ev), ev.t - t0));
			timers.push(setTimeout(() => end(res, `replay of ${replay.when}`), replay.events.at(-1).t - t0 + 300));
			return req.on("close", () => timers.forEach(clearTimeout));
		}
		events.forEach((ev) => send(res, ev));
		if (finished) return end(res, finished);
		clients.add(res);
		req.on("close", () => clients.delete(res));
	}).listen(port, () => console.log(`3D view: http://localhost:${port}`));
}

if (replay) {
	console.log("replaying the last run; Ctrl-C to quit");
} else {
	const cfg = (k) => {
		try {
			return readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8").match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim();
		} catch {}
	};
	const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
	if (!authToken) throw new Error("No Tenki key. Export TENKI_AUTH_TOKEN, or run `tenki login`.");
	const tenki = new TenkiSandbox({ authToken });
	const brain = await pickBrain({ offline: has("--offline") });
	const prompt = args.find((a) => !a.startsWith("--")) || "Count the primes in [0, 10000000).";
	const most = Array.from({ length: depth + 1 }, (_, i) => fanout ** i).reduce((a, b) => a + b);
	console.log(`brain: ${brain.name}\nprompt: ${prompt}\nup to ${most} agents (split by up to ${fanout}, ${depth} levels deep), each with its own sandbox`);

	// Ctrl-C mid-run: terminate the sandboxes that are still up before exiting.
	const live = new Map();
	process.once("SIGINT", async () => {
		console.log(`\nstopping: terminating ${live.size} sandboxes`);
		await Promise.allSettled([...live.keys()].map(async (id) => (await tenki.get(id))[Symbol.asyncDispose]()));
		process.exit(130);
	});

	const ids = new Set();
	let sandboxes = 0, runs = 0, peak = 0;
	const emit = (ev) => {
		ids.add(ev.id);
		if (ev.box === "ready") (live.set(ev.sandboxId, ev.id), sandboxes++, (peak = Math.max(peak, live.size)));
		if (ev.box === "gone") for (const [s, a] of live) if (a === ev.id) live.delete(s);
		if (ev.state === "running") runs++;
		events.push(ev);
		clients.forEach((c) => send(c, ev));
		if (ev.state === "failed") console.log(`failed  ${ev.id}  ${String(ev.detail).split("\n")[0]}`);
		if (ev.state === "passed" && ev.id.split(".").length <= 2) console.log(`${ev.id.padEnd(5)} ${String(ev.answer).split("\n")[0].slice(0, 100)}`);
	};
	const started = Date.now();
	let root;
	try {
		root = await runPyramid({ tenki, brain, prompt, fanout, depth, workspaceId: process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id"), emit });
	} catch (e) {
		console.error(`✗ ${e?.message ?? e}`);
		process.exit(1);
	}
	const agents = ids.size;
	const secs = Math.round((Date.now() - started) / 1000);
	mkdirSync(OUT, { recursive: true });
	const md = (n, d = 0) => `${"#".repeat(Math.min(d + 2, 6))} ${n.title}\n\n> ${n.prompt.replace(/\n/g, "\n> ")}\n\n${n.answer}\n\n${n.children.map((c) => md(c, d + 1)).join("")}`;
	writeFileSync(join(OUT, "answer.md"), `# ${prompt}\n\n${root.answer}\n\n---\n\n${root.children.map((c) => md(c)).join("")}`);
	writeFileSync(join(OUT, "run.json"), JSON.stringify({ when: new Date().toISOString(), prompt, answer: root.answer, agents, sandboxes, runs, events }, null, 1));
	finished = `${agents} agents, ${sandboxes} sandboxes (${peak} at once), ${runs} code runs, ${secs} s`;
	console.log(`\nanswer: ${root.answer}\n${finished}\nevery agent's prompt and answer: out/answer.md`);
	clients.forEach((c) => end(c, finished));
	if (has("--no-viz")) process.exit(0);
	console.log(`the 3D view stays up at http://localhost:${port}; Ctrl-C to quit`);
}
