import * as plugin from "@luxorai/agentbox-provider";
import { LuxorSandbox, stdoutText } from "@luxorai/sandbox";
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
const workspaceId = process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `luxor login`.");
	process.exit(1);
}

const REQUIRED = ["create", "start", "reconnect", "pause", "resume", "stop", "destroy", "exec", "buildAttach"];

let sandbox;
try {
	const provider = plugin.providerModule?.provider;
	if (plugin.PROVIDER_NAME !== "tenki") throw new Error(`PROVIDER_NAME is ${JSON.stringify(plugin.PROVIDER_NAME)}`);
	if (plugin.SDK_API_VERSION !== 2) throw new Error(`SDK_API_VERSION is ${plugin.SDK_API_VERSION}, README pins AgentBox 0.29.2, which loads v1/v2`);
	if (provider?.name !== "tenki") throw new Error(`providerModule.provider.name is ${JSON.stringify(provider?.name)}`);
	const missing = REQUIRED.filter((k) => typeof provider?.[k] !== "function");
	if (typeof provider?.checkpoint?.create !== "function") missing.push("checkpoint.create");
	if (missing.length) throw new Error(`providerModule.provider missing members: ${missing.join(", ")}`);

	const luxor = new LuxorSandbox({ authToken });
	sandbox = await luxor.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });

	const r = await sandbox.exec("sh", { args: ["-c", 'echo "box $(python3 -c \'print(6*7)\')"'] });
	if (!(r.exitCode === 0 && stdoutText(r).trim() === "box 42")) {
		throw new Error(`exec: exit ${r.exitCode}, stdout ${JSON.stringify(stdoutText(r))}`);
	}

	await sandbox.writeFile("workspace-note.txt", "agentbox workspace file\n");
	const back = new TextDecoder().decode(await sandbox.readFile("workspace-note.txt"));
	if (back !== "agentbox workspace file\n") throw new Error(`file round-trip mismatch: ${JSON.stringify(back)}`);

	console.log("✓ agentbox-luxor: plugin exposes the SDK v2 tenki provider → live boot → exec (box 42) → file round-trip → dispose");
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
