#!/usr/bin/env node
// The Tenki → Luxor Agent Cloud codemod. No dependencies; run from the repo root.
//   node scripts/rebrand.mjs --check            fail if any "tenki" mention is not covered by a rule or protect pattern
//   node scripts/rebrand.mjs --report           count mentions by phase, rule and protect pattern
//   node scripts/rebrand.mjs --write --phase 1  apply every decided rule up to that phase
//   node scripts/rebrand.mjs --dry-run --phase 1  print the changes --write would make
// Paths after the flags limit it to those files or folders.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { extname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { PHASES, protect, rules } from "./rebrand.rules.mjs";

const LANG = {
	".js": "js", ".mjs": "js", ".cjs": "js", ".ts": "js", ".tsx": "js", ".jsx": "js", ".json": "js",
	".go": "go", ".py": "py", ".sh": "sh", ".bash": "sh", ".yml": "sh", ".yaml": "sh", ".toml": "sh",
	".cfg": "sh", ".ini": "sh", ".env": "sh", ".txt": "sh", "": "sh",
};
const FENCE = { js: "js", javascript: "js", ts: "js", typescript: "js", json: "js", mjs: "js", tsx: "js", go: "go", python: "py", py: "py", bash: "sh", sh: "sh", shell: "sh", console: "sh", zsh: "sh", yaml: "sh", yml: "sh", toml: "sh", dockerfile: "sh", ini: "sh", env: "sh" };

// Mark comments and string literals in code from `from` to `to`; the rest stays "code".
function scan(src, from, to, lang, cat) {
	const mark = (a, b, c) => { for (let k = a; k < b; k++) cat[k] = c; };
	const upto = (needle, at, extra) => { const e = src.indexOf(needle, at); return e < 0 || e > to ? to : e + extra; };
	const slashes = lang === "js" || lang === "go";
	const hash = lang === "py" || lang === "sh";
	const quotes = lang === "js" ? "'\"`" : lang === "go" ? "\"`" : "'\"";
	for (let i = from; i < to; ) {
		const c = src[i], two = src.slice(i, i + 2), three = src.slice(i, i + 3);
		let end = -1, kind = "comment";
		if (slashes && two === "//") end = upto("\n", i, 0);
		else if (slashes && two === "/*") end = upto("*/", i + 2, 2);
		else if (hash && c === "#" && (i === from || /\s/.test(src[i - 1]))) end = upto("\n", i, 0);
		else if (lang === "py" && (three === '"""' || three === "'''")) (end = upto(three, i + 3, 3)), (kind = "string");
		else if (quotes.includes(c)) {
			let j = i + 1;
			while (j < to && src[j] !== c && !(c !== "`" && lang !== "sh" && src[j] === "\n")) j += src[j] === "\\" && c !== "`" ? 2 : 1;
			(end = Math.min(j + 1, to)), (kind = "string");
		}
		if (end < 0) { i++; continue; }
		mark(i, end, kind);
		i = Math.max(end, i + 1);
	}
}

