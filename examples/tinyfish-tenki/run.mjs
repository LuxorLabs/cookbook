// Boot a Tenki sandbox, install the TinyFish SDK + playwright-core, run tinyfish.mjs inside it.
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";

if (!process.env.TINYFISH_API_KEY) throw new Error("Set TINYFISH_API_KEY");

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// The key lives in this session's environment only, never in an image or template.
await using sandbox = await tenki.createAndWait({
	cpuCores: 2,
	memoryMb: 2048,
	env: { TINYFISH_API_KEY: process.env.TINYFISH_API_KEY },
});

// No browser download: playwright-core only speaks CDP to TinyFish's remote Chromium.
const install = await sandbox.exec("npm", {
	args: ["install", "--no-audit", "--no-fund", "@tiny-fish/sdk@0.8.0", "playwright-core@1.64.1"],
});
if (install.exitCode !== 0) throw new Error(stderrText(install));

await sandbox.writeFile("tinyfish.mjs", readFileSync(new URL("./tinyfish.mjs", import.meta.url)));
const result = await sandbox.exec("node", { args: ["tinyfish.mjs", "https://example.com"] });
if (result.exitCode !== 0) throw new Error(stderrText(result));
console.log(stdoutText(result).trim());
