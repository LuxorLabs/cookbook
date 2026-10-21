// Boot Tenki's tenki/anchor image, upload anchor.mjs, and run it with the Anchor key in that one process.
import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";

const anchorKey = process.env.ANCHOR_API_KEY;
if (!anchorKey) throw new Error("Set ANCHOR_API_KEY");

const tenki = new TenkiSandbox(); // reads TENKI_API_KEY or TENKI_AUTH_TOKEN

// tenki/anchor:stable is the base image plus playwright-core and anchor-smoke: no browser, no key.
// No cpuCores / memoryMb: the image restores from a snapshot at its own size (2 vCPU, 4 GiB), and a
// smaller request is refused. maxDurationMs is a hard cap: Tenki ends the sandbox after 10 minutes even if this script dies.
await using sandbox = await tenki.createAndWait({
	image: "tenki/anchor:stable",
	maxDurationMs: 10 * 60_000,
});

await sandbox.writeFile("anchor.mjs", readFileSync(new URL("./anchor.mjs", import.meta.url)));

// The key goes into this one process's environment, not the session's.
const result = await sandbox.exec("node", {
	args: ["anchor.mjs", "https://example.com"],
	env: { ANCHOR_API_KEY: anchorKey },
	timeoutMs: 3 * 60_000,
});
if (result.status !== "SUCCEEDED") throw new Error(`${result.status}: ${stderrText(result)}`);
console.log(stdoutText(result).trim());
