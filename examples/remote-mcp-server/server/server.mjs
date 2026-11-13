// A remote MCP server over Streamable HTTP, guarded by a bearer token.
// Runs inside the sandbox: MCP_TOKEN=... PORT=3000 node server.mjs
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT || 3000);
if (!process.env.MCP_TOKEN) throw new Error("MCP_TOKEN is not set");
// Compare fixed-length digests so timingSafeEqual never sees different lengths.
const digest = (s) => createHash("sha256").update(s).digest();
const expected = digest(process.env.MCP_TOKEN);
delete process.env.MCP_TOKEN;

const authorized = (req) => {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ");
  return scheme === "Bearer" && !!token && timingSafeEqual(digest(token), expected);
};

function buildServer() {
  const server = new McpServer({ name: "tenki-remote-mcp", version: "1.0.0" });
  server.registerTool(
    "echo",
    { description: "Echo the given text back", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  server.registerTool(
    "current_time",
    { description: "The server's current time in ISO 8601 (UTC)" },
    async () => ({ content: [{ type: "text", text: new Date().toISOString() }] }),
  );
  return server;
}

createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/health") return res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
  if (path !== "/mcp") return res.writeHead(404).end();
  if (!authorized(req)) {
    return res.writeHead(401, { "www-authenticate": "Bearer" }).end('{"error":"unauthorized"}');
  }
  // Stateless mode: a fresh server and transport per request, no session IDs to track.
  if (req.method !== "POST") return res.writeHead(405, { allow: "POST" }).end();
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (e) {
    console.error("request failed:", e?.message ?? e);
    if (!res.headersSent) res.writeHead(500).end();
  }
}).listen(PORT, "0.0.0.0", () => console.log(`MCP server on :${PORT} (/mcp, /health)`));
