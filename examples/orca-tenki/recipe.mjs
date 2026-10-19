// An orca ephemeral-VM recipe backed by Tenki sandboxes: one disposable machine per agent,
// instead of N git worktrees sharing your laptop.
//
// orca runs this once per lifecycle mode. `create` prints one JSON object describing an SSH
// target; `suspend`/`resume`/`destroy` get that same JSON back on stdin as recipeResult.
import { TenkiSandbox, isReady } from "@tenkicloud/sandbox";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
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

	let sandbox, alias;
	try {
		sandbox = await tenki.createAndWait({
			cpuCores: 2,
			memoryMb: 4096,
			cloneRepoUrl: repoUrl,
			sshAuthorizedKeys: [publicKey],
			workspaceId: process.env.TENKI_WORKSPACE_ID,
		});
		const cert = await tenki.issueSandboxSSHCert(sandbox.id, publicKey);
		writeFileSync(`${keyDir}/id-cert.pub`, cert.sshCert.trim() + "\n");

		// The SSH host key belongs to Tenki's gateway, not to the sandbox's own sshd. Its host
		// certs are signed by cert.caPub, but their principals are gateway hostnames and orca's
		// target has no HostKeyAlias, so a @cert-authority pin can't match. Learn the key once
		// here under a per-sandbox alias, so later connections verify normally instead of
		// skipping the check.
		// Session ids are UUIDv7: the front is a timestamp, so a prefix collides across
		// sandboxes created near each other — alias on the random tail instead.
		alias = `tenki-${sandbox.id.replaceAll("-", "").slice(-12)}`;
		mkdirSync(`${homedir()}/.ssh`, { recursive: true });
		if (existsSync(knownHosts)) execFileSync("ssh-keygen", ["-R", alias, "-f", knownHosts], { stdio: "ignore" });
		execFileSync("ssh", ["-o", `ProxyCommand=node "${proxy}" ${sandbox.id}`, "-o", "StrictHostKeyChecking=accept-new",
			"-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=30", "-i", `${keyDir}/id`, `tenki@${alias}`, "true"], { stdio: "ignore" });
	} catch (e) {
		// orca never sees a session id from a failed create, so it can't destroy this one.
		// createAndWait's WaitReadyFailedError carries the session it created but gave up on.
		await (sandbox ?? e?.session)?.[Symbol.asyncDispose]().catch(() => {});
		rmSync(keyDir, { recursive: true, force: true });
		if (alias && existsSync(knownHosts)) execFileSync("ssh-keygen", ["-R", alias, "-f", knownHosts], { stdio: "ignore" });
		throw e;
	}

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
				proxyCommand: `node "${proxy}" ${sandbox.id}`,
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
		const deadline = Date.now() + 120_000;
		while (!isReady(sandbox.state)) {
			if (Date.now() > deadline) throw new Error(`resume timed out: state still ${sandbox.state} after 120s`);
			await new Promise((r) => setTimeout(r, 1000));
			await sandbox.refresh();
		}
		// Certs are short-lived; mint a fresh one so a resumed VM is reachable again.
		const cert = await tenki.issueSandboxSSHCert(sessionId, readFileSync(`${keyDir}/id.pub`, "utf8").trim());
		writeFileSync(`${keyDir}/id-cert.pub`, cert.sshCert.trim() + "\n");
		// A resumed session can come back behind a different gateway, and with it a
		// different host key — drop the stale pin and learn the current one, as create did.
		// Like create, this trusts the first key it sees (see above for why caPub can't pin it).
		// The SSH stream rides the SDK's TLS WebSocket to Tenki, so an attacker would have to get
		// inside that connection to present their own key here.
		if (existsSync(knownHosts)) execFileSync("ssh-keygen", ["-R", alias, "-f", knownHosts], { stdio: "ignore" });
		execFileSync("ssh", ["-o", `ProxyCommand=node "${proxy}" ${sessionId}`, "-o", "StrictHostKeyChecking=accept-new",
			"-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=30", "-i", `${keyDir}/id`, `tenki@${alias}`, "true"], { stdio: "ignore" });
	} else if (mode === "destroy") {
		await sandbox[Symbol.asyncDispose]();
		rmSync(keyDir, { recursive: true, force: true });
		// ssh-keygen -R also handles hashed known_hosts entries, which a line filter would miss.
		if (existsSync(knownHosts)) execFileSync("ssh-keygen", ["-R", alias, "-f", knownHosts], { stdio: "ignore" });
	}
	process.stdout.write(JSON.stringify({ ok: true, mode }));
}