// One category per character: "text" (Markdown prose), "comment", "string", or "code".
function categories(file, src) {
	const cat = new Array(src.length).fill("code");
	const ext = extname(file).toLowerCase();
	const mark = (from, to, c) => { for (let i = from; i < to; i++) cat[i] = c; };
	if (ext !== ".md" && ext !== ".mdx") {
		const lang = LANG[ext] ?? (basename(file).startsWith(".") ? "sh" : null);
		if (lang) scan(src, 0, src.length, lang, cat);
		return cat;
	}
	let pos = 0, fence = null, start = 0;
	for (const line of src.split("\n")) {
		const f = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
		if (f && fence === null) {
			const tag = f[2].toLowerCase();
			fence = /^(text|txt|plain|plaintext|)$/.test(tag) ? "text" : FENCE[tag] ?? "sh";
			start = pos + line.length + 1;
		} else if (f) {
			if (fence === "text") mark(start, pos, "text");
			else scan(src, start, pos, fence, cat);
			fence = null;
		} else if (fence === null) {
			mark(pos, pos + line.length, "text");
			for (const m of line.matchAll(/`[^`]*`/g)) mark(pos + m.index, pos + m.index + m[0].length, "code");
		}
		pos += line.length + 1;
	}
	return cat;
}

const spans = (src, re) => [...src.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))].map((m) => [m.index, m.index + m[0].length, m]);
const inScope = (rule, cat, at) => rule.scope === "any" || [].concat(rule.scope).includes(cat[at]);
const upTo = (p) => PHASES.indexOf(p);

/** Apply every decided rule up to `phase` to one file's source. */
export function rewrite(file, src, phase) {
	for (const rule of rules.filter((r) => upTo(r.phase) <= upTo(phase) && r.replace !== null)) {
		const cat = categories(file, src);
		const guarded = protect.flatMap((p) => spans(src, p.find));
		let out = "", last = 0;
		for (const [a, b, m] of spans(src, rule.find)) {
			if (!inScope(rule, cat, a) || guarded.some(([x, y]) => a < y && x < b)) continue;
			out += src.slice(last, a) + m[0].replace(new RegExp(rule.find.source, rule.find.flags.replace("g", "")), rule.replace);
			last = b;
		}
		src = out + src.slice(last);
	}
	return src;
}

/** Classify every "tenki" in one file: [{ at, line, by }] where by is a rule, a protect pattern, or null. */
export function classify(file, src) {
	const cat = categories(file, src);
	const guarded = protect.map((p) => [p, spans(src, p.find)]);
	const covered = rules.map((r) => [r, spans(src, r.find).filter(([a]) => inScope(r, cat, a))]);
	return [...src.matchAll(/tenki/gi)].map(({ index: at }) => {
		const hit = (list) => list.find(([, s]) => s.some(([a, b]) => a <= at && at < b))?.[0];
		return { at, line: src.slice(0, at).split("\n").length, by: hit(guarded) ?? hit(covered) ?? null };
	});
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();

function main() {
	const args = process.argv.slice(2);
	const flag = (f) => args.includes(f);
	const phaseArg = args[args.indexOf("--phase") + 1];
	const paths = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--phase");
	const SKIP = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|go\.sum)$|^(scripts\/(rebrand\.mjs|rebrand\.rules\.mjs|rebrand\.test\.mjs|README\.md)|\.github\/workflows\/(brand|links)\.yml|lychee\.toml)$|\.(png|jpe?g|gif|ico|pdf|woff2?|ttf|zip|gz)$/i;
	const files = execFileSync("git", ["ls-files", ...paths], { encoding: "utf8" }).split("\n").filter((f) => f && !SKIP.test(f));

	if (flag("--write") || flag("--dry-run")) {
		if (!PHASES.includes(phaseArg)) throw new Error(`--phase must be one of ${PHASES.join(", ")}`);
		let changed = 0;
		for (const file of files) {
			const before = readFileSync(file, "utf8");
			const src = rewrite(file, before, phaseArg);
			if (src === before) continue;
			changed++;
			if (flag("--write")) writeFileSync(file, src);
			else {
				const a = before.split("\n"), b = src.split("\n");
				a.forEach((l, i) => l !== b[i] && console.log(`${file}:${i + 1}\n  - ${l.trim()}\n  + ${b[i]?.trim()}`));
			}
		}
		console.log(`${flag("--write") ? "changed" : "would change"} ${changed} files (phase ≤ ${phaseArg})`);
		return;
	}

	// --check and --report: classify every mention.
	const unclassified = [];
	const tally = new Map();
	for (const file of files) {
		const src = readFileSync(file, "utf8");
		for (const { at, line, by } of classify(file, src)) {
			if (by) {
				const k = by.why ? `protect  ${by.why}` : `phase ${by.phase.padEnd(3)} ${by.replace === null ? "(name pending) " : ""}${by.find.source.slice(0, 60)}`;
				tally.set(k, (tally.get(k) ?? 0) + 1);
				continue;
			}
			const near = src.slice(Math.max(0, at - 40), at + 40).replace(/\s+/g, " ");
			unclassified.push(`${file}:${line}: …${near}…`);
		}
	}
	if (flag("--report")) {
		for (const [k, n] of [...tally].sort()) console.log(`${String(n).padStart(5)}  ${k}`);
		console.log(`${String(unclassified.length).padStart(5)}  unclassified`);
	}
	if (unclassified.length) {
		console.error(`\n${unclassified.length} mentions of "tenki" are not covered by a rule or protect pattern in scripts/rebrand.rules.mjs:`);
		for (const u of unclassified.slice(0, flag("--all") ? Infinity : 60)) console.error(`  ${u}`);
		if (unclassified.length > 60 && !flag("--all")) console.error(`  … and ${unclassified.length - 60} more (--all to list them)`);
		console.error(`\nAdd a rule (if the cookbook will rename it) or a protect pattern (if something outside the cookbook owns it).`);
		process.exit(1);
	}
	console.log(`✓ every "tenki" mention in ${files.length} files is covered by a rename rule or a protect pattern`);
}
