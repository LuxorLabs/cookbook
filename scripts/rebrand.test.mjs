// node --test scripts/rebrand.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, rewrite } from "./rebrand.mjs";

test("phase 1 renames the brand in prose, comments and strings, not in code", () => {
	const src = [
		'// Runs against live Tenki.',
		'import { Tenki } from "@tenkicloud/convex";',
		'const tenki = new Tenki(components.tenki);',
		'console.log("Hello from a Tenki sandbox!");',
	].join("\n");
	assert.equal(
		rewrite("x.mjs", src, "1"),
		[
			'// Runs against live Luxor Agent Cloud.',
			'import { Tenki } from "@tenkicloud/convex";',
			'const tenki = new Tenki(components.tenki);',
			'console.log("Hello from a Luxor Agent Cloud sandbox!");',
		].join("\n"),
	);
});

test("phase 1 moves page links but leaves app links, inline code and env vars", () => {
	const src = "A [Tenki account](https://tenki.cloud) and keys at [app.tenki.cloud](https://app.tenki.cloud). See https://tenki.cloud/docs/sandbox. Set `TENKI_API_KEY` and run `tenki login`.";
	assert.equal(
		rewrite("README.md", src, "1"),
		"A [Luxor Agent Cloud account](https://luxor.ai) and keys at [app.tenki.cloud](https://app.tenki.cloud). See https://luxor.ai/docs/sandbox. Set `TENKI_API_KEY` and run `tenki login`.",
	);
});

test("the coding-agent prompt fence is prose; a js fence is code", () => {
	const src = "```text\nSet up the Tenki example.\n```\n\n```js\nconst tenki = new TenkiSandbox(); // Tenki client\n```\n";
	assert.equal(rewrite("README.md", src, "1"), "```text\nSet up the Luxor Agent Cloud example.\n```\n\n```js\nconst tenki = new TenkiSandbox(); // Luxor Agent Cloud client\n```\n");
});

test("protected names survive every phase", () => {
	const src = "Files live in /home/tenki and previews on https://abc--8080.us.sb.tenki.sh. Use ag2.extensions.tenki with Tenki Code Reviewer.";
	assert.equal(rewrite("README.md", src, "3"), src);
	assert.ok(classify("README.md", src).every((m) => m.by?.why));
});

test("phase 2a moves app links; pending names are classified but untouched", () => {
	assert.equal(rewrite("README.md", "Keys: https://app.tenki.cloud", "2a"), "Keys: https://app.luxor.ai");
	assert.equal(rewrite("x.mjs", 'import { TenkiSandbox } from "@tenkicloud/sandbox";', "3"), 'import { TenkiSandbox } from "@tenkicloud/sandbox";');
	assert.ok(classify("x.mjs", 'import { TenkiSandbox } from "@tenkicloud/sandbox";').every((m) => m.by && m.by.replace === null));
});

test("phase 2c drops the -tenki folder suffix", () => {
	assert.equal(rewrite("README.md", "[AG2](examples/ag2-tenki/) and [E2B](examples/e2b-to-tenki-migration/)", "2c"), "[AG2](examples/ag2/) and [E2B](examples/e2b-migration/)");
});

test("an unknown name is unclassified", () => {
	assert.deepEqual(classify("README.md", "Run the tenkifoo daemon.").map((m) => m.by), [null]);
});
