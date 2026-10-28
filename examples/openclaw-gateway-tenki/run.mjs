import { TenkiSandbox } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";

const OPENCLAW_VERSION = "2026.10.8";
const PORT = 18789;
const SLUG = process.env.OPENCLAW_SLUG || "openclaw";
const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
if (!gatewayToken) throw new Error("Set OPENCLAW_GATEWAY_TOKEN, e.g. export OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 32)");

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });

// A named preview URL is a workspace object with a fixed address. Reuse it if it exists, so the
// dashboard keeps its address when you rebuild the sandbox behind it.
const url = (await tenki.previewUrls.list()).find((u) => u.slug === SLUG) ?? (await tenki.previewUrls.create(SLUG));

// sticky: true keeps the sandbox running until you terminate it.
const sandbox = await tenki.createAndWait({
  sticky: true,
  allowInbound: true,
  cpuCores: 2,
  memoryMb: 4096,
  diskSizeGb: 10,
  tags: ["openclaw-gateway"],
});

try {
  await sandbox.writeFile("/home/tenki/setup.sh", readFileSync(new URL("./setup.sh", import.meta.url), "utf8"));
  const result = await sandbox.exec("bash", {
    args: ["-lc", "bash /home/tenki/setup.sh"],
    env: {
      OPENCLAW_VERSION,
      PUBLIC_URL: url.previewUrl,
      OPENCLAW_GATEWAY_TOKEN: gatewayToken,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
    },
    timeoutMs: 600_000,
  });
  if (result.exitCode !== 0) throw new Error(`setup.sh failed:\n${new TextDecoder().decode(result.stderr)}`);
} catch (e) {
  await sandbox.close();
  throw e;
}

// Point the URL at the new gateway only once it is healthy.
if (url.sessionId) await tenki.previewUrls.unbind(url.id);
await tenki.previewUrls.bind(url.id, sandbox.id, PORT);

console.log(`dashboard: ${url.previewUrl}`);
console.log(`sandbox:   ${sandbox.id}`);
if (url.sessionId) console.log(`previous sandbox: ${url.sessionId} (remove it with: tenki sandbox terminate ${url.sessionId})`);
