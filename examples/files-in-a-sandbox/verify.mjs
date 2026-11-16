/**
 * Proves this example works: boot a sandbox, write a text file, read it back,
 * list the directory, assert the round-trip, dispose.
 * Token/workspace from env (CI) or ~/.config/luxor/config.yaml (local `luxor login`).
 * Exits non-zero on any failure.
 */
import { LuxorSandbox } from "@luxorai/sandbox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const cfg = (key) => {
	try {
		const c = readFileSync(["luxor", "tenki"].map((d) => `${homedir()}/.config/${d}/config.yaml`).find(existsSync) ?? "", "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};

const authToken = process.env.LUXORAI_AUTH_TOKEN || process.env.LUXORAI_API_KEY || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id");
if (!authToken) {
	console.error("No token. Set LUXORAI_AUTH_TOKEN, or run `luxor login`.");
	process.exit(1);
}

const path = "notes.txt";
const text = "hello from luxor\n";

const luxor = new LuxorSandbox({ authToken });
let sandbox;
try {
	sandbox = await luxor.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });

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
