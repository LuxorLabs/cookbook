// Decide which examples this run verifies and write them as a JSON matrix to $GITHUB_OUTPUT.
//
//   pull_request        the examples the PR touches, plus the smoke example; everything when a
//                       file outside examples/ or benchmarks/ changed (workflow, scripts, root)
//   push / schedule     everything
//   workflow_dispatch   everything, or the dirs given in the `examples` input
import { readdirSync, existsSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SMOKE = "examples/run-code-in-a-sandbox/";
const all = ["examples", "benchmarks"].flatMap((root) =>
	existsSync(root)
		? readdirSync(root, { withFileTypes: true })
				.filter((d) => d.isDirectory() && existsSync(`${root}/${d.name}/verify.mjs`))
				.map((d) => `${root}/${d.name}/`)
		: [],
);

let dirs = all;
const event = process.env.GITHUB_EVENT_NAME;
if (event === "pull_request") {
	const base = process.env.BASE_REF || "main";
	const changed = execFileSync("git", ["diff", "--name-only", `origin/${base}...HEAD`], { encoding: "utf8" })
		.split("\n")
		.filter(Boolean);
	const outside = changed.some((f) => !/^(examples|benchmarks)\//.test(f));
	if (!outside) {
		const touched = all.filter((d) => changed.some((f) => f.startsWith(d)));
		dirs = [...new Set([...touched, SMOKE])].filter((d) => all.includes(d));
	}
} else if (event === "workflow_dispatch") {
	const input = (process.env.INPUT_EXAMPLES || "all").trim();
	if (input !== "all") {
		dirs = input.split(/\s+/).map((d) => (d.endsWith("/") ? d : `${d}/`)).filter((d) => all.includes(d));
	}
}

console.log(`${dirs.length} of ${all.length} examples:\n  ${dirs.join("\n  ")}`);
const out = process.env.GITHUB_OUTPUT;
if (out) {
	appendFileSync(out, `matrix=${JSON.stringify(dirs)}\n`);
	appendFileSync(out, `count=${dirs.length}\n`);
}
