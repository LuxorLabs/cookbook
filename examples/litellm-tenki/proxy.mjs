// Shared by run.mjs and verify.mjs: workspace secrets + request policy, the sticky proxy
// sandbox, and the named preview URL. Runs on Node 20.
export const LITELLM_VERSION = "1.106.5";
export const PORT = 4000;

// Which outbound requests may carry each secret. The proxy sends `secrets://NAME` in the
// listed header; Tenki swaps in the real value at egress, only for this origin and path.
export const PROVIDERS = {
	OPENAI_API_KEY: { model: "openai/gpt-5-mini", origin: "https://api.openai.com", header: "Authorization" },
	ANTHROPIC_API_KEY: { model: "anthropic/claude-sonnet-4-5", origin: "https://api.anthropic.com", header: "x-api-key" },
};

// One LiteLLM model per provider; each key is read from an env var that holds only the reference.
const configYaml = (keys) =>
	"model_list:\n" +
	keys.map((k) => `  - model_name: ${PROVIDERS[k].model.split("/")[1]}\n    litellm_params:\n      model: ${PROVIDERS[k].model}\n      api_key: os.environ/${k}\n`).join("") +
	"general_settings:\n  master_key: os.environ/LITELLM_MASTER_KEY\n";

// Find a workspace secret (kind "secrets") or request policy (kind "policies") by name.
export async function findByName(ws, kind, name) {
	const api = kind === "secrets" ? ws.secrets : ws.secrets.policies;
	let cursor = "";
	do {
		const page = await api.list({ pageSize: 100, cursor }); // the API rejects pageSize > 100
		const hit = page[kind].find((x) => x.name === name);
		if (hit) return hit;
		cursor = page.nextCursor;
	} while (cursor);
}

// Create the secret, or replace its value if the name already exists.
export async function upsertSecret(ws, name, value) {
	const bytes = new TextEncoder().encode(value);
	const old = await findByName(ws, "secrets", name);
	return old ? ws.secrets.update(old.id, { value: bytes, expectedRevision: old.revision }) : ws.secrets.create(name, bytes);
}

// Create the request policy, or replace its rules if the name already exists.
// `refs` maps each provider env var (a PROVIDERS key) to the workspace secret name it uses.
export async function upsertPolicy(ws, name, refs) {
	const rules = Object.entries(refs).map(([k, secret]) => ({
		origin: PROVIDERS[k].origin, methods: ["GET", "POST"], pathPrefix: "/v1/", header: PROVIDERS[k].header, secrets: [secret],
	}));
	const old = await findByName(ws, "policies", name);
	return old ? ws.secrets.policies.update(old.id, rules, { expectedRevision: old.revision }) : ws.secrets.policies.create(name, rules);
}

// Sticky sandbox that runs until terminated; outbound requests go through the selected policy.
export async function startProxy(tenki, { name, policy, refs, masterKey, workspaceId }) {
	const sandbox = await tenki.createAndWait({
		name, cpuCores: 2, memoryMb: 4096, sticky: true, allowInbound: true, secretPolicies: [policy], workspaceId,
	});
	try {
		const sh = async (cmd, env) => {
			const r = await sandbox.exec("bash", { args: ["-c", cmd], env, cwd: "/home/tenki", timeoutMs: 600_000 });
			if (r.exitCode !== 0) throw new Error(`${cmd.slice(0, 60)}… exited ${r.exitCode}: ${Buffer.from(r.stderr ?? "").toString().slice(-800)}`);
		};
		await sh(`uv venv -q litellm && uv pip install -q --python litellm/bin/python 'litellm[proxy]==${LITELLM_VERSION}'`);
		await sandbox.writeFile("/home/tenki/config.yaml", configYaml(Object.keys(refs)));
		const env = { LITELLM_MASTER_KEY: masterKey };
		for (const [k, name] of Object.entries(refs)) env[k] = `secrets://${name}`;
		await sh(`setsid litellm/bin/litellm --config config.yaml --port ${PORT} >litellm.log 2>&1 </dev/null &`, env);
		await sh(`for i in $(seq 90); do curl -sf localhost:${PORT}/health/liveliness >/dev/null && exit 0; sleep 1; done; tail -20 litellm.log >&2; exit 1`);
		return sandbox;
	} catch (e) {
		await sandbox.close().catch(() => {});
		throw e;
	}
}

// Point the named preview URL at the sandbox: create it, or re-bind it if the slug exists.
// Returns the URL and the session it pointed at before, if any.
export async function pointUrl(tenki, slug, sandbox) {
	const old = (await tenki.previewUrls.list({ workspaceId: sandbox.workspaceId })).find((u) => u.slug === slug);
	if (!old) return { url: await tenki.previewUrls.create(slug, { sessionId: sandbox.id, port: PORT, workspaceId: sandbox.workspaceId }) };
	if (old.sessionId) {
		// Only take over a URL that points at an earlier proxy (sandboxes are named after the slug).
		const prev = await tenki.get(old.sessionId).catch(() => undefined);
		if (prev && prev.name !== slug && !["TERMINATED", "TERMINATING"].includes(prev.state)) {
			throw new Error(`preview URL "${slug}" is bound to sandbox ${prev.name}; pick another slug`);
		}
		await tenki.previewUrls.unbind(old.id); // bind() refuses a URL that is already bound
	}
	return { url: await tenki.previewUrls.bind(old.id, sandbox.id, PORT), previousSessionId: old.sessionId };
}
