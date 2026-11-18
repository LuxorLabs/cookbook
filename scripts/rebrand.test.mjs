// node --test scripts/rebrand.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, rewrite, useFolders } from "./rebrand.mjs";

const r = rewrite;

test("the SDK, its class and its client variable move to Luxor", () => {
	assert.equal(
		r("x.mjs", 'import { TenkiSandbox } from "@tenkicloud/sandbox";\nconst tenki = new TenkiSandbox({ authToken });\nawait using sandbox = await tenki.createAndWait({});'),
		'import { LuxorSandbox } from "@luxorai/sandbox";\nconst luxor = new LuxorSandbox({ authToken });\nawait using sandbox = await luxor.createAndWait({});',
	);
});

test("prose, comments and strings say Luxor; the Convex class stays Tenki", () => {
	assert.equal(
		r("examples/convex-tenki/x.ts", '// Runs against live Tenki.\nimport { Tenki } from "@tenkicloud/convex";\nconst tenki = new Tenki(components.tenki);\nconsole.log("Hello from a Tenki sandbox!");'),
		'// Runs against live Luxor Agent Cloud.\nimport { Tenki } from "@luxorai/convex";\nconst tenki = new Tenki(components.tenki);\nconsole.log("Hello from a Luxor sandbox!");',
	);
});

test("domains, products and the CLI move; env vars and the sandbox user stay", () => {
	assert.equal(
		r("README.md", "A [Tenki account](https://tenki.cloud), keys at [app.tenki.cloud](https://app.tenki.cloud), [Tenki Code Reviewer](https://tenki.cloud/products/code-reviewer). Set `TENKI_API_KEY` or run `tenki login`, which writes `~/.config/tenki/config.yaml`. Files live in `/home/tenki`."),
		"A [Luxor Agent Cloud account](https://luxor.ai), keys at [app.luxor.ai](https://app.luxor.ai), [Luxor Code Reviewer](https://luxor.ai/products/code-reviewer). Set `TENKI_API_KEY` or run `luxor login`, which writes `~/.config/luxor/config.yaml`. Files live in `/home/tenki`.",
	);
});

test("the coding-agent prompt fence is prose; a js fence keeps identifiers apart", () => {
	assert.equal(
		r("README.md", "```text\nSet up the Tenki example.\n```\n\n```js\nconst tenki = new TenkiSandbox(); // Tenki client\n```\n"),
		"```text\nSet up the Luxor Agent Cloud example.\n```\n\n```js\nconst luxor = new LuxorSandbox(); // Luxor Agent Cloud client\n```\n",
	);
});

test("example folders become -luxor where they name the folder, not the upstream package", () => {
	assert.equal(
		r("README.md", "[AG2](examples/ag2-tenki/), [E2B](examples/e2b-to-tenki-migration/), [MCP](../mcp-tenki-sandbox/). Install `prefect-tenki` from [examples/prefect-tenki](examples/prefect-tenki/)."),
		"[AG2](examples/ag2-luxor/), [E2B](examples/e2b-to-luxor-migration/), [MCP](../mcp-luxor-sandbox/). Install `prefect-tenki` from [examples/prefect-luxor](examples/prefect-luxor/).",
	);
});

test("other projects' names and the Python SDK survive", () => {
	const src = "Use ag2.extensions.tenki or @computesdk/tenki. `pip install tenki`, then `from tenki import Sandbox`. Previews on https://abc--8080.us.sb.tenki.sh.";
	assert.equal(r("README.md", src), src);
	assert.ok(classify("README.md", src).every((m) => m.by?.why));
});

test("the config read falls back to the old tenki CLI's file, and a second run changes nothing", () => {
	const once = r("x.mjs", 'readFileSync(["luxor", "tenki"].map((d) => `${homedir()}/.config/${d}/config.yaml`).find(existsSync) ?? "", "utf8")');
	assert.equal(r("x.mjs", once), once);
	assert.ok(classify("x.mjs", once).every((m) => m.by));
});

test("an unknown name is unclassified", () => {
	assert.deepEqual(classify("README.md", "Run the tenkifoo daemon.").map((m) => m.by), [null]);
});

test("a folder added after the rename takes its tags along, once the codemod is told it exists", () => {
	const src = 'tags: ["hills-tenki-climber"], image: "tenki-runners"';
	assert.equal(r("x.mjs", src), src);
	useFolders(["hills-luxor", "luxor-runners"]);
	assert.equal(r("x.mjs", src), 'tags: ["hills-luxor-climber"], image: "luxor-runners"');
	useFolders([]);
});

test("text about a tool that still reads the old CLI's file keeps saying so", () => {
	const src = "The fork reads `~/.config/tenki/config.yaml`, which the old `tenki login` wrote.";
	assert.equal(r("examples/hermes-luxor/README.md", src), src);
	assert.notEqual(r("examples/other/README.md", src), src);
});

test("the CopilotKit MCP server id is ours, so it moves", () => {
	assert.equal(r("agent.ts", 'mcpServers: [{ type: "http", url: MCP_URL, serverId: "tenki" }]'), 'mcpServers: [{ type: "http", url: MCP_URL, serverId: "luxor" }]');
});

test("a message another tool prints, quoted in double backticks, is left as that tool prints it", () => {
	const src = "| `` tenki is required for the Tenki sandbox provider. Install it with `pip install tenki` … `` | Run `pip install tenki`. |";
	assert.equal(r("examples/ragflow-luxor/README.md", src), src);
	assert.ok(classify("examples/ragflow-luxor/README.md", src).every((m) => m.by));
});
