/**
 * Proves the Composio ↔ Tenki integration: bind @tenkicloud/composio-tools to a
 * real Composio session, then drive the LOCAL_TENKI_* tools directly via
 * session.execute() — CREATE_SANDBOX → EXEC_COMMAND → TERMINATE_SANDBOX — and
 * assert each step. No LLM needed (the full agent is in agent.mjs).
 *
 * Needs two keys:
 *   COMPOSIO_API_KEY  (https://app.composio.dev)
 *   a Tenki token     (TENKI_AUTH_TOKEN / TENKI_API_KEY, or `tenki login`)
 */
import { Composio } from "@composio/core";
import { tenkiToolkit } from "@tenkicloud/composio-tools";
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

const composioKey = process.env.COMPOSIO_API_KEY;
const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;

if (!composioKey) {
	console.error("No COMPOSIO_API_KEY. Get one at https://app.composio.dev.");
	process.exit(1);
}
if (!authToken) {
	console.error("No Tenki token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const composio = new Composio({ apiKey: composioKey });
const session = await composio.sessions.create("default", {
	experimental: { customToolkits: [tenkiToolkit({ authToken, workspaceId })] },
});

/** Execute one LOCAL_TENKI_* tool and assert Composio + the tool itself both succeeded. */
async function tool(slug, args) {
	const res = await session.execute(slug, args);
	if (res.error !== null || res.data?.success !== true) {
		throw new Error(`${slug} failed: ${res.error ?? JSON.stringify(res.data?.error ?? res.data)}`);
	}
	return res.data;
}

let sandboxId;
try {
	const created = await tool("LOCAL_TENKI_CREATE_SANDBOX", { name: "cookbook-composio-verify" });
	sandboxId = created.sessionId;
	if (!sandboxId) throw new Error("CREATE_SANDBOX returned no sessionId");

	const exec = await tool("LOCAL_TENKI_EXEC_COMMAND", {
		sessionId: sandboxId,
		command: "echo hello-from-composio && python3 -c 'print(6*7)'",
	});
	if (exec.exitCode !== 0) throw new Error(`exec exitCode ${exec.exitCode}`);
	const out = String(exec.stdout);
	if (!out.includes("hello-from-composio") || !out.includes("42")) {
		throw new Error(`unexpected stdout: ${JSON.stringify(exec.stdout)}`);
	}

	console.log("✓ composio-tenki: a Composio session created a Tenki sandbox and ran code in it → 42");
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (sandboxId) {
		try {
			await session.execute("LOCAL_TENKI_TERMINATE_SANDBOX", { sessionId: sandboxId });
		} catch {
			/* self-reaps via idle/lifetime caps */
		}
	}
}
