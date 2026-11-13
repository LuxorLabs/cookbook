// Deploy (or redeploy) a LiteLLM proxy in a sticky Tenki sandbox behind a named preview URL.
//   node run.mjs        upload provider keys as workspace secrets, start the proxy, point the URL at it
//   node run.mjs down   delete the URL, the sandbox, the policy, and the secrets
import { TenkiSandbox, WorkspaceClient } from "@tenkicloud/sandbox";
import { randomBytes } from "node:crypto";
import { PROVIDERS, findByName, pointUrl, startProxy, upsertPolicy, upsertSecret } from "./proxy.mjs";

const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY;
if (!authToken) throw new Error("missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY");
const workspaceId = process.env.TENKI_WORKSPACE_ID;
const SLUG = process.env.LITELLM_SLUG || "litellm";
const POLICY = `${SLUG}-providers`; // request policy name
const secretName = (k) => `LITELLM_${k}`; // workspace secret name for each provider key

const tenki = new TenkiSandbox({ authToken });
const ws = new WorkspaceClient({ authToken, workspaceId });
const urlBySlug = async () => (await tenki.previewUrls.list({ workspaceId })).find((u) => u.slug === SLUG);

try {
	if (process.argv[2] === "down") {
		const url = await urlBySlug();
		const sandbox = url?.sessionId && (await tenki.get(url.sessionId));
		if (sandbox && sandbox.name !== SLUG) throw new Error(`preview URL "${SLUG}" is bound to sandbox ${sandbox.name}, not this proxy`);
		if (url) await tenki.previewUrls.delete(url.id);
		if (sandbox) await sandbox.close();
		const policy = await findByName(ws, "policies", POLICY);
		if (policy) await ws.secrets.policies.delete(policy.id, { expectedRevision: policy.revision });
		for (const k of Object.keys(PROVIDERS)) {
			const s = await findByName(ws, "secrets", secretName(k));
			if (s) await ws.secrets.delete(s.id, { expectedRevision: s.revision });
		}
		console.log(`removed ${SLUG}: URL, sandbox, policy ${POLICY}, secrets`);
	} else {
		await deploy();
	}
} finally {
	await ws.close();
}

async function deploy() {
	// 1. Provider keys go from this shell to the workspace secret store, never to the sandbox.
	//    On a redeploy, keys that are not set locally keep their stored value.
	for (const k of Object.keys(PROVIDERS)) if (process.env[k]) await upsertSecret(ws, secretName(k), process.env[k]);
	const refs = {};
	for (const k of Object.keys(PROVIDERS)) if (await findByName(ws, "secrets", secretName(k))) refs[k] = secretName(k);
	if (!Object.keys(refs).length) throw new Error(`set at least one of ${Object.keys(PROVIDERS).join(", ")}`);

	// 2. The policy that lets those secrets leave the sandbox, only toward each provider's API.
	await upsertPolicy(ws, POLICY, refs);

	// 3. The proxy. Its master key is the only credential that lives in the sandbox.
	const masterKey = process.env.LITELLM_MASTER_KEY || `sk-${randomBytes(24).toString("hex")}`;
	const sandbox = await startProxy(tenki, { name: SLUG, policy: POLICY, refs, masterKey, workspaceId });

	// 4. Same URL as last time: re-bind it to the new sandbox, then retire the old one.
	const { url, previousSessionId } = await pointUrl(tenki, SLUG, sandbox).catch(async (e) => {
		await sandbox.close(); // a sticky sandbox would otherwise run until someone terminates it
		throw e;
	});
	if (previousSessionId && previousSessionId !== sandbox.id) {
		await (await tenki.get(previousSessionId)).close().catch(() => {});
	}

	const models = Object.keys(refs).map((k) => PROVIDERS[k].model.split("/")[1]).join(", ");
	console.log(`proxy:   ${url.previewUrl}\nsandbox: ${sandbox.id}\nmodels:  ${models}`);
	if (!process.env.LITELLM_MASTER_KEY) console.log(`\nexport LITELLM_MASTER_KEY=${masterKey}   # save it; redeploys reuse it`);
}
