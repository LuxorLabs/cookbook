// Run code in a disposable Tenki sandbox: boot -> exec -> print -> auto-dispose.
// The core Tenki loop, with the official @tenkicloud/sandbox SDK.
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// `await using` auto-terminates the sandbox when this scope ends (Session is AsyncDisposable).
await using sandbox = await tenki.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// exec(command, { args }) runs a bare binary + its args (no shell splitting).
const result = await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });

console.log(`exit ${result.exitCode} -> ${stdoutText(result).trim()}`); // exit 0 -> 42
