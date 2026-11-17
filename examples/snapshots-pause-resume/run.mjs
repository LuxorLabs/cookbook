// Pause a Luxor sandbox and resume it later — its filesystem survives the round-trip.
// pause() snapshots memory + disk and stops the running machine; resume() brings it back.
import { LuxorSandbox } from "@luxorai/sandbox";

const luxor = new LuxorSandbox({ authToken: process.env.LUXORAI_AUTH_TOKEN || process.env.TENKI_AUTH_TOKEN });

// `await using` auto-terminates the sandbox when this scope ends (Session is AsyncDisposable).
await using sandbox = await luxor.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	workspaceId: process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID,
});

// Leave a marker in the sandbox filesystem (relative paths resolve under /home/tenki).
await sandbox.writeFile("marker.txt", "still here after the pause");

await sandbox.pause(); // snapshot memory + disk, free the VM (state -> PAUSED)
await sandbox.resume(); // bring the same sandbox back (state -> RUNNING)

// The file survived: pause/resume preserved the filesystem.
const marker = new TextDecoder().decode(await sandbox.readFile("marker.txt"));
console.log(`resumed -> ${marker}`); // resumed -> still here after the pause
