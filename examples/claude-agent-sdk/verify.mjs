/**
 * Proves the Tenki-facing half of this example with no model key: build the Agent
 * SDK tools against a live sandbox and call their handlers directly, exactly as the
 * agent loop would. (agent.mjs needs ANTHROPIC_API_KEY; CONTRIBUTING says CI
 * verifies the backend, not the model.)
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { makeTenkiTools } from "./tenki-tools.mjs";

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

const FIB = "a, b = 0, 1\nfor _ in range(30):\n    a, b = b, a + b\nprint(a)\n";

const tenki = new TenkiSandbox({ authToken });
let sandbox;
try {
	sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });
	const tools = Object.fromEntries(makeTenkiTools(sandbox).map((t) => [t.name, t]));
	const textOf = (result) => result.content[0].text.trim();

	const wrote = textOf(await tools.write_file.handler({ path: "fib.py", content: FIB }));
	if (wrote !== "wrote fib.py") throw new Error(`write_file returned ${JSON.stringify(wrote)}`);

	const out = textOf(await tools.bash.handler({ command: "python3 fib.py" }));
	if (out !== "832040") throw new Error(`bash returned ${JSON.stringify(out)}, expected the 30th Fibonacci number`);

	const back = textOf(await tools.read_file.handler({ path: "fib.py" }));
	if (back !== FIB.trim()) throw new Error(`read_file did not round-trip: ${JSON.stringify(back)}`);

	console.log("✓ claude-agent-sdk: write_file → bash python3 fib.py → 832040 → read_file → dispose");
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
