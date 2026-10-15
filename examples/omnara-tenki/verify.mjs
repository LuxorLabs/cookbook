import { TemplateSpec, TenkiSandbox, isTerminal, stderrText, stdoutText } from "@tenkicloud/sandbox";
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

const tag = "omnara-tenki-verify";
const machine = `verify-${Date.now()}`;
const sh = async (sandbox, script) => {
	const r = await sandbox.exec("sh", { args: ["-c", script], timeoutMs: 120_000 });
	if (r.status !== "SUCCEEDED") throw new Error(`${r.status}, exit ${r.exitCode}: ${stderrText(r) || stdoutText(r)}`);
	return stdoutText(r).trim();
};

const tenki = new TenkiSandbox({ authToken });
let sandbox;
let version;
try {
	// Omnara's sessions are sticky; this one isn't, so a crashed run can't leave a VM running.
	sandbox = await tenki.createAndWait({
		workspaceId,
		diskSizeGb: 20,
		allowInbound: false,
		allowOutbound: true,
		maxDurationMs: 600_000,
		tags: [tag],
		metadata: { "omnara-machine": machine },
		directRuntime: new TemplateSpec()
			.runtimeEnv({ OMNARA_API_URL: "https://api.omnara.com/v1" })
			.startArgs(["/bin/sh", "-c", 'echo "$(id -un) $OMNARA_API_URL" > ~/boot.txt; exec sleep infinity'], {
				runAt: "boot",
				restartPolicy: "never",
			}),
	});

	const boot = await sh(sandbox, "for i in $(seq 60); do [ -s ~/boot.txt ] && break; sleep 1; done; cat ~/boot.txt");
	if (boot !== "tenki https://api.omnara.com/v1") throw new Error(`boot runtime wrote ${JSON.stringify(boot)}`);

	version = await sh(sandbox, `set -e
		curl -fsS https://api.omnara.com/install/omnarad.sh > /dev/null
		arch=$(uname -m | sed 's/x86_64/amd64/; s/aarch64/arm64/')
		curl -fsS "https://releases.omnara.com/omnarad/latest/linux-$arch.txt" > m
		curl -fsSL "$(sed -n 's/^url=//p' m)" -o omnarad
		echo "$(sed -n 's/^sha256=//p' m)  omnarad" | sha256sum -c - > /dev/null
		chmod +x omnarad
		[ "$(./omnarad --version)" = "$(sed -n 's/^version=//p' m)" ]
		sudo -n true
		./omnarad --version`);

	const found = (await tenki.list({ workspaceId, tags: [tag] })).filter((s) => s.metadata?.["omnara-machine"] === machine);
	if (found.length !== 1 || found[0].id !== sandbox.id) throw new Error(`list by tag found ${found.length} sessions`);
} catch (e) {
	sandbox ??= e?.session;
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (sandbox) {
		try {
			await sandbox.close();
			if (!isTerminal(sandbox.state)) throw new Error(`state ${sandbox.state}`);
		} catch (e) {
			console.error("✗ terminate failed: " + (e?.message ?? e));
			process.exitCode = 1;
		}
	}
	tenki.close();
}
if (!process.exitCode) {
	console.log(`✓ omnara-tenki: boot runtime as tenki → reach Omnara → omnarad ${version} verified → find by tag + metadata → terminate`);
}
