/**
 * Proves the fine-tune works on Tenki: a sandbox installs CPU PyTorch and laya, fine-tunes the
 * base checkpoint on data/train.csv, scores base and tuned on the held-out data/eval.csv, and the
 * tuned checkpoint routes new tickets to the right team. Token from env (CI) or
 * ~/.config/tenki/config.yaml. Exits non-zero on failure; terminates the sandbox.
 */
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";
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
const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
const tenki = new TenkiSandbox({ authToken });
let sandbox;
const sh = async (cmd) => stdoutText(await sandbox.exec(["sh", "-lc", cmd])).trim();

try {
	sandbox = await tenki.createAndWait({ cpuCores: 8, memoryMb: 16384, diskSizeGb: 20, workspaceId: process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined });
	for (const f of ["data/train.csv", "data/eval.csv", "train.sh", "predict.py"]) {
		await sandbox.writeFile(`/home/tenki/laya/${f}`, readFileSync(new URL(f, import.meta.url)));
	}
	await sh("setsid sh -c 'sh ~/laya/train.sh > ~/laya/train.log 2>&1; echo $? > ~/laya/DONE' </dev/null >/dev/null 2>&1 &");
	let code = "";
	for (let i = 0; i < 90 && !(code = await sh("cat ~/laya/DONE 2>/dev/null")); i++) await new Promise((f) => setTimeout(f, 10_000));
	assert(code === "0", `training exit ${code || "timeout"}: ${(await sh("tail -c 1500 ~/laya/train.log")).replace(/\s+/g, " ")}`);

	const report = JSON.parse(await sh("cat ~/laya/ckpt/train_report.json"));
	assert(report.eval_mode === "held_out", `eval_mode ${report.eval_mode}`);
	const before = report.before.accuracy, after = report.after.accuracy;
	assert(after >= 0.7 && after >= before, `held-out accuracy ${before} → ${after}`);

	const tickets = { billing: "You charged my card for a plan I cancelled in May.", technical: "The upload button does nothing on Firefox.", shipping: "Our parcel never showed up and tracking is stuck.", account: "How do I reset my password?" };
	const out = await sh(`cd ~/laya && .venv/bin/python predict.py ckpt '${JSON.stringify(Object.values(tickets))}' 2>/dev/null`);
	const teams = out.split("\n").map((l) => JSON.parse(l).team);
	const right = Object.keys(tickets).filter((t, i) => teams[i] === t).length;
	assert(right >= 3, `routed ${right}/4 new tickets correctly: ${teams.join(", ")}`);

	console.log(`✓ laya-finetune-tenki: install → fine-tune on CPU → held-out accuracy ${before} → ${after} → ${right}/4 new tickets routed`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (sandbox) { try { await sandbox[Symbol.asyncDispose](); } catch { /* self-reaps */ } }
}
