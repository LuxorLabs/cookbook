// The Tenki port of a typical Daytona script: create -> run a command -> capture output -> dispose.
// Daytona (for reference):
//   import { Daytona } from "@daytonaio/sdk";
//   const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });   // or implicit DAYTONA_API_KEY
//   const sandbox = await daytona.create();
//   const r = await sandbox.process.executeCommand("echo hello from daytona"); // runs via a shell
//   console.log(r.result.trim(), "· exit", r.exitCode);
//   await daytona.delete(sandbox);
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

// Daytona: new Daytona({ apiKey }) (or implicit DAYTONA_API_KEY). Tenki: pass the token explicitly.
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// Daytona: daytona.create(). Tenki: createAndWait() boots the microVM and waits until it's ready.
const sandbox = await tenki.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	workspaceId: process.env.TENKI_WORKSPACE_ID,
});

try {
	// Daytona's process.executeCommand("echo ...") runs through a shell. Tenki's exec() runs a bare
	// binary + args (no shell splitting) — wrap shell syntax in `sh -c` yourself.
	const result = await sandbox.exec("sh", { args: ["-c", "echo hello from tenki"] });

	// Daytona: result.result is a string. Tenki: result.stdout is bytes — decode with stdoutText().
	console.log(stdoutText(result).trim(), "· exit", result.exitCode); // hello from tenki · exit 0
} finally {
	// Daytona: await daytona.delete(sandbox). Tenki: close() terminates the sandbox (so does `await using`).
	await sandbox.close();
}
