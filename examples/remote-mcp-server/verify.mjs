// Proves this example: deploy the MCP server to a sticky sandbox behind a named preview URL,
// check /health and the token gate, then list and call tools with the MCP SDK client over
// Streamable HTTP. Exits non-zero on failure; deletes the URL and sandbox either way.
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { up, down } from "./deploy.mjs";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const tenki = new TenkiSandbox({ authToken });
const slug = `mcp-verify-${randomBytes(3).toString("hex")}`;
const token = randomBytes(32).toString("hex");
try {
	const { sandbox, url } = await up(tenki, { slug, token, workspaceId });
	if (!sandbox.sticky) throw new Error("sandbox is not sticky");
	const mcp = `${url.previewUrl}/mcp`;
	console.log(`  MCP endpoint: ${mcp}`);

	const health = await fetch(`${url.previewUrl}/health`);
	if (health.status !== 200) throw new Error(`/health returned ${health.status}`);
	for (const auth of [undefined, "Bearer wrong-token"]) {
		const res = await fetch(mcp, { method: "POST", headers: auth ? { authorization: auth } : {} });
		if (res.status !== 401) throw new Error(`/mcp with ${auth ? "a wrong" : "no"} token returned ${res.status}, expected 401`);
	}

	const client = new Client({ name: "verify", version: "1.0.0" });
	await client.connect(new StreamableHTTPClientTransport(new URL(mcp), {
		requestInit: { headers: { Authorization: `Bearer ${token}` } },
	}));
	const tools = (await client.listTools()).tools.map((t) => t.name).sort().join(",");
	if (tools !== "current_time,echo") throw new Error(`unexpected tools: ${tools}`);
	const echo = await client.callTool({ name: "echo", arguments: { text: slug } });
	if (echo.content?.[0]?.text !== slug) throw new Error(`echo returned ${JSON.stringify(echo.content)}`);
	await client.close();

	console.log(`✓ remote-mcp-server: sticky sandbox → named URL → /health 200 → /mcp 401 without token → tools [${tools}] → echo "${slug}"`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	try { await down(tenki, { slug, workspaceId }); } catch (e) { console.error(`cleanup failed for ${slug}: ${e?.message ?? e}`); }
}
