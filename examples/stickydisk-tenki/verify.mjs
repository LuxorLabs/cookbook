import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

const REF = process.env.STICKYDISK_REF || "v1";
const tmp = mkdtempSync(join(tmpdir(), "stickydisk-"));

const run = (script, inputs) => {
	const out = join(tmp, `out-${Math.random()}`);
	const summary = join(tmp, `summary-${Math.random()}`);
	writeFileSync(out, "");
	writeFileSync(summary, "");
	// A runner without sticky disks: same env shape as Actions, no TENKI_STICKYDISK_URL/TOKEN.
	const env = { PATH: process.env.PATH, HOME: tmp, GITHUB_WORKSPACE: tmp, RUNNER_TEMP: tmp, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: summary };
	for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
	const r = spawnSync(process.execPath, [join(tmp, "action", script)], { env, encoding: "utf8" });
	const outputs = Object.fromEntries(readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("=")));
	return { status: r.status, outputs, summary: readFileSync(summary, "utf8"), stderr: r.stderr };
};

try {
	const res = await fetch(`https://codeload.github.com/LuxorLabs/stickydisk/tar.gz/${REF}`);
	if (!res.ok) throw new Error(`download LuxorLabs/stickydisk@${REF}: HTTP ${res.status}`);
	writeFileSync(join(tmp, "action.tgz"), Buffer.from(await res.arrayBuffer()));
	const tar = spawnSync("sh", ["-c", `mkdir action && tar -xzf action.tgz -C action --strip-components=1`], { cwd: tmp });
	if (tar.status !== 0) throw new Error(`untar: ${tar.stderr}`);

	const action = parse(readFileSync(join(tmp, "action", "action.yml"), "utf8"));
	if (action.runs?.post !== "dist/post.js") throw new Error("action has no post step to finalize the disk");
	const workflow = parse(readFileSync(new URL("./workflow.yml", import.meta.url), "utf8"));
	const steps = Object.values(workflow.jobs).flatMap((j) => j.steps.filter((s) => s.uses === "LuxorLabs/stickydisk@v1"));
	if (steps.length !== 2) throw new Error(`expected 2 sticky disk steps, found ${steps.length}`);
	for (const step of steps) {
		const unknown = Object.keys(step.with).filter((k) => !(k in action.inputs));
		if (unknown.length) throw new Error(`workflow passes undeclared inputs: ${unknown.join(", ")}`);
	}
	const used = [...readFileSync(new URL("./workflow.yml", import.meta.url), "utf8").matchAll(/outputs\.([a-z-]+)/g)].map((m) => m[1]);
	if (!used.every((o) => o in action.outputs)) throw new Error(`workflow reads undeclared outputs: ${used}`);

	const soft = run("dist/main.js", { key: "npm-node22-v1", path: "~/.npm" });
	if (soft.status !== 0 || soft.outputs.mounted !== "false" || soft.outputs.source !== "fallback") {
		throw new Error(`fallback mount: exit ${soft.status}, outputs ${JSON.stringify(soft.outputs)} ${soft.stderr}`);
	}
	if (!soft.summary.includes("Fallback reason: storage unavailable")) throw new Error(`summary: ${soft.summary}`);

	const hard = run("dist/main.js", { key: "npm-node22-v1", path: "~/.npm", "fail-on-error": "true" });
	if (hard.status === 0 || !hard.stderr.includes("capability is unavailable")) {
		throw new Error(`fail-on-error: exit ${hard.status}, stderr ${JSON.stringify(hard.stderr)}`);
	}

	const post = run("dist/post.js", { key: "npm-node22-v1", path: "~/.npm" });
	if (post.status !== 0) throw new Error(`post step with nothing mounted exited ${post.status}`);

	console.log(`✓ stickydisk-tenki: LuxorLabs/stickydisk@${REF} accepts workflow.yml → no runner capability → source=fallback (job runs cold) → fail-on-error fails → post no-op`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
}
