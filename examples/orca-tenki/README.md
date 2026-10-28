# orca

Give each of your orca coding agents its own cloud machine with your repo on it, instead of running them all on your laptop.

[orca](https://github.com/stablyai/orca) is an open-source app for running several coding agents, such as Claude Code or Codex, side by side on one repo. Each agent works in its own **workspace**: by default, a separate copy of your repo (a git worktree) on your machine.

orca has an experimental **Cloud VM** setting that puts each workspace on a remote machine instead. You give orca a **recipe**: a command it runs with one of four modes, `create`, `suspend`, `resume`, or `destroy`, to manage that machine. `create` prints JSON telling orca how to reach the machine over SSH, and orca connects there to run the agent.

This folder is a recipe for Tenki. `create` starts a sandbox with your repo cloned and prints SSH details, `suspend` pauses it for free, `resume` brings it back, and `destroy` deletes it.

> **Status:** orca v1.4.224 doesn't fully accept the machine yet. orca expects the repo to be checked out on the workspace's branch and commit, and expects `resume` to print fresh connection details. `recipe.mjs` doesn't do either yet ([Troubleshooting](#troubleshooting) has the errors), so you can run each mode by hand but not a full orca session.

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

`create.json` is the connection info orca would read. `destroy` prints `{"ok":true,"mode":"destroy"}`. To try `suspend` and `resume`, pipe the same `printf` output to `node recipe.mjs suspend` and `node recipe.mjs resume` before destroying.

### 4. Verify

```bash
node verify.mjs
```

```
✓ orca-tenki: recipe create → ssh (yocto-queue) → suspend → resume → ssh again → destroy
```

`verify.mjs` runs `recipe.mjs` once per mode, the way orca would. It checks the JSON `create` printed, connects over SSH using only that JSON, checks the user and the cloned repo, suspends, resumes, connects again, and destroys the sandbox (even if a step fails). It doesn't run orca itself.

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

Keep `checkoutMode: provisioned-root`, which tells orca the recipe clones the repo itself. orca rejects a result whose mode doesn't match. Make sure `TENKI_AUTH_TOKEN` is in orca's environment, since orca passes it to the recipe and to the `ssh` that runs `ssh-proxy.mjs`.

orca runs `create` from your checkout and sets `ORCA_REPO_URL`. The recipe clones it into `/home/tenki/repo`, or the checkout's `origin` if it's empty.

## How the recipe works

`create` makes an SSH key pair under `~/.tenki-orca/`, starts a sandbox with the repo cloned and the public key installed, and asks Tenki for a short-lived SSH certificate that lets that key log in:

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

It prints the one JSON object orca expects: where to SSH, as whom, with which key, and where the repo is. orca passes `userData` back to later modes, so they know which sandbox to act on:

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

Tenki carries SSH over a WebSocket rather than a plain network port, so a normal `ssh` client can't connect on its own. `ssh-proxy.mjs` fills the gap. It's a `ProxyCommand`, a program `ssh` runs and talks through instead of opening its own connection:

```js
// An ssh ProxyCommand: ssh runs this script and talks through its input and output
// instead of opening a network connection itself. Tenki carries SSH over a WebSocket
// (ws(s)://.../v1/ssh/<id>), so this script relays bytes between ssh and that WebSocket.
import { TenkiSandbox } from "@tenkicloud/sandbox";

const sessionId = process.argv[2];
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });
const conn = await tenki.ssh(sessionId);

// Send chunks one at a time, in order: conn.write is async, and ssh breaks if bytes arrive out of order.
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
    // resume() returns before the sandbox is running again, and other calls fail until it is, so wait.
    const deadline = Date.now() + 120_000;
    while (!isReady(sandbox.state)) {
      if (Date.now() > deadline) throw new Error(`resume timed out: state still ${sandbox.state} after 120s`);
      await new Promise((r) => setTimeout(r, 1000));
      await sandbox.refresh();
    }
```

- `suspend` pauses the sandbox. Pausing is free and keeps memory and disk.
- `resume` waits until the sandbox is running (up to 120 seconds), gets a fresh SSH certificate, saves the server's key again, and prints `{"ok":true,"mode":"resume"}`.
- `destroy` terminates the sandbox and removes its key directory and `known_hosts` entry.

ssh normally checks that a server's **host key** matches the one it saw last time. Here that key belongs to Tenki's SSH gateway rather than the sandbox, and orca's connection settings can't say which name to check it under, so `create` saves it once under a name unique to the sandbox:

```js
  // ssh checks that the server it reaches is the one it saw before (its "host key").
  // Here that key belongs to Tenki's SSH gateway, not to the sandbox, and orca gives ssh
  // no way to say which name to check it under. So connect once now, save the key under
  // a name unique to this sandbox, and later connections are checked against it.
  // Sandbox ids start with a timestamp, so build that name from the random end of the id.
  alias = `tenki-${sandbox.id.replaceAll("-", "").slice(-12)}`;
  mkdirSync(`${homedir()}/.ssh`, { recursive: true });
  if (existsSync(knownHosts)) execFileSync("ssh-keygen", ["-R", alias, "-f", knownHosts], { stdio: "ignore" });
  execFileSync("ssh", ["-o", `ProxyCommand=node "${proxy}" ${sandbox.id}`, "-o", "StrictHostKeyChecking=accept-new",
    "-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=30", "-i", `${keyDir}/id`, `tenki@${alias}`, "true"], { stdio: "ignore" });
```

## Things to know

- Each sandbox gets its own key folder. ssh finds a key's certificate by looking for `<key file>-cert.pub` next to it, and orca has no setting for the certificate, so each sandbox's key and certificate sit together.
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
