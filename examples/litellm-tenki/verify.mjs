// Proves this example with no provider key: store a fake OpenAI key as a workspace secret, attach a
// request policy, start the LiteLLM proxy in a sticky sandbox, and serve it on a named preview URL.
// Asserts health, master-key auth, the model list, and that OpenAI received the stored value (its
// 401 echoes the key's last 4 characters). Deletes URL, sandbox, policy, and secret in `finally`.
import { TenkiSandbox, WorkspaceClient } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { pointUrl, startProxy, upsertPolicy, upsertSecret } from "./proxy.mjs";

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

const id = randomBytes(3).toString("hex"); // unique names so parallel runs don't collide
const SECRET = `LITELLM_VERIFY_${id.toUpperCase()}`;
const FAKE_KEY = `sk-fake-${randomBytes(8).toString("hex")}`;
const MASTER = `sk-${randomBytes(16).toString("hex")}`;
const tenki = new TenkiSandbox({ authToken });
const ws = new WorkspaceClient({ authToken, workspaceId });
const call = async (path, key, body) => {
	const res = await fetch(url.previewUrl + path, {
		method: body ? "POST" : "GET", body: body && JSON.stringify(body),
		headers: { "content-type": "application/json", ...(key && { authorization: `Bearer ${key}` }) },
	});
	return { status: res.status, text: await res.text() };
};
let secret, policy, sandbox, url;
try {
	secret = await upsertSecret(ws, SECRET, FAKE_KEY);
	policy = await upsertPolicy(ws, `litellm-verify-${id}`, { OPENAI_API_KEY: SECRET });
	sandbox = await startProxy(tenki, { name: `litellm-verify-${id}`, policy: policy.name, refs: { OPENAI_API_KEY: SECRET }, masterKey: MASTER, workspaceId });
	({ url } = await pointUrl(tenki, `litellm-verify-${id}`, sandbox));
	console.log(`  proxy: ${url.previewUrl} (sticky=${sandbox.sticky})`);

	let health;
	for (let i = 0; i < 20 && health?.status !== 200; i++) {
		health = await call("/health/liveliness").catch(() => undefined);
		if (health?.status !== 200) await new Promise((r) => setTimeout(r, 3000));
	}
	if (health?.status !== 200) throw new Error(`/health/liveliness: ${health?.status}`);

	// LiteLLM without a database rejects a missing key with 500 and a wrong key with 400, not 401.
	for (const key of [undefined, "sk-wrong"]) {
		const r = await call("/v1/models", key);
		if (r.status < 400 || r.text.includes("gpt-5-mini")) throw new Error(`key ${key}: got ${r.status} ${r.text}`);
	}
	const models = await call("/v1/models", MASTER);
	if (models.status !== 200 || !JSON.parse(models.text).data.some((m) => m.id === "gpt-5-mini")) {
		throw new Error(`/v1/models with master key: ${models.status} ${models.text}`);
	}

	// The proxy sent `Bearer secrets://SECRET`; OpenAI's 401 shows the tail of what it actually got.
	const chat = await call("/v1/chat/completions", MASTER, { model: "gpt-5-mini", messages: [{ role: "user", content: "hi" }] });
	if (!new RegExp(`sk-fake-\\*+${FAKE_KEY.slice(-4)}`).test(chat.text)) throw new Error(`egress injection: ${chat.status} ${chat.text}`);
	console.log(`✓ litellm-tenki: sticky proxy → named URL → health 200 → no/wrong key rejected → models [gpt-5-mini] → OpenAI saw the stored key (…${FAKE_KEY.slice(-4)})`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	const step = (p) => p.catch((e) => console.error(`  cleanup: ${e?.message ?? e}`));
	if (url) await step(tenki.previewUrls.delete(url.id));
	if (sandbox) await step(sandbox.close());
	if (policy) await step(ws.secrets.policies.delete(policy.id, { expectedRevision: policy.revision }));
	if (secret) await step(ws.secrets.delete(secret.id, { expectedRevision: secret.revision }));
	await ws.close();
}
