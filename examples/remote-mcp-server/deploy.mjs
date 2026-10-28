// Deploy server/ to a sticky Tenki sandbox behind a named preview URL, or tear it down.
//   node deploy.mjs        deploy (or redeploy: the URL moves to the new sandbox)
//   node deploy.mjs down   delete the URL and terminate the sandbox
import { TenkiSandbox, stderrText } from "@tenkicloud/sandbox";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PORT = 3000;
const file = (name) => readFileSync(new URL(`server/${name}`, import.meta.url), "utf8");

// The URL named `slug`, if any, and the sandbox bound to it. Refuses to touch a URL bound to a
// sandbox this script didn't create (sandboxes are named after the slug).
async function find(tenki, slug, workspaceId) {
  const url = (await tenki.previewUrls.list({ workspaceId })).find((u) => u.slug === slug);
  const bound = url?.sessionId ? await tenki.get(url.sessionId).catch(() => undefined) : undefined;
  if (bound && bound.name !== slug) throw new Error(`${slug} is bound to sandbox ${bound.id}; set MCP_SLUG`);
  return { url, bound };
}

export async function up(tenki, { slug, token, workspaceId }) {
  const existing = await find(tenki, slug, workspaceId);
  // sticky: true keeps the sandbox running until it is terminated; no maxDurationMs cap.
  const sandbox = await tenki.createAndWait({
    cpuCores: 1, memoryMb: 1024, allowInbound: true, sticky: true, name: slug, workspaceId,
  });
  try {
    await sandbox.exec("mkdir", { args: ["-p", "mcp"] });
    await sandbox.writeFile("mcp/package.json", file("package.json"));
    await sandbox.writeFile("mcp/server.mjs", file("server.mjs"));
    const npm = await sandbox.exec("npm", { args: ["install", "--omit=dev", "--no-audit", "--no-fund"], cwd: "mcp" });
    if (npm.exitCode !== 0) throw new Error(`npm install failed: ${stderrText(npm)}`);
    // setsid + redirected stdio keeps the server running after exec() returns.
    await sandbox.exec("sh", {
      args: ["-c", `cd mcp && setsid node server.mjs >/tmp/mcp.log 2>&1 </dev/null & sleep 1`],
      env: { MCP_TOKEN: token, PORT: String(PORT) },
    });
    // An existing URL moves to the new sandbox, so the address stays the same. bind() needs an
    // unbound URL; the old sandbox is terminated once the new one answers.
    if (existing.url?.sessionId) await tenki.previewUrls.unbind(existing.url.id);
    const url = existing.url
      ? await tenki.previewUrls.bind(existing.url.id, sandbox.id, PORT)
      : await tenki.previewUrls.create(slug, { sessionId: sandbox.id, port: PORT, workspaceId });
    for (let i = 0; i < 20; i++) {
      if (await fetch(`${url.previewUrl}/health`).then((r) => r.ok, () => false)) {
        await existing.bound?.closeIfOpen().catch(() => {});
        return { sandbox, url };
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`${url.previewUrl}/health never answered; see /tmp/mcp.log in the sandbox`);
  } catch (e) {
    await sandbox.close().catch(() => {});
    throw e;
  }
}

export async function down(tenki, { slug, workspaceId }) {
  const { url, bound } = await find(tenki, slug, workspaceId);
  if (!url) return false;
  // Delete the URL first: terminating a sandbox also deletes the URLs bound to it.
  await tenki.previewUrls.delete(url.id);
  await bound?.closeIfOpen();
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });
  const opts = { slug: process.env.MCP_SLUG || "remote-mcp", workspaceId: process.env.TENKI_WORKSPACE_ID };
  if (process.argv[2] === "down") {
    console.log((await down(tenki, opts)) ? `deleted ${opts.slug} and its sandbox` : `no preview URL named ${opts.slug}`);
  } else {
    const token = process.env.MCP_TOKEN || randomBytes(32).toString("hex");
    const { sandbox, url } = await up(tenki, { ...opts, token });
    console.log(`MCP endpoint: ${url.previewUrl}/mcp (sandbox ${sandbox.id})`);
    if (!process.env.MCP_TOKEN) console.log(`export MCP_TOKEN=${token}`);
    console.log(`claude mcp add --transport http tenki-remote ${url.previewUrl}/mcp --header "Authorization: Bearer $MCP_TOKEN"`);
    console.log("The sandbox runs until you stop it: node deploy.mjs down");
  }
}
