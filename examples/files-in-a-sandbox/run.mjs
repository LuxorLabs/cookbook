// File I/O in a disposable Luxor sandbox: write a text file, read it back, list the dir.
// Uses the official @luxorai/sandbox SDK — no exec/shell needed for any of it.
import { LuxorSandbox } from "@luxorai/sandbox";

const luxor = new LuxorSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// `await using` auto-terminates the sandbox when this scope ends (Session is AsyncDisposable).
await using sandbox = await luxor.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	workspaceId: process.env.TENKI_WORKSPACE_ID,
});

const path = "notes.txt";
const text = "hello from luxor\n";

// Write a text file. Relative paths resolve under the guest home, /home/tenki.
await sandbox.writeFile(path, text);

// Read it back. readFile returns bytes (Uint8Array); decode to a string.
const roundTrip = new TextDecoder().decode(await sandbox.readFile(path));
console.log(`read back -> ${JSON.stringify(roundTrip)}`); // "hello from luxor\n"

// List the working directory. Each entry is a FileInfo { path, size, isDir, ... };
// `path` is the basename and `size` is a bigint.
for (const f of await sandbox.list(".")) {
	console.log(`${f.isDir ? "d" : "-"} ${f.path} (${f.size} bytes)`);
}
