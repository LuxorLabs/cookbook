// Boot a Tenki sandbox from tenki/tinyfish:stable and run tinyfish.mjs inside it.
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";

if (!process.env.TINYFISH_API_KEY) throw new Error("Set TINYFISH_API_KEY");

const tenki = new TenkiSandbox(); // reads TENKI_API_KEY

// The key lives in this session's environment only, never in an image or template.
// tenki/tinyfish:stable restores at 2 vCPU / 4096 MiB; a smaller size is rejected.
// maxDurationMs is a hard cap: Tenki ends the sandbox after 10 minutes even if this script dies.
await using sandbox = await tenki.createAndWait({
	image: "tenki/tinyfish:stable",
	cpuCores: 2,
	memoryMb: 4096,
	maxDurationMs: 10 * 60_000,
	env: { TINYFISH_API_KEY: process.env.TINYFISH_API_KEY },
});

await sandbox.writeFile("tinyfish.mjs", readFileSync(new URL("./tinyfish.mjs", import.meta.url)));
const result = await sandbox.exec("node", { args: ["tinyfish.mjs", "https://example.com"] });
if (result.exitCode !== 0) throw new Error(stderrText(result));
console.log(stdoutText(result).trim());
