/**
 * Proves the sandbox-facing half of this example with no model key: build the Agent
 * SDK tools against a live sandbox and call their handlers directly, exactly as the
 * agent loop would. (agent.mjs needs ANTHROPIC_API_KEY; CONTRIBUTING says CI
 * verifies the backend, not the model.)
 * Token/workspace from env (CI) or ~/.config/luxor/config.yaml (local `luxor login`).
 */
import { LuxorSandbox } from "@luxorai/sandbox";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { makeLuxorTools } from "./luxor-tools.mjs";

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

const FIB = "a, b = 0, 1\nfor _ in range(30):\n    a, b = b, a + b\nprint(a)\n";

const luxor = new LuxorSandbox({ authToken });
let sandbox;
try {
	sandbox = await luxor.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });
	const tools = Object.fromEntries(makeLuxorTools(sandbox).map((t) => [t.name, t]));
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
