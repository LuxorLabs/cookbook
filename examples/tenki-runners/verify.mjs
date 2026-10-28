import { readFileSync } from "node:fs";
import { parse } from "yaml";

const DOCS = "https://tenki.cloud/docs/runners";

// The published labels: the Linux and macOS 26 tables on the sizes page, plus the
// tenki-macos-15-{mini,small,medium,large} pattern on the macOS page.
const fetchDoc = async (page) => {
	const res = await fetch(`${DOCS}/${page}.md`);
	if (!res.ok) throw new Error(`${DOCS}/${page}.md: HTTP ${res.status}`);
	return res.text();
};
const sizes = await fetchDoc("sizes").catch((e) => fail(e));
const macos = await fetchDoc("macos-runners").catch((e) => fail(e));
const labels = new Set([...sizes.matchAll(/^\|\s*`(tenki-[a-z0-9-]+)`/gm)].map((m) => m[1]));
for (const [, prefix, sizesList] of macos.matchAll(/`(tenki-macos-\d+)-\{([a-z,]+)\}`/g)) {
	for (const s of sizesList.split(",")) labels.add(`${prefix}-${s}`);
}

// Tenki takes exactly one label as the whole runs-on value; arrays like
// [self-hosted, tenki-...] are cancelled, and an unknown label never gets a runner.
const check = (runsOn) => {
	if (typeof runsOn !== "string") return `runs-on must be one label, not ${JSON.stringify(runsOn)}`;
	if (!labels.has(runsOn)) return `${runsOn} is not a documented Tenki label`;
	return null;
};

function fail(e) {
	console.error("✗ " + (e?.message ?? e));
	process.exit(1);
}

try {
	if (!labels.has("tenki-standard-small-2c-4g") || labels.size < 8) {
		throw new Error(`could not read the label tables (found ${[...labels].join(", ") || "none"})`);
	}
	for (const bad of [["self-hosted", "tenki-standard-small-2c-4g"], "ubuntu-latest", "tenki-standard-small-4c-8g"]) {
		if (!check(bad)) throw new Error(`checker accepted ${JSON.stringify(bad)}`);
	}

	const workflow = parse(readFileSync(new URL("./workflow.yml", import.meta.url), "utf8"));
	const jobs = Object.entries(workflow.jobs ?? {});
	if (!jobs.length) throw new Error("workflow.yml has no jobs");
	for (const [name, job] of jobs) {
		const err = check(job["runs-on"]);
		if (err) throw new Error(`job ${name}: ${err}`);
	}
	if (!workflow.jobs.test?.services?.postgres) throw new Error("test job lost its postgres service");

	const used = [...new Set(jobs.map(([, j]) => j["runs-on"]))].join(", ");
	console.log(`✓ tenki-runners: ${jobs.length} jobs in workflow.yml → runs-on ${used} → each is one of ${labels.size} labels in the Tenki docs`);
} catch (e) {
	fail(e);
}
