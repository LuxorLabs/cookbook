// An orca ephemeral-VM recipe backed by Tenki microVMs: one disposable machine per agent,
// instead of N git worktrees sharing your laptop.
//
// orca runs this once per lifecycle mode. `create` prints one JSON object describing an SSH
// target; `suspend`/`resume`/`destroy` get that same JSON back on stdin as recipeResult.
import { TenkiSandbox, isReady } from "@tenkicloud/sandbox";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const mode = process.argv[2] ?? "create";
const proxy = new URL("./ssh-proxy.mjs", import.meta.url).pathname;
const knownHosts = `${homedir()}/.ssh/known_hosts`;
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });

const stdinJson = async () => {
	let raw = "";
	for await (const chunk of process.stdin) raw += chunk;
	return JSON.parse(raw);
};

if (mode === "create") {
	// orca runs the recipe with cwd set to the local checkout, so origin names the repo to clone.
	const repoUrl = process.env.ORCA_REPO_URL || execFileSync("git", ["remote", "get-url", "origin"]).toString().trim();

	// One keypair per sandbox. ssh auto-loads the cert from <identityFile>-cert.pub,
	// which is the only way to attach it — orca's target schema has no certificate field.
	const keyDir = `${homedir()}/.tenki-orca/${randomUUID()}`;
	mkdirSync(keyDir, { recursive: true });
	execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-q", "-f", `${keyDir}/id`]);
	const publicKey = readFileSync(`${keyDir}/id.pub`, "utf8").trim();

	const sandbox = await tenki.createAndWait({
		cpuCores: 2,
		memoryMb: 4096,
		cloneRepoUrl: repoUrl,
		sshAuthorizedKeys: [publicKey],
		workspaceId: process.env.TENKI_WORKSPACE_ID,
	});
	const cert = await tenki.issueSandboxSSHCert(sandbox.id, publicKey);
	writeFileSync(`${keyDir}/id-cert.pub`, cert.sshCert.trim() + "\n");

	// The SSH host key belongs to Tenki's gateway, not to the sandbox's own sshd, and
	// cert.caPub signs *user* certs so it cannot pin it. Learn it once here under a
	// per-sandbox alias, so later connections verify normally instead of skipping the check.
	const alias = `tenki-${sandbox.id.slice(0, 8)}`;
	mkdirSync(`${homedir()}/.ssh`, { recursive: true });
	execFileSync("ssh", ["-o", `ProxyCommand=node ${proxy} ${sandbox.id}`, "-o", "StrictHostKeyChecking=accept-new",
		"-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=30", "-i", `${keyDir}/id`, `tenki@${alias}`, "true"], { stdio: "ignore" });

	process.stdout.write(JSON.stringify({
		schemaVersion: 2,
		checkoutMode: "provisioned-root",
		connection: {
			type: "ssh",
			target: {
				label: `Tenki ${alias}`,
				host: alias,
				port: 22,
				username: "tenki",
				identityFile: `${keyDir}/id`,
				identitiesOnly: true,
				proxyCommand: `node ${proxy} ${sandbox.id}`,
			},
			projectRoot: "/home/tenki/repo",
		},
		userData: { sessionId: sandbox.id, keyDir, alias },
	}));
} else {
	const { recipeResult } = await stdinJson();
	const { sessionId, keyDir, alias } = recipeResult.userData;
	const sandbox = await tenki.get(sessionId);

	if (mode === "suspend") await sandbox.pause();
	else if (mode === "resume") {
		await sandbox.resume();
		// resume() returns while the session is still RESUMING; anything else 409s until it lands.
		while (!isReady(sandbox.state)) {
			await new Promise((r) => setTimeout(r, 1000));
			await sandbox.refresh();
		}
		// Certs are short-lived; mint a fresh one so a resumed VM is reachable again.
		const cert = await tenki.issueSandboxSSHCert(sessionId, readFileSync(`${keyDir}/id.pub`, "utf8").trim());
		writeFileSync(`${keyDir}/id-cert.pub`, cert.sshCert.trim() + "\n");
	} else if (mode === "destroy") {
		await sandbox[Symbol.asyncDispose]();
		rmSync(keyDir, { recursive: true, force: true });
		if (existsSync(knownHosts)) {
			writeFileSync(knownHosts, readFileSync(knownHosts, "utf8").split("\n").filter((l) => !l.startsWith(`${alias} `)).join("\n"));
		}
	}
	process.stdout.write(JSON.stringify({ ok: true, mode }));
}
