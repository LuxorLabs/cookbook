// Run code in a disposable Luxor sandbox: boot -> exec -> print -> auto-dispose.
// The core Luxor Agent Cloud loop, with the official @luxorai/sandbox SDK.
import { LuxorSandbox, stdoutText } from "@luxorai/sandbox";

const luxor = new LuxorSandbox({ authToken: process.env.LUXORAI_AUTH_TOKEN || process.env.LUXORAI_API_KEY || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });

// `await using` auto-terminates the sandbox when this scope ends (Session is AsyncDisposable).
await using sandbox = await luxor.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	workspaceId: process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID,
});

// exec(command, { args }) runs a bare binary + its args (no shell splitting).
const result = await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });

console.log(`exit ${result.exitCode} -> ${stdoutText(result).trim()}`); // exit 0 -> 42
