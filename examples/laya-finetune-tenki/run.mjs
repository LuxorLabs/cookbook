// Fine-tune the Laya decision model on 60 labelled support tickets in a Tenki sandbox, score it
// against 20 held-out tickets before and after, and route a few new ones with the result.
// Pass --keep to snapshot the sandbox so the fine-tuned checkpoint outlives it.
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });
const keep = process.argv.includes("--keep");
const sh = async (sandbox, cmd) => {
	const r = await sandbox.exec(["sh", "-lc", cmd]);
	return { code: r.exitCode, out: stdoutText(r).trim(), err: stderrText(r).trim() };
};

// 8 cores and 16 GiB: the 421M-parameter checkpoint trains in about a minute on CPU.
await using sandbox = await tenki.createAndWait({ cpuCores: 8, memoryMb: 16384, diskSizeGb: 20 });
console.log(`sandbox ${sandbox.id}`);

for (const f of ["data/train.csv", "data/eval.csv", "train.sh", "predict.py"]) {
	await sandbox.writeFile(`/home/tenki/laya/${f}`, readFileSync(new URL(f, import.meta.url)));
}

// Training outlasts a single exec, so run it detached and poll a sentinel file for the exit code.
await sh(sandbox, "setsid sh -c 'sh ~/laya/train.sh > ~/laya/train.log 2>&1; echo $? > ~/laya/DONE' </dev/null >/dev/null 2>&1 &");
let code;
while ((code = (await sh(sandbox, "cat ~/laya/DONE 2>/dev/null")).out) === "") {
	process.stdout.write(".");
	await new Promise((f) => setTimeout(f, 10_000));
}
console.log();
const log = (await sh(sandbox, "cat ~/laya/train.log")).out;
if (code !== "0") throw new Error(`training failed (exit ${code}):\n${log.slice(-2000)}`);
console.log(log.slice(log.indexOf("=== Evaluation")).split("\n").slice(0, 10).join("\n"));

const tickets = [
	"You charged my card for a plan I cancelled in May.",
	"The upload button does nothing on Firefox.",
	"Our parcel never showed up and tracking is stuck.",
	"How do I reset my password?",
];
const p = await sh(sandbox, `cd ~/laya && .venv/bin/python predict.py ckpt '${JSON.stringify(tickets)}' 2>/dev/null`);
for (const line of p.out.split("\n")) {
	const { text, team, p: prob } = JSON.parse(line);
	console.log(`${team.padEnd(10)} ${prob.toFixed(3)}  ${text}`);
}

if (keep) {
	await sh(sandbox, "rm -f ~/laya/DONE ~/laya/train.log && sync");
	const snap = await tenki.createSnapshotAndWait(sandbox.id, { name: "laya-finetuned" });
	console.log(`kept: snapshot ${snap.id} (${snap.state}) holds ~/laya/ckpt; create a sandbox with { snapshotId } to serve it`);
}
