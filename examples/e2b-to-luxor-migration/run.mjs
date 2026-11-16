// The Luxor Agent Cloud port of a typical E2B script: create -> run a command -> capture output -> dispose.
// E2B (for reference):
//   import { Sandbox } from "e2b";
//   const sandbox = await Sandbox.create();                       // reads E2B_API_KEY
//   const r = await sandbox.commands.run("echo hello from e2b");  // runs via a shell
//   console.log(r.stdout.trim(), "· exit", r.exitCode);
//   await sandbox.kill();
import { LuxorSandbox, stdoutText } from "@luxorai/sandbox";

// E2B: auth is implicit via E2B_API_KEY. Luxor Agent Cloud: pass the token explicitly.
const luxor = new LuxorSandbox({ authToken: process.env.LUXORAI_AUTH_TOKEN || process.env.TENKI_AUTH_TOKEN });

// E2B: Sandbox.create(). Luxor Agent Cloud: createAndWait() boots the sandbox and waits until it's ready.
const sandbox = await luxor.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	workspaceId: process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID,
});

try {
	// E2B's commands.run("echo ...") runs through a shell. Luxor Agent Cloud's exec() runs a bare
	// binary + args (no shell splitting) — wrap shell syntax in `sh -c` yourself.
	const result = await sandbox.exec("sh", { args: ["-c", "echo hello from luxor"] });

	// E2B: result.stdout is a string. Luxor Agent Cloud: result.stdout is bytes — decode with stdoutText().
	console.log(stdoutText(result).trim(), "· exit", result.exitCode); // hello from luxor · exit 0
} finally {
	// E2B: await sandbox.kill(). Luxor Agent Cloud: close() terminates the sandbox (so does `await using`).
	await sandbox.close();
}
