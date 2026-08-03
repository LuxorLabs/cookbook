/**
 * The full experience: Claude, given the Tenki toolkit through Composio, is
 * asked to boot a sandbox, run a command in it, and clean up — deciding the tool
 * calls itself.
 *
 * Custom toolkits are SESSION-scoped, so tool_use blocks execute via
 * session.execute() (not the global provider path), and tool definitions come
 * from session.customTools().
 *
 * Needs: COMPOSIO_API_KEY · a Tenki token (or `tenki login`) · ANTHROPIC_API_KEY
 *   node agent.mjs
 */
import Anthropic from "@anthropic-ai/sdk";
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

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;

for (const [name, value] of [
	["COMPOSIO_API_KEY", process.env.COMPOSIO_API_KEY],
	["ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY],
	["a Tenki token (TENKI_AUTH_TOKEN or `tenki login`)", authToken],
]) {
	if (!value) {
		console.error(`Missing ${name}.`);
		process.exit(1);
	}
}

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
const anthropic = new Anthropic();

const session = await composio.sessions.create("default", {
	experimental: { customToolkits: [tenkiToolkit({ authToken, workspaceId })] },
});

// Anthropic tool defs come straight from the session's custom-tool registry.
const tools = session.customTools({ toolkit: "TENKI" }).map((t) => ({
	name: t.slug,
	description: t.description,
	input_schema: t.inputSchema,
}));
console.log(`Tools exposed to the agent: ${tools.map((t) => t.name).join(", ")}\n`);

const TASK =
	"Boot a fresh Tenki sandbox, run a shell command that prints the Linux kernel version and the " +
	"Python version inside it, then terminate the sandbox. Report what you found.";

const messages = [{ role: "user", content: TASK }];
const live = new Set(); // sandboxes to clean up if the agent forgets

try {
	for (let turn = 1; turn <= 10; turn++) {
		const res = await anthropic.messages.create({
			model: MODEL,
			max_tokens: 2048,
			system:
				"You are an infrastructure agent. Use only the provided tools to complete the task. " +
				"Always terminate any sandbox you create before giving your final answer.",
			tools,
			messages,
		});

		for (const b of res.content) {
			if (b.type === "text" && b.text.trim()) console.log(`🤖 ${b.text.trim()}`);
		}
		if (res.stop_reason !== "tool_use") break;

		messages.push({ role: "assistant", content: res.content });
		const results = [];
		for (const b of res.content) {
			if (b.type !== "tool_use") continue;
			console.log(`🔧 ${b.name} ${JSON.stringify(b.input)}`);
			const r = await session.execute(b.name, b.input ?? {});
			const data = r.data ?? {};
			if (b.name === "LOCAL_TENKI_CREATE_SANDBOX" && data.success && typeof data.sessionId === "string") {
				live.add(data.sessionId);
			}
			if (b.name === "LOCAL_TENKI_TERMINATE_SANDBOX" && data.terminated && typeof b.input?.sessionId === "string") {
				live.delete(b.input.sessionId);
			}
			results.push({
				type: "tool_result",
				tool_use_id: b.id,
				content: JSON.stringify(data),
				...(r.error !== null ? { is_error: true } : {}),
			});
		}
		messages.push({ role: "user", content: results });
	}
} finally {
	for (const id of live) {
		try {
			await session.execute("LOCAL_TENKI_TERMINATE_SANDBOX", { sessionId: id });
			console.log(`🧹 terminated leftover sandbox ${id}`);
		} catch {
			/* self-reaps via idle/lifetime caps */
		}
	}
}
