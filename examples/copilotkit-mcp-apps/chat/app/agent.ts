import { MCPAppsMiddleware } from "@ag-ui/mcp-apps-middleware";
import { createOpenAI } from "@ai-sdk/openai";
import { BuiltInAgent } from "@copilotkit/runtime/v2";

import { ContinueAfterAppsMiddleware } from "./continue-middleware";
import { repairingFetch } from "./stream-repair";

export const MCP_URL = process.env.MCP_URL || "http://localhost:3108/mcp";

const PROMPT = `You are a coding agent with real Linux sandboxes.

- run_code_in_sandbox: run Python, Node or shell whenever something should be computed, tested, benchmarked or proven. The user gets a console with the code, its output, and a shell into the same sandbox.
- launch_web_app: build something visual and serve it from a sandbox; it appears running in the chat. Pass ONE self-contained page as \`html\` (inline CSS and JS, no external requests), compact enough to ship fast.

Say one short line before a tool call. Afterwards reply in a sentence or two with what the result means — the app already shows the code, the output and the timings. To change or fix something, pass the sandbox_id from the previous result so the work stays in the same machine.`;

/**
 * The model. Any OpenAI-compatible endpoint works — Aisa, OpenRouter, OpenAI —
 * which is why this reads a base URL rather than hard-coding a provider.
 */
function model() {
	const id = process.env.LLM_MODEL || "claude-sonnet-5";
	const baseURL = process.env.LLM_BASE_URL || "https://api.aisa.one/v1";
	const provider = createOpenAI({
		baseURL,
		apiKey: process.env.LLM_API_KEY,
		// Claude buffers each tool argument until it is complete, so a page of HTML
		// lands in one burst ~25s after the call starts. This streams it instead.
		headers: /claude/i.test(id) ? { "anthropic-beta": "fine-grained-tool-streaming-2025-05-14" } : {},
		fetch: repairingFetch,
	});
	// .chat(): an OpenAI-compatible endpoint speaks /chat/completions, not the Responses API.
	return provider.chat(id);
}

export function createAgent(): BuiltInAgent {
	const agent = new BuiltInAgent({ model: model(), prompt: PROMPT, maxSteps: 4 });
	// Order matters: the first middleware is the outermost, so the continuation
	// wraps the MCP Apps middleware and can see the tool results it emits.
	agent.use(
		new ContinueAfterAppsMiddleware(2),
		new MCPAppsMiddleware({ mcpServers: [{ type: "http", url: MCP_URL, serverId: "tenki" }] }),
	);
	return agent;
}
