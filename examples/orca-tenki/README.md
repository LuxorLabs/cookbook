# orca on Tenki (one microVM per agent)

[orca](https://github.com/stablyai/orca) runs a fleet of coding agents in parallel, isolating each one in a git worktree on your machine. Its *ephemeral VM recipe* hook lets you put each agent on its own machine instead: orca runs a command you supply for `create`, `suspend`, `resume`, and `destroy`, and that command hands back an SSH target. This is that command, backed by [Tenki Sandbox](https://tenki.cloud/products/sandbox) microVMs.

## The recipe (`recipe.mjs`)

`create` boots a sandbox with the repo already cloned, mints an SSH certificate for it, and prints the one JSON object orca expects on stdout:

```js
const sandbox = await tenki.createAndWait({ cpuCores: 2, memoryMb: 4096, cloneRepoUrl: repoUrl, sshAuthorizedKeys: [publicKey] });
const cert = await tenki.issueSandboxSSHCert(sandbox.id, publicKey);
writeFileSync(`${keyDir}/id-cert.pub`, cert.sshCert.trim() + "\n");

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
```

`suspend`, `resume`, and `destroy` receive that JSON back on stdin as `recipeResult`, so `userData` is where the session id travels:

```js
const { sessionId, keyDir, alias } = recipeResult.userData;
const sandbox = await tenki.get(sessionId);
if (mode === "suspend") await sandbox.pause();
else if (mode === "resume") { await sandbox.resume(); /* wait for RUNNING, re-issue cert */ }
else if (mode === "destroy") await sandbox[Symbol.asyncDispose]();
```

## The SSH bridge (`ssh-proxy.mjs`)

Tenki carries SSH over a WebSocket rather than a TCP port, so a stock `ssh` client reaches it through a `ProxyCommand`. That is the whole bridge:

```js
const conn = await tenki.ssh(sessionId);

// Serialize writes; conn.write is async and ssh will not tolerate reordered bytes.
let tail = Promise.resolve();
process.stdin.on("data", (c) => { tail = tail.then(() => conn.write(new Uint8Array(c))).catch(() => {}); });
process.stdin.on("end", () => { tail.then(() => conn.close()); });

for (;;) {
  const data = await conn.read();
  if (data === null) break;
  process.stdout.write(Buffer.from(data));
}
```

## Wire it into orca

Point orca's `environmentRecipes` at the recipe, one command per lifecycle mode:

```yaml
environmentRecipes:
  - id: tenki
    name: Tenki microVM
    checkoutMode: provisioned-root
    create: node /path/to/orca-tenki/recipe.mjs create
    suspend: node /path/to/orca-tenki/recipe.mjs suspend
    resume: node /path/to/orca-tenki/recipe.mjs resume
    destroy: node /path/to/orca-tenki/recipe.mjs destroy
```

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
node recipe.mjs create           # prints the SSH target JSON; clones `origin` of the cwd repo
```

Needs an OpenSSH client (`ssh`, `ssh-keygen`) on the host.

Verify the whole lifecycle against the live API:

```bash
node verify.mjs   # create → ssh in → suspend → resume → ssh again → destroy
```

## Notes

- **The SSH host key belongs to Tenki's gateway, not to the sandbox's own `sshd`.** Reading `/etc/ssh/ssh_host_ed25519_key.pub` inside the guest and pinning *that* fails with `REMOTE HOST IDENTIFICATION HAS CHANGED`. `cert.caPub` does not help either — despite the name it signs *user* certs, so `@cert-authority` in `known_hosts` is rejected as `name is not a listed principal`. The recipe instead makes one throwaway connection at `create` with `StrictHostKeyChecking=accept-new` under a per-sandbox alias, so every later connection verifies normally rather than skipping the check.
- **The certificate has to live at `<identityFile>-cert.pub`.** orca's SSH target schema has no certificate field, and OpenSSH auto-loads that filename — which is why each sandbox gets its own key directory rather than one shared key.
- The issued user certificate has **empty principals**, so any username works; the sandbox account is `tenki`.
- **`resume()` returns while the session is still `RESUMING`.** Calling anything else immediately fails with `session not RUNNING (state=RESUMING)`; poll `sandbox.refresh()` until `isReady(sandbox.state)`. The recipe also mints a fresh certificate on resume, since they are short-lived.
- `destroy` removes the key directory and the `known_hosts` line it added, so a long-lived fleet does not leave a trail of dead aliases behind.
- The same pause/resume pair on its own is [snapshots-pause-resume](../snapshots-pause-resume/); the port-exposing counterpart is [expose-a-port](../expose-a-port/).
