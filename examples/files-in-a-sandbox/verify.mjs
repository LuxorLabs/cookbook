/**
 * Proves this example works: boot a sandbox, write a text file, read it back,
 * list the directory, assert the round-trip, dispose.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 * Exits non-zero on any failure.
 */
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id");
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const path = "notes.txt";
const text = "hello from tenki\n";

const tenki = new TenkiSandbox({ authToken });
let sandbox;
try {
	sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });

	// write -> read back -> assert the bytes survive the round-trip.
	await sandbox.writeFile(path, text);
	const bytes = await sandbox.readFile(path);
	const back = new TextDecoder().decode(bytes);
	if (back !== text) {
		throw new Error(`round-trip mismatch: wrote ${JSON.stringify(text)}, read ${JSON.stringify(back)}`);
	}

	// list the dir -> assert the file shows up as a file of the right size.
	const entries = await sandbox.list(".");
	const found = entries.find((f) => f.path === path);
	if (!found) throw new Error(`${path} not in listing: [${entries.map((f) => f.path).join(", ")}]`);
	if (found.isDir) throw new Error(`${path} listed as a directory, expected a file`);
	if (Number(found.size) !== bytes.length) {
		throw new Error(`listed size ${found.size} != ${bytes.length} bytes read`);
	}

	console.log(`✓ files-in-a-sandbox: write → read "${back.trim()}" → list (${entries.length} entry) → dispose`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (sandbox) {
		try {
			await sandbox[Symbol.asyncDispose]();
		} catch {
			/* self-reaps via idle/lifetime caps */
		}
	}
}
