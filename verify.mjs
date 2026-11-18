/**
 * Run every examples/<name>/verify.mjs from the repository root.
 * Install each example's dependencies first. Exits non-zero if any example fails.
 * An example with a .verify-skip file is skipped here and in CI; the file's first line says why.
 * CI (.github/workflows/verify.yml) runs the same scripts, one job per example.
 */
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const examplesDir = join(root, "examples");

const names = readdirSync(examplesDir, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => d.name);

let failed = 0;
for (const name of names) {
	const verify = join(examplesDir, name, "verify.mjs");
	if (!existsSync(verify)) {
		console.log(`- ${name}: no verify.mjs (skipped)`);
		continue;
	}
	const skip = join(examplesDir, name, ".verify-skip");
	if (existsSync(skip)) {
		console.log(`- ${name}: skipped (${readFileSync(skip, "utf8").split("\n")[0]})`);
		continue;
	}
	console.log(`\n=== ${name} ===`);
	const r = spawnSync("node", [verify], { cwd: join(examplesDir, name), stdio: "inherit" });
	if (r.status !== 0) {
		failed++;
		console.log(`  FAILED: ${name}`);
	}
}

console.log(`\n${failed ? `✗ ${failed} example(s) failed` : "✓ all examples passed"}`);
process.exit(failed ? 1 : 0);
