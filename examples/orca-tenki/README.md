# How to back orca's Cloud VM recipe with Tenki sandboxes

An orca ephemeral-VM recipe boots a [Tenki Sandbox](https://tenki.cloud/products/sandbox) with your repo cloned, hands orca an SSH target for it, and pauses, resumes, and destroys it. `node verify.mjs` prints a `✓` line once the Tenki side works. orca itself cannot adopt the machine yet.

About 15 minutes, including a verify run that boots a sandbox, clones a repo into it, pauses and resumes it, and destroys it.

`verify.mjs` drives the recipe the way orca does, and it does not run orca. The recipe does not yet meet two checks in orca's current release (v1.4.224). orca wants the cloned checkout on the workspace's own branch at the commit it asked for, and it wants `resume` to print a fresh recipe result. Until `recipe.mjs` handles both, orca refuses the machine when it creates a workspace and marks a woken workspace `resume_failed`. [Troubleshooting](#troubleshooting) has the exact errors. The repo's CI also skips this example, because Tenki's gateway SSH host keys change between connections.

orca normally isolates each agent in a git worktree on your machine. Its ephemeral-VM recipe hook (labeled **Cloud VM** in orca's settings) lets you put each workspace on its own machine instead: orca runs a command you supply for `create`, `suspend`, `resume`, and `destroy`, and `create` prints the SSH target orca dials. This folder is that command, backed by Tenki sandboxes:

- [`recipe.mjs`](recipe.mjs) is the recipe. Pass it the lifecycle mode as its only argument.
- [`ssh-proxy.mjs`](ssh-proxy.mjs) is the `ProxyCommand` that carries `ssh` to a sandbox.
- [`verify.mjs`](verify.mjs) runs the whole lifecycle against the live Tenki API.

## Prerequisites

- A Tenki API key (`tk_…`). Create one at https://app.tenki.cloud.
- Node.js 20 or later, with npm.
- (Optional) The Tenki CLI, for `tenki login`. Only `verify.mjs` reads the key it saves.
- An OpenSSH client (`ssh` and `ssh-keygen`) on the machine that runs orca. The recipe generates its keys with `ssh-keygen` and connects with `ssh`, and `verify.mjs` checks for both before it starts.
- [orca](https://github.com/stablyai/orca), for Step 5 only. The check in Step 6 doesn't need it.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/orca-tenki
```

Every later command runs from this directory unless a step says otherwise.

## Step 2 — Install

```bash
npm install
```

The only dependency is the Tenki SDK:

```json
{
  "name": "orca-tenki",
  "private": true,
  "type": "module",
  "description": "Cookbook example — Tenki sandboxes as orca ephemeral-VM recipes.",
  "dependencies": {
    "@tenkicloud/sandbox": ">=1.4.1"
  }
}
```

## Step 3 — Authenticate

Export your key:

```bash
export TENKI_AUTH_TOKEN=<your-tk_-key>  # TENKI_API_KEY works too
```

**`recipe.mjs` and `ssh-proxy.mjs` read only `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`.** They don't read `~/.config/tenki/config.yaml`, and neither does the SDK, so anything that runs the recipe, whether you in Step 4 or orca in Step 5, needs one of those variables in its environment.

Saving the key with the Tenki CLI is optional, and it helps only `verify.mjs`, which falls back to the `auth_token` that `tenki login` saved and passes it on to the recipe:

```bash
tenki login --api-key <your-tk_-key>    # stores it in ~/.config/tenki/config.yaml
```

`TENKI_WORKSPACE_ID` is optional. The recipe passes it to `createAndWait` when it's set, but a workspace API key doesn't need it, because Tenki infers the workspace from the key.

## Step 4 — Run the recipe by hand

This step is optional. It shows what orca gets from each command.

`create` makes an ed25519 keypair in its own directory under `~/.tenki-orca/`, then boots a 2 vCPU, 4096 MB sandbox with the repo cloned and the public key installed, and mints an SSH certificate for that key. From `recipe.mjs`:

```js
    sandbox = await tenki.createAndWait({
      cpuCores: 2,
      memoryMb: 4096,
      cloneRepoUrl: repoUrl,
      sshAuthorizedKeys: [publicKey],
      workspaceId: process.env.TENKI_WORKSPACE_ID,
    });
    const cert = await tenki.issueSandboxSSHCert(sandbox.id, publicKey);
    writeFileSync(`${keyDir}/id-cert.pub`, cert.sshCert.trim() + "\n");
```

It clones `ORCA_REPO_URL` if that's set (orca sets it), and otherwise the `origin` remote of the directory it runs in. Run from this folder without `ORCA_REPO_URL`, it would clone the cookbook itself, so point it at the small public repo `verify.mjs` uses:

```bash
ORCA_REPO_URL=https://github.com/sindresorhus/yocto-queue node recipe.mjs create > create.json
cat create.json
```

`create.json` now holds the one JSON object orca expects on stdout. `recipe.mjs` prints it with this call, and `userData` is where the session id travels to the later commands:

```js
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
```

The `proxyCommand` runs `ssh-proxy.mjs` with the session id. Tenki carries SSH over a WebSocket rather than a TCP port, so a stock `ssh` client reaches a sandbox through a `ProxyCommand`. This is the whole bridge:

```js
// ssh(1) ProxyCommand: bridges stdio <-> a Tenki sandbox's SSH WebSocket transport.
// Tenki carries SSH over ws(s)://.../v1/ssh/<id>, so a stock ssh client needs this shim.
import { TenkiSandbox } from "@tenkicloud/sandbox";

const sessionId = process.argv[2];
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });
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
process.exit(0);
```

Because the target sets `proxyCommand`, orca connects with your system `ssh`, which is what loads the certificate from `<identityFile>-cert.pub` (see [FAQ](#faq)).

`suspend`, `resume`, and `destroy` get that JSON back on stdin as the `recipeResult` field of a JSON object. orca adds other fields, but the recipe reads only this one, so `{"recipeResult": <create output>}` is enough when you run it by hand. Each mode looks the sandbox up by the session id in `userData`. From `recipe.mjs`:

```js
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
```

`suspend` pauses the sandbox. Pausing is free, and a paused sandbox keeps its memory and disk. After `resume`, the recipe also mints a fresh certificate and re-learns the host key, then prints `{"ok":true,"mode":"resume"}`. `destroy` terminates the sandbox and removes its key directory and `known_hosts` entry. Clean up the sandbox you created above:

```bash
printf '{"recipeResult":%s}' "$(cat create.json)" | node recipe.mjs destroy && rm create.json
```

It prints `{"ok":true,"mode":"destroy"}`, and the `rm` then deletes `create.json` from this folder, since `destroy` doesn't touch it. If `destroy` fails, the file stays so you can retry. To try `suspend` and `resume` first, pipe the same `printf` output to `node recipe.mjs suspend` and `node recipe.mjs resume` before you destroy the sandbox.

## Step 5 — Wire it into orca

1. Turn on **Cloud VM** under **Settings → Experimental** in orca.
2. Add the recipe to `orca.yaml` in your repo's primary checkout, the folder you registered in orca. Use the absolute path to this directory, one command per lifecycle mode:

   ```yaml
   environmentRecipes:
     - id: tenki
       name: Tenki sandbox
       checkoutMode: provisioned-root
       create: node /path/to/orca-tenki/recipe.mjs create
       suspend: node /path/to/orca-tenki/recipe.mjs suspend
       resume: node /path/to/orca-tenki/recipe.mjs resume
       destroy: node /path/to/orca-tenki/recipe.mjs destroy
   ```

   Keep `checkoutMode: provisioned-root`. The recipe returns `schemaVersion: 2` with `checkoutMode: "provisioned-root"`, and orca rejects a result whose mode doesn't match the recipe's.
3. Make sure `TENKI_AUTH_TOKEN` (or `TENKI_API_KEY`) is set in the environment orca runs in. orca passes its own environment to recipe commands, and the `ssh` it starts runs `ssh-proxy.mjs`, which needs the key too.

orca runs `create` with your checkout as the working directory and sets `ORCA_REPO_URL` to the remote it resolved the base branch against. The recipe clones that URL into `/home/tenki/repo`, or `origin` if the variable is empty. The opening of this page has the current limits. As written, the recipe does not check out the branch orca asks for.

## Step 6 — Check it works

```bash
node verify.mjs
```

It prints:

```
✓ orca-tenki: recipe create → ssh (yocto-queue) → suspend → resume → ssh again → destroy
```

The check runs `node recipe.mjs` once per mode, as orca would, with `ORCA_REPO_URL` set to `https://github.com/sindresorhus/yocto-queue`. It confirms that `create` returns `schemaVersion: 2`, `checkoutMode: "provisioned-root"`, and a `projectRoot` of `/home/tenki/repo`. It then connects over SSH using only what `create` printed, checks that the user is `tenki` and that the cloned repo's `package.json` names `yocto-queue`, suspends and resumes the sandbox, connects again, and destroys it. If a later step fails, it still runs `destroy` on the sandbox `create` reported. No model key is needed. It doesn't run orca, so it doesn't test orca's branch check or what orca expects from `resume`, and no coding agent runs.

The repo's CI skips this example (see [Troubleshooting](#troubleshooting)), so run the check on your own machine. It uses `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`, falling back to the key `tenki login` saved.

## Troubleshooting

**❌ `` No token. Set TENKI_AUTH_TOKEN, or run `tenki login`. ``** (from `verify.mjs`). The check found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export one, or run `tenki login --api-key <key>`.

**❌ `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** `recipe.mjs` or `ssh-proxy.mjs` ran without either variable. They don't read the key `tenki login` saved. Export `TENKI_AUTH_TOKEN=tk_...` in your shell, or in the environment orca runs in.

**❌ `invalid auth token - API keys and service tokens must start with tk_`.** The SDK accepts only `tk_` API keys. Create one at https://app.tenki.cloud.

**❌ `✗ ssh not found; this example needs an OpenSSH client.`** (from `verify.mjs`, or the same for `ssh-keygen`). Install the OpenSSH client so both are on your `PATH`.

**❌ `REMOTE HOST IDENTIFICATION HAS CHANGED` for a `tenki-…` host.** Tenki's gateways currently rotate SSH host keys across connections, so the key the recipe pinned for that alias can stop matching. Run `destroy`, then `create` again. This is also why the repo's CI skips this example until the gateways present a stable, verifiable host identity.

**❌ orca reports `Recipe result requests provisioned-root checkout, but the recipe is not configured for it.`** Your `orca.yaml` entry is missing `checkoutMode: provisioned-root`. Add it as in Step 5.

**❌ orca reports `The recipe projectRoot is not checked out on Orca's requested branch.` or `The recipe projectRoot was not created from Orca's requested ref.`** For a provisioned-root recipe, orca [checks](https://github.com/stablyai/orca/blob/v1.4.224/src/main/provisioned-root-ssh-adoption.ts) that `projectRoot` is on the workspace's branch (`ORCA_REPO_BRANCH`) at the commit it pinned (`ORCA_REPO_REF_HEAD`). `recipe.mjs` clones `ORCA_REPO_URL` with the SDK's `cloneRepoUrl` and never reads either variable. Until `create` checks out that branch at that commit in `/home/tenki/repo` before it prints its JSON, orca won't adopt the VM. See orca's [provisioned-root guide](https://github.com/stablyai/orca/blob/v1.4.224/skill-guides/orca-per-workspace-env/references/ssh-host.md#provisioned-root).

**❌ A woken workspace goes to `resume_failed`.** orca [parses](https://github.com/stablyai/orca/blob/v1.4.224/src/shared/ephemeral-vm-recipe-runner.ts) whatever `resume` prints as a fresh recipe result: the same shape `create` prints, with the same `projectRoot`, user, identity file, and `proxyCommand`. `recipe.mjs` prints `{"ok":true,"mode":"resume"}`, which orca rejects, even though the sandbox itself resumed. `resume` needs to print a recipe result, and it doesn't yet.

**❌ The Tenki recipe doesn't appear as a Run on option when you create a workspace.** orca's [Cloud VM docs](https://www.onorca.dev/docs/ways-to-run#4-cloud-vms-per-workspace-environments) say recipes only show up once `environmentRecipes` is in the primary checkout's `orca.yaml`, so a recipe that lives only on a feature branch is never offered. Commit `orca.yaml` on the primary branch, and check that Cloud VM is on under Settings → Experimental.

## FAQ

**When shouldn't I use this?**
- When you need orca to create and wake workspaces with it today, unchanged. The recipe doesn't yet meet orca's branch check or its `resume` output contract (see [Troubleshooting](#troubleshooting)).
- When you need every SSH connection to succeed. Tenki's gateways currently rotate host keys, so a connection to the pinned alias can fail intermittently.
- When your repo is private. The recipe passes no Git credentials to the sandbox, and `verify.mjs` only clones a public repo, so private repos are untested here.
- When the machine that runs orca has no OpenSSH client.

**Why doesn't the recipe pin the sandbox's own SSH host key?** The host key `ssh` sees belongs to Tenki's gateway, not to the sandbox's own `sshd`. Reading `/etc/ssh/ssh_host_ed25519_key.pub` inside the guest and pinning that fails with `REMOTE HOST IDENTIFICATION HAS CHANGED`. `cert.caPub` signs the gateway's host certificates, but their principals are gateway hostnames such as `sandbox-edge-us-prod-1.us.sb.tenki.sh`, not the per-sandbox alias, so a `@cert-authority` line for the alias is rejected as `name is not a listed principal`. orca's SSH target has no `HostKeyAlias` field to map one onto the other. Instead, `create` makes one throwaway connection with `StrictHostKeyChecking=accept-new` under a per-sandbox alias, so every later connection verifies the key normally instead of skipping the check. From `recipe.mjs`:

```js
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
```

`resume` drops that pin and learns the key again, because a resumed session can come back behind a different gateway with a different host key.

**Why does every sandbox get its own key directory?** The certificate has to live at `<identityFile>-cert.pub`. orca's SSH target schema has no certificate field, so the only way to attach one is the filename OpenSSH loads next to the key. Since every sandbox is issued its own certificate, each one also gets its own key directory rather than sharing one key.

**Which user do I log in as?** `tenki`. The issued user certificate has empty principals, so any username is accepted, but the sandbox account is `tenki` and the repo is at `/home/tenki/repo`.

**Why does `resume` poll before it returns?** `sandbox.resume()` returns while the session is still `RESUMING`, and calling anything else right away fails with `session not RUNNING (state=RESUMING)`. The recipe polls `sandbox.refresh()` once a second until `isReady(sandbox.state)`, and gives up after 120 seconds with `resume timed out: state still <state> after 120s`. It also mints a fresh certificate on resume, since certificates are short-lived.

**What does the recipe leave on my machine?** One key directory per sandbox under `~/.tenki-orca/`, and one `known_hosts` entry per `tenki-…` alias. `destroy` removes both. It uses `ssh-keygen -R`, which also handles hashed `known_hosts` entries, so a long-lived fleet doesn't leave a trail of dead aliases.

**What happens to a sandbox orca never destroys?** The recipe sets no lifetime cap, so the sandbox runs until your workspace's max-duration default. If you ran `create` by hand, clean up with the `printf … | node recipe.mjs destroy` command from Step 4.

## Related

- [orca](https://github.com/stablyai/orca) and its [Cloud VM docs](https://www.onorca.dev/docs/ways-to-run#4-cloud-vms-per-workspace-environments).
- orca's guide to [SSH recipes and provisioned root](https://github.com/stablyai/orca/blob/v1.4.224/skill-guides/orca-per-workspace-env/references/ssh-host.md), at v1.4.224.
- [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) on npm, and the [Tenki docs](https://tenki.cloud/docs).
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/), pause and resume on their own.
- [`../expose-a-port/`](../expose-a-port/), reaching a server in a sandbox through a public preview URL instead of over SSH.
