#!/usr/bin/env node
// One-off migration that ran with the rename: @luxorai/sandbox and the tenki Python SDK read
// LUXORAI_AUTH_TOKEN / LUXORAI_API_KEY first (since 1.5.2) and still accept TENKI_*.
// In the examples that only talk to those SDKs, scripts now read LUXORAI_* first with TENKI_*
// as the fallback, and docs and messages name LUXORAI_*. Examples that go through another
// project's plugin keep TENKI_*, because those plugins read it themselves.
//   node scripts/env-luxorai.mjs [--dry-run]
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { categories } from "./rebrand.mjs";

export const SDK_ONLY = [
	"agent-fullstack-app", "anchor-browser-luxor", "claude-agent-sdk", "claude-code-sandbox", "codex-sandbox",
	"copilotkit-mcp-apps", "crewai-code-interpreter", "cursor-origin-luxor", "daytona-to-luxor-migration",
	"e2b-to-luxor-migration", "expose-a-port", "files-in-a-sandbox", "langchain-code-interpreter", "langchain-python",
	"llamaindex", "mcp-luxor-sandbox", "modal-to-luxor-migration", "openai-agents-sdk", "opencode-sandbox",
	"run-code-in-a-sandbox", "run-code-python", "smolagents", "snapshots-pause-resume", "tinyfish-luxor", "vercel-ai-sdk",
].map((d) => `examples/${d}/`);

const V = "(AUTH_TOKEN|API_KEY|WORKSPACE_ID)";
const js = (n) => `process.env.LUXORAI_${n} || process.env.TENKI_${n}`;
const py = (n) => `os.environ.get("LUXORAI_${n}") or os.environ.get("TENKI_${n}")`;

/** Reads in code: LUXORAI_* first, TENKI_* after, in the order the SDK uses. */
export function reads(src) {
	return src
		.replace(/process\.env\.TENKI_AUTH_TOKEN \|\| process\.env\.TENKI_API_KEY/g, `process.env.LUXORAI_AUTH_TOKEN || process.env.LUXORAI_API_KEY || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY`)
		.replace(/process\.env\.TENKI_API_KEY \|\| process\.env\.TENKI_AUTH_TOKEN/g, `process.env.LUXORAI_API_KEY || process.env.LUXORAI_AUTH_TOKEN || process.env.TENKI_API_KEY || process.env.TENKI_AUTH_TOKEN`)
		.replace(new RegExp(`(?<!\\|\\| |LUXORAI_\\w+ \\|\\| )process\\.env\\.TENKI_${V}\\b(?! \\|\\| process\\.env\\.TENKI)`, "g"), (_, n) => `(${js(n)})`)
		.replace(/os\.environ\.get\("TENKI_AUTH_TOKEN"\) or os\.environ\.get\("TENKI_API_KEY"\)/g, `os.environ.get("LUXORAI_AUTH_TOKEN") or os.environ.get("LUXORAI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY")`)
		.replace(/os\.environ\.get\("TENKI_API_KEY"\) or os\.environ\.get\("TENKI_AUTH_TOKEN"\)/g, `os.environ.get("LUXORAI_API_KEY") or os.environ.get("LUXORAI_AUTH_TOKEN") or os.environ.get("TENKI_API_KEY") or os.environ.get("TENKI_AUTH_TOKEN")`)
		.replace(new RegExp(`(?<!or |LUXORAI_\\w+"\\) or )os\\.environ\\.get\\("TENKI_${V}"\\)(?! or os\\.environ\\.get\\("TENKI)`, "g"), (_, n) => `(${py(n)})`)
		.replace(new RegExp(`os\\.environ\\["TENKI_${V}"\\]`, "g"), (_, n) => `(os.environ.get("LUXORAI_${n}") or os.environ["TENKI_${n}"])`);
}

/** Everywhere else in these examples (docs, messages, comments), the variable is LUXORAI_*. */
export function names(file, src) {
	const cat = categories(file, src);
	return src.replace(new RegExp(`TENKI_${V}\\b`, "g"), (m, n, at) => {
		const read = /process\.env\.$|os\.environ(\.get\(|\[)["']$/.test(src.slice(Math.max(0, at - 20), at));
		const fallback = /(LUXORAI_\w+\b["')]*\s*(\|\||or)\s*(process\.env\.|os\.environ(\.get\(|\[)["']))$/.test(src.slice(Math.max(0, at - 90), at));
		return read || fallback || (cat[at] === "code" && !file.endsWith(".md")) ? m : `LUXORAI_${n}`;
	});
}

const dry = process.argv.includes("--dry-run");
if (import.meta.url === `file://${process.argv[1]}`) {
	const files = execFileSync("git", ["ls-files", ...SDK_ONLY], { encoding: "utf8" }).split("\n").filter((f) => /\.(md|mjs|js|ts|tsx|py)$/.test(f));
	let n = 0;
	for (const f of files) {
		const before = readFileSync(f, "utf8");
		const after = names(f, reads(before));
		if (after === before) continue;
		n++;
		if (!dry) writeFileSync(f, after);
	}
	console.log(`${dry ? "would change" : "changed"} ${n} files`);
}
