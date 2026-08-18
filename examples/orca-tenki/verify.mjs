/**
 * Proves the Tenki-facing half of this example without a model key: drive the recipe
 * exactly as orca does — `create` prints an SSH target, suspend/resume/destroy get it
 * back on stdin — then SSH into the microVM using only what the recipe emitted.
 * Token/workspace from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
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
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}
for (const bin of ["ssh", "ssh-keygen"]) {
	try { execFileSync("command", ["-v", bin], { shell: true, stdio: "ignore" }); }
	catch { console.error(`✗ ${bin} not found; this example needs an OpenSSH client.`); process.exit(1); }
}

const env = { ...process.env, TENKI_AUTH_TOKEN: authToken, ORCA_REPO_URL: "https://github.com/sindresorhus/yocto-queue" };
const recipe = (mode, payload) =>
	execFileSync("node", ["recipe.mjs", mode], { env, input: payload ? JSON.stringify(payload) : undefined, timeout: 300_000 }).toString();
const sshIn = (t, cmd) =>
	execFileSync("ssh", ["-o", `ProxyCommand=${t.proxyCommand}`, "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=30",
		"-i", t.identityFile, `${t.username}@${t.host}`, cmd], { env, timeout: 120_000 }).toString().trim();

let result;
try {
	result = JSON.parse(recipe("create"));
	const t = result.connection.target;
	if (result.schemaVersion !== 2 || result.checkoutMode !== "provisioned-root") throw new Error(`bad result envelope: ${JSON.stringify(result).slice(0, 160)}`);
	if (result.connection.projectRoot !== "/home/tenki/repo") throw new Error(`projectRoot was ${result.connection.projectRoot}`);

	// Nothing here knows the session id — only what the recipe printed, same as orca.
	const who = sshIn(t, "whoami; cat /home/tenki/repo/package.json | head -3");
	if (!who.startsWith("tenki") || !who.includes("yocto-queue")) throw new Error(`ssh returned ${JSON.stringify(who)}`);

	recipe("suspend", { recipeResult: result });
	recipe("resume", { recipeResult: result });
	const after = sshIn(t, "echo resumed-ok");
	if (after !== "resumed-ok") throw new Error(`after resume, ssh returned ${JSON.stringify(after)}`);

	recipe("destroy", { recipeResult: result });
	result = null;
	console.log("✓ orca-tenki: recipe create → ssh into the microVM → yocto-queue → suspend → resume → ssh again → destroy");
} catch (e) {
	console.error("✗ " + (e?.stderr?.toString()?.trim() || e?.message || e));
	process.exitCode = 1;
} finally {
	if (result) {
		try { recipe("destroy", { recipeResult: result }); } catch { /* self-reaps via idle/lifetime caps */ }
	}
}
