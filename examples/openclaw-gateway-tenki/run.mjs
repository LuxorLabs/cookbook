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
const existing = (await tenki.previewUrls.list()).find((u) => u.slug === SLUG);

// sticky: true keeps the sandbox running until you terminate it.
const sandbox = await tenki.createAndWait({
  sticky: true,
  allowInbound: true,
  cpuCores: 2,
  memoryMb: 4096,
  diskSizeGb: 10,
  tags: ["openclaw-gateway"],
});

// The working hostname includes the sandbox's region, which a URL only gets once it is bound. So a
// new (or unbound) URL is bound right away; a URL serving an older sandbox moves after setup.
const previous = existing?.sessionId;
let url = existing;
if (!url) url = await tenki.previewUrls.create(SLUG, { sessionId: sandbox.id, port: PORT });
else if (!previous) url = await tenki.previewUrls.bind(url.id, sandbox.id, PORT);

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

// Move a URL that served an older sandbox only once the new gateway is healthy.
if (previous) {
  await tenki.previewUrls.unbind(url.id);
  const moved = await tenki.previewUrls.bind(url.id, sandbox.id, PORT);
  if (moved.previewUrl !== url.previewUrl) {
    // Different region, different hostname: tell the gateway its new origin.
    await sandbox.exec("bash", { args: ["-lc", `openclaw config set gateway.publicOrigin ${moved.previewUrl}`] });
  }
  url = moved;
}

console.log(`dashboard: ${url.previewUrl}`);
console.log(`sandbox:   ${sandbox.id}`);
if (previous) console.log(`previous sandbox: ${previous} (remove it with: tenki sandbox terminate ${previous})`);
