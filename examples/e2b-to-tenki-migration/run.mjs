// The Tenki port of a typical E2B script: create -> run a command -> capture output -> dispose.
// E2B (for reference):
//   import { Sandbox } from "e2b";
//   const sandbox = await Sandbox.create();                       // reads E2B_API_KEY
//   const r = await sandbox.commands.run("echo hello from e2b");  // runs via a shell
//   console.log(r.stdout.trim(), "· exit", r.exitCode);
//   await sandbox.kill();
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

// E2B: auth is implicit via E2B_API_KEY. Tenki: pass the token explicitly.
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// E2B: Sandbox.create(). Tenki: createAndWait() boots the microVM and waits until it's ready.
const sandbox = await tenki.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	workspaceId: process.env.TENKI_WORKSPACE_ID,
});

try {
	// E2B's commands.run("echo ...") runs through a shell. Tenki's exec() runs a bare
	// binary + args (no shell splitting) — wrap shell syntax in `sh -c` yourself.
	const result = await sandbox.exec("sh", { args: ["-c", "echo hello from tenki"] });

	// E2B: result.stdout is a string. Tenki: result.stdout is bytes — decode with stdoutText().
	console.log(stdoutText(result).trim(), "· exit", result.exitCode); // hello from tenki · exit 0
} finally {
	// E2B: await sandbox.kill(). Tenki: close() terminates the sandbox (so does `await using`).
	await sandbox.close();
}
