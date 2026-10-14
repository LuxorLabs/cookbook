/**
 * Proves the Tenki-facing contract OpenHermit's `tenki` exec backend relies on
 * (apps/agent/src/core/backends/tenki.ts), with no gateway or PostgreSQL needed:
 * a sticky session boots, commands run via `sh -c` with env pass-through, files
 * round-trip (the skill-sync path), and — what OpenHermit leans on across
 * gateway restarts — the same session reattaches by id via `client.get()`.
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
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const client = new TenkiSandbox({ authToken });
const text = (bytes) => new TextDecoder().decode(bytes);
let session;
try {
	// 1) boot a sticky session, as the backend's ensure() does
	session = await client.createAndWait({
		cpuCores: 1,
		memoryMb: 1024,
		sticky: true,
		metadata: { agentId: "cookbook-openhermit-verify" },
		workspaceId,
	});

	// 2) exec the way TenkiExecBackend.exec() does: sh -c, cwd agent_home, env passed
	//    through, timeout_ms handed to the SDK's guest-enforced timeout
	const r1 = await session.run(["sh", "-c", 'echo "$GREETING $(python3 -c "print(6*7)")"'], {
		cwd: "/home/tenki",
		env: { GREETING: "hermit" },
		timeoutMs: 300_000,
	});
	if (!(r1.exitCode === 0 && !r1.timedOut && text(r1.stdout).trim() === "hermit 42")) {
		throw new Error(`exec: exit ${r1.exitCode}, stdout ${JSON.stringify(text(r1.stdout))}, stderr ${JSON.stringify(text(r1.stderr))}`);
	}

	// 2b) timeout_ms expiry: the guest returns timedOut with partial output, which the
	//     backend maps to exit 137 while keeping stdout/stderr
	const rt = await session.run(["sh", "-c", "echo partial; sleep 30"], { cwd: "/home/tenki", timeoutMs: 3_000 });
	if (!(rt.timedOut && text(rt.stdout).includes("partial"))) {
		throw new Error(`timeout: timedOut ${rt.timedOut}, exit ${rt.exitCode}, stdout ${JSON.stringify(text(rt.stdout))}`);
	}

	// 3) the skill-sync path: mkdir + writeFile, then read back
	await session.mkdir("/home/tenki/skills");
	await session.writeFile("/home/tenki/skills/demo.md", "# demo skill\n");
	if (text(await session.readFile("/home/tenki/skills/demo.md")) !== "# demo skill\n") {
		throw new Error("skill file round-trip mismatch");
	}

	// 4) reattach by id — what the gateway does after a restart (readySession: resume if
	//    paused, wait until RUNNING)
	const again = await client.get(session.id);
	if (again.state === "PAUSED") await again.resume();
	if (again.state !== "RUNNING") await again.waitReady(180_000);
	const r2 = await again.run(["sh", "-c", "cat skills/demo.md"], { cwd: "/home/tenki" });
	if (!text(r2.stdout).includes("demo skill")) throw new Error("reattached session lost workspace state");

	console.log("✓ openhermit-tenki: sticky session → sh -c exec with env (hermit 42) → timeout keeps partial output → skill file sync → reattach by id → dispose");
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (session) {
		try {
			await session.closeIfOpen();
		} catch {
			/* self-reaps via idle/lifetime caps */
		}
	}
}
