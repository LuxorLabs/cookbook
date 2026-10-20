/**
 * An MCP server whose tools come with a UI.
 *
 * A normal MCP tool returns text, and the chat prints it. An MCP App tool also
 * names a `ui://` resource, and a host that speaks the MCP Apps extension
 * renders that resource in the conversation and wires it to the tool call — so
 * the answer arrives as something the user can keep working in.
 *
 * Two apps here, each backed by a Tenki sandbox:
 *   run_code_in_sandbox → a console: the program, its output, and a live shell
 *   launch_web_app      → the app it just wrote, served from the sandbox
 *
 * Two more tools are marked `visibility: ["app"]`: hidden from the model,
 * callable only from the UI through the host's proxy. That is what the terminal
 * and the destroy button use.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { APP_DIR, acquire, describe, destroy, exec, hasToken, runProgram, serveWebApp } from "./sandboxes.mjs";
import { widgetHtml } from "./widget.mjs";

// The MCP Apps browser bundle: one self-contained ES module, read out of
// node_modules and baked into each app page. No build step anywhere.
const bridge = readFileSync(createRequire(import.meta.url).resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");

const PORT = Number(process.env.MCP_PORT || 3108);
const BASE = `http://localhost:${PORT}`;
const VIEWS = { console: "ui://tenki/console.html", preview: "ui://tenki/preview.html" };

const ok = (structured, text) => ({ structuredContent: structured, content: [{ type: "text", text }] });
const failed = (kind, err) => {
	const message = err instanceof Error ? err.message : String(err);
	return { isError: true, structuredContent: { error: message }, content: [{ type: "text", text: `${kind} failed: ${message}` }] };
};
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… [${s.length - n} more chars, shown in full in the app]` : s);

function createServer() {
	const server = new McpServer({ name: "tenki-sandboxes", version: "1.0.0" });
	const sandboxId = z.string().min(1).describe("Sandbox id from an earlier result — reuse it to keep working in the same machine.");

	registerAppTool(
		server,
		"run_code_in_sandbox",
		{
			title: "Run code in a Tenki sandbox",
			description:
				"Run a Python, JavaScript (Node) or shell program in a fresh Tenki sandbox and open a console the user can keep working in: " +
				"the code, its output, and a live shell into the same machine. Pass sandbox_id to reuse one (files persist, no boot). " +
				"Standard library only unless allow_internet is true.",
			inputSchema: {
				language: z.enum(["python", "javascript", "shell"]),
				code: z.string().min(1).describe("The complete program."),
				title: z.string().max(60).optional().describe("Short label, e.g. 'Monte Carlo pi'."),
				sandbox_id: sandboxId.optional(),
				allow_internet: z.boolean().optional().describe("Give a NEW sandbox outbound internet (package installs). Default false."),
			},
			// This is the whole difference from a plain tool: a UI to render with the result.
			_meta: { ui: { resourceUri: VIEWS.console } },
		},
		async ({ language, code, title, sandbox_id, allow_internet }) => {
			const started = Date.now();
			try {
				const { session, bootMs, reused } = await acquire({
					sandboxId: sandbox_id,
					name: `cookbook-${(title ?? language).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
					allowOutbound: Boolean(allow_internet),
				});
				const run = await runProgram(session, language, code);
				return ok(
					{ kind: "run", title: title ?? "", language, code, run, reused, sandbox: describe(session), timings: { bootMs, runMs: run.runMs, totalMs: Date.now() - started } },
					`${reused ? "Reused" : "Booted"} sandbox ${session.id}${bootMs === null ? "" : ` in ${bootMs} ms`}. ` +
						`\`${run.command}\` exited ${run.exitCode} in ${run.runMs} ms.\n--- stdout ---\n${clip(run.stdout, 2000) || "(empty)"}\n` +
						`--- stderr ---\n${clip(run.stderr, 1000) || "(empty)"}\n` +
						"The user is looking at a console for this sandbox with the code and full output; don't repeat the output.",
				);
			} catch (err) {
				return failed("run", err);
			}
		},
	);

	registerAppTool(
		server,
		"launch_web_app",
		{
			title: "Serve a web app from a Tenki sandbox",
			description:
				"Write a web app into a Tenki sandbox, start it, expose its port on a public URL, and show it running inside the chat. " +
				"For a page, pass `html` — one self-contained file, inline CSS and JS, no external requests. " +
				"For a server, put it in `files` and pass start_command; it must listen on 0.0.0.0 and the given port (also $PORT).",
			inputSchema: {
				html: z.string().optional().describe("Contents of index.html, for a single-page app."),
				files: z.array(z.object({ path: z.string(), content: z.string() })).optional().describe("Other files to write (a server, assets)."),
				title: z.string().max(60).optional(),
				port: z.number().int().min(1024).max(65535).optional().describe("Default 8080."),
				start_command: z.string().optional().describe("Default: python3 -m http.server $PORT --bind 0.0.0.0"),
				sandbox_id: sandboxId.optional(),
			},
			_meta: { ui: { resourceUri: VIEWS.preview } },
		},
		async ({ html, files, title, port, start_command, sandbox_id }) => {
			const started = Date.now();
			const p = port ?? 8080;
			const startCommand = start_command?.trim() || `python3 -m http.server ${p} --bind 0.0.0.0`;
			const all = [...(html ? [{ path: "index.html", content: html }] : []), ...(files ?? [])];
			try {
				if (!all.length) throw new Error("Nothing to serve: pass `html` or `files`.");
				const { session, bootMs, reused } = await acquire({
					sandboxId: sandbox_id,
					name: `cookbook-${(title ?? "web-app").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
					allowInbound: true,
				});
				const { previewUrl } = await serveWebApp(session, { files: all, startCommand, port: p });
				return ok(
					{ kind: "preview", title: title ?? "", previewUrl, port: p, startCommand, files: all.map((f) => f.path), reused, sandbox: describe(session), timings: { bootMs, serveMs: Date.now() - started } },
					`${title ?? "The app"} is live at ${previewUrl}, served from sandbox ${session.id} (port ${p}, \`${startCommand}\`). ` +
						"The user can see it running in the chat.",
				);
			} catch (err) {
				return failed("launch", err);
			}
		},
	);

	// ── app-only: the UI calls these, the model never sees them ──────────────
	const appOnly = { ui: { visibility: ["app"] } };

	registerAppTool(
		server,
		"sandbox_exec",
		{ description: "Run a shell command in a sandbox (the console's terminal).", inputSchema: { sandbox_id: sandboxId, command: z.string().min(1) }, _meta: appOnly },
		async ({ sandbox_id, command }) => {
			try {
				const { session } = await acquire({ sandboxId: sandbox_id });
				const run = await exec(session, "sh", ["-c", command]);
				return ok({ run }, `exit ${run.exitCode}\n${run.stdout}${run.stderr}`);
			} catch (err) {
				return failed("exec", err);
			}
		},
	);

	registerAppTool(
		server,
		"sandbox_destroy",
		{ description: "Terminate a sandbox (the destroy button).", inputSchema: { sandbox_id: sandboxId }, _meta: appOnly },
		async ({ sandbox_id }) => {
			try {
				await destroy(sandbox_id);
				return ok({ destroyed: sandbox_id }, `Terminated ${sandbox_id}.`);
			} catch (err) {
				return failed("destroy", err);
			}
		},
	);

	for (const [view, uri] of Object.entries(VIEWS)) {
		registerAppResource(server, `tenki-${view}`, uri, { mimeType: RESOURCE_MIME_TYPE, description: `Tenki ${view} app` }, async () => ({
			contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: widgetHtml(view, bridge) }],
		}));
	}

	return server;
}

// ── HTTP ────────────────────────────────────────────────────────────────────
// Stateless: a fresh server per request, which is what MCP Apps hosts expect —
// they open a connection per tool call and per proxied call from the UI.

// The tools spend the server's Tenki key with no auth, so listen on loopback only.
// createMcpExpressApp's `host` only adds Host-header checks; listen() sets the bind address.
const HOST = "127.0.0.1";
const app = createMcpExpressApp({ host: HOST });

app.all("/mcp", async (req, res) => {
	const server = createServer();
	const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
	res.on("close", () => {
		transport.close().catch(() => {});
		server.close().catch(() => {});
	});
	try {
		await server.connect(transport);
		await transport.handleRequest(req, res, req.body);
	} catch (err) {
		console.error("[mcp]", err);
		if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
	}
});

app.get("/healthz", (_req, res) => res.json({ ok: true, sandboxes: hasToken ? "live" : "no token" }));

app.listen(PORT, HOST, (err) => {
	if (err) {
		console.error(err);
		process.exit(1);
	}
	console.log(`MCP App server on ${BASE}/mcp — sandboxes under ${APP_DIR}`);
	if (!hasToken) console.error("No Tenki token: set TENKI_AUTH_TOKEN or run `tenki login`. Tool calls will fail until you do.");
});
