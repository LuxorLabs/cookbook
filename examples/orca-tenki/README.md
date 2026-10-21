# orca

Back [orca](https://github.com/stablyai/orca)'s Cloud VM recipe with Tenki sandboxes. orca normally runs each coding agent in a git worktree on your machine. Its ephemeral-VM recipe hook (**Cloud VM** in orca's settings) runs a command you supply to `create`, `suspend`, `resume`, and `destroy` a machine per workspace. This folder is that command: it boots a Tenki sandbox with your repo cloned, hands orca an SSH target, and pauses, resumes, and destroys it.

> **Status:** orca v1.4.224 doesn't adopt the machine yet. orca wants the checkout on the workspace's branch at the commit it pinned, and wants `resume` to print a fresh recipe result; `recipe.mjs` does neither yet ([Troubleshooting](#troubleshooting) has the errors). CI skips this example because Tenki's gateway SSH host keys change between connections.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the orca Cloud VM recipe backed by Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/main/examples/orca-tenki.
1. Clone https://github.com/LuxorLabs/cookbook, cd into examples/orca-tenki, check that Node.js is 20+ and ssh and ssh-keygen are installed, and run npm install.
2. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud) exported in the shell. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
3. Run node verify.mjs and confirm the ✓ line. It creates, suspends, resumes, and destroys one sandbox.
4. Tell me the recipe doesn't yet pass orca's branch check or resume contract (see Status in the README) before wiring it into orca. If I still want it, add the environmentRecipes block from the README to orca.yaml in my primary checkout, with the absolute path to recipe.mjs.
5. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Node.js 20 or later and npm.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An OpenSSH client (`ssh` and `ssh-keygen`).
- [orca](https://github.com/stablyai/orca), only to wire it in.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/orca-tenki
npm install
```

The only dependency is `@tenkicloud/sandbox` (`>=1.4.1`).

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`recipe.mjs` and `ssh-proxy.mjs` read only these variables, so whatever runs the recipe (you, or orca) needs one in its environment. `verify.mjs` also accepts a `tenki login` key. `TENKI_WORKSPACE_ID` is optional.

### 3. Run

Create a sandbox with a small public repo cloned, then destroy it:

```bash
ORCA_REPO_URL=https://github.com/sindresorhus/yocto-queue node recipe.mjs create > create.json
cat create.json
printf '{"recipeResult":%s}' "$(cat create.json)" | node recipe.mjs destroy && rm create.json
```

`create.json` is the JSON orca reads. `destroy` prints `{"ok":true,"mode":"destroy"}`. To try `suspend` and `resume`, pipe the same `printf` output to `node recipe.mjs suspend` and `node recipe.mjs resume` before destroying.

### 4. Verify

```bash
node verify.mjs
```

```
✓ orca-tenki: recipe create → ssh (yocto-queue) → suspend → resume → ssh again → destroy
```

`verify.mjs` runs `recipe.mjs` once per mode as orca would, checks the `create` result's shape, connects over SSH with only what `create` printed, checks the user and the cloned repo, suspends, resumes, connects again, and destroys the sandbox (also on failure). It doesn't run orca.

## Wire it into orca

Turn on **Cloud VM** under **Settings → Experimental**. Then add the recipe to `orca.yaml` in your repo's primary checkout, with the absolute path to this folder:

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

Keep `checkoutMode: provisioned-root`; orca rejects a result whose mode doesn't match. Make sure `TENKI_AUTH_TOKEN` is in orca's environment, since orca passes it to the recipe and to the `ssh` that runs `ssh-proxy.mjs`.

orca runs `create` from your checkout and sets `ORCA_REPO_URL`. The recipe clones it into `/home/tenki/repo`, or the checkout's `origin` if it's empty.

## How the recipe works

`create` makes an ed25519 keypair under `~/.tenki-orca/`, boots a sandbox with the repo cloned and the key installed, and mints an SSH certificate:

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

It prints the one JSON object orca expects. `userData` carries the session id to later modes:

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

Tenki carries SSH over a WebSocket, so `ssh-proxy.mjs` is a `ProxyCommand` that bridges a stock `ssh` client to it:

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

`suspend`, `resume`, and `destroy` read `{"recipeResult": <create output>}` on stdin:

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

- `suspend` pauses the sandbox. Pausing is free and keeps memory and disk.
- `resume` polls until the sandbox is running (up to 120 seconds), mints a fresh certificate, re-learns the host key, and prints `{"ok":true,"mode":"resume"}`.
- `destroy` terminates the sandbox and removes its key directory and `known_hosts` entry.

The SSH host key belongs to Tenki's gateway, and orca's target has no `HostKeyAlias`, so `create` learns the key once under a per-sandbox alias:

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

## Things to know

- Each sandbox gets its own key directory because OpenSSH loads the certificate from `<identityFile>-cert.pub`, and orca's target has no certificate field.
- Log in as `tenki`. The repo is at `/home/tenki/repo`.
- The recipe sets no lifetime cap, so a sandbox orca never destroys runs until your workspace's maximum duration.
- Private repos are untested; the recipe passes no Git credentials.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `` No token. Set TENKI_AUTH_TOKEN, or run `tenki login`. `` from `verify.mjs` | Export a key or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY …` | Export `TENKI_AUTH_TOKEN` where the recipe runs, including orca's environment. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `✗ ssh not found; this example needs an OpenSSH client.` | Install the OpenSSH client. |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` for a `tenki-…` host | Gateway host keys rotate. Run `destroy`, then `create` again. |
| `Recipe result requests provisioned-root checkout, but the recipe is not configured for it.` | Add `checkoutMode: provisioned-root` to the `orca.yaml` entry. |
| `The recipe projectRoot is not checked out on Orca's requested branch.` or `… was not created from Orca's requested ref.` | Known gap: `create` doesn't check out `ORCA_REPO_BRANCH` at `ORCA_REPO_REF_HEAD` yet. See orca's [provisioned-root guide](https://github.com/stablyai/orca/blob/v1.4.224/skill-guides/orca-per-workspace-env/references/ssh-host.md#provisioned-root). |
| A woken workspace goes to `resume_failed` | Known gap: `resume` needs to print a full recipe result. |
| The recipe isn't offered when you create a workspace | Commit `orca.yaml` on the primary branch, and turn on Cloud VM. |

## Related

- [orca](https://github.com/stablyai/orca) and its [Cloud VM docs](https://www.onorca.dev/docs/ways-to-run#4-cloud-vms-per-workspace-environments)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
- [Pause, snapshot, and resume](../snapshots-pause-resume/) and [Expose a port](../expose-a-port/)
