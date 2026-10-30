# Claude Code over SSH

Run one command and land in an interactive Claude Code session inside a fresh Tenki sandbox. `tenki-claude` boots the sandbox, SSHes in through Tenki's gateway, starts `claude` with your Anthropic credential, and deletes the sandbox when you quit. It's the interactive counterpart to [Claude Code](../claude-code-sandbox/), which runs one headless turn.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Claude Code over SSH" example from https://github.com/LuxorLabs/cookbook, which opens an interactive Claude Code session in a disposable Tenki sandbox.
1. Clone the repo, cd into examples/claude-code-ssh, check that Node.js is 20 or later and that ssh and ssh-keygen are installed, and run npm install.
2. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud, or one saved by tenki login) and ANTHROPIC_API_KEY in the environment. If either is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs (no real Anthropic key needed) and confirm the ✓ line.
4. Tell me to run node tenki-claude.mjs in my own terminal, since it's interactive. Don't start it for me.
5. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Node.js 20 or later and an OpenSSH client (`ssh` and `ssh-keygen`).
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An Anthropic API key, or a token from `claude setup-token`. You don't need Claude Code installed locally; Tenki's default image has it.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/claude-code-ssh
npm install
npm link   # optional: puts tenki-claude on your PATH
```

### 2. Set your keys

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works; a key saved by `tenki login` is used if neither is set
export ANTHROPIC_API_KEY=...     # or CLAUDE_CODE_OAUTH_TOKEN=... from `claude setup-token`
```

`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, and `ANTHROPIC_MODEL` are forwarded too if set. With no credential, `claude` starts logged out and you can `/login` inside it.

### 3. Run

```bash
node tenki-claude.mjs --repo https://github.com/sindresorhus/yocto-queue -- --dangerously-skip-permissions
```

```
Creating a sandbox...
Sandbox 01a18e7d-... is up.
```

Then Claude Code opens in `/home/tenki/repo`. Quit it with `/exit` or Ctrl-D, and the script prints `Terminated 01a18e7d-...`. Everything after `--` goes to `claude`; `--dangerously-skip-permissions` is a reasonable choice on a machine you throw away.

| Command | What it does |
| --- | --- |
| `tenki-claude [--repo URL] [-- claude args]` | Create a sandbox, run `claude`, terminate the sandbox when it exits. |
| `--keep` | Pause the sandbox instead of terminating it. Files stay; a paused sandbox costs no compute. |
| `--shell` | Open `bash` instead of `claude`. |
| `--hours N` | Lifetime cap for the sandbox, in hours (default 2; your workspace's maximum applies). |
| `tenki-claude attach <id>` | Resume a kept sandbox, reconnect, pause it again on exit. |
| `tenki-claude rm <id>` | Terminate a kept sandbox. |

The sandbox has 2 vCPUs and 4 GB of memory. Change `cpuCores` and `memoryMb` in `tenki-claude.mjs`. `--repo` clones a public repo to `/home/tenki/repo`; the tool passes no Git credentials.

### 4. Verify

```bash
node verify.mjs
```

```
✓ claude-code-ssh: create + clone → ssh as tenki in ~/repo → claude 2.1.267 reads the forwarded key (not on disk) → exit → sandbox terminated
```

`verify.mjs` runs `tenki-claude.mjs --shell` with a dummy Anthropic key and types commands into the remote shell over the real SSH path. It checks that you land as `tenki` in the cloned repo, that `claude` is on the PATH, and that the key is in the environment but not on disk. It runs `claude -p hi` and expects `Invalid API key`, which Anthropic returns only for a key it was sent, so that proves `claude` reads the forwarded one. Then it checks the sandbox is terminated. It takes one to four minutes, mostly waiting for the sandbox and the gateway. It doesn't run a real model turn.

## How it works

The script makes a throwaway ed25519 keypair in a temp directory and installs the public half when it creates the sandbox:

```js
sandbox = await tenki.createAndWait({
  tags: ["tenki-claude"],
  cloneRepoUrl: opts.repo,
  sshAuthorizedKeys: [publicKey],
  maxDurationMs: Number(opts.hours) * 3_600_000,
  pauseRetentionMs: 24 * 3_600_000,
});
const cert = await tenki.issueSandboxSSHCert(sandbox.id, publicKey);
```

Tenki carries SSH over a WebSocket, so a stock `ssh` connects through `ssh-proxy.mjs`, a `ProxyCommand` that bridges stdio to `tenki.ssh()`. The short-lived certificate is saved beside the key as `id-cert.pub`, which `ssh` loads on its own.

Your Anthropic credential never touches the sandbox's disk. It rides the SSH session as an `LC_*` variable, the only custom names the sandbox's sshd accepts, and the remote command exports it and unsets the `LC_` copy:

```js
const remote = [
  ...forwarded.map((name) => `export ${name === "ANTHROPIC_API_KEY" ? "TENKI_CLAUDE_API_KEY" : name}="$LC_${name}"; unset LC_${name}`),
  `[ -d "$HOME/repo" ] && cd "$HOME/repo"`,
  // ... first-run settings, below
  `exec claude ${claudeArgs.map(quote).join(" ")}`,
].join("; ");
```

Two first-run files make `claude` start without prompts. `~/.claude.json` skips the theme picker and the trust dialog. `~/.claude/settings.json` sets `apiKeyHelper` to `printf %s "$TENKI_CLAUDE_API_KEY"`. The key goes in under that name because Claude Code asks "use this API key?" whenever `ANTHROPIC_API_KEY` is in its environment, and the answer defaults to No. The helper file holds no key.

On exit the `finally` block deletes the key directory and terminates the sandbox (or pauses it with `--keep`). It also runs on SIGTERM and SIGHUP.

## Connect your local Claude Code instead

Claude Code's own Bash and file tools run on the machine where `claude` runs, so there's no setting that points a local `claude` at a sandbox. What works today:

- **Tenki MCP server.** Your local Claude Code gets tools such as `tenki_exec`, `tenki_write_file`, and `tenki_run_code` that act on a sandbox. The agent has to choose those tools over its local Bash and Edit. See [MCP server](../mcp-tenki-sandbox/).
- **SSH aliases.** `tenki sandbox ssh config install` writes `~/.ssh/config.d/tenki.conf` so `ssh sbx-<sandbox-name>` reaches a running sandbox, and any client that takes an SSH host can use it. I didn't test this with Claude Code's own remote features.
- **Codex.** `tenki agent --codex` (experimental, in the Tenki CLI 2.7.0) runs the local Codex TUI against an app server in a sandbox. There's no Claude Code equivalent.

## Things to know

- **The gateway can refuse a valid key for a while.** On a new sandbox, Tenki's SSH gateway answered `Permission denied (publickey)` for anywhere from zero to about 40 seconds, and on some sandboxes it kept refusing a fraction of connections after that. The refusal comes before any shell starts, so the script retries for up to 3 minutes and prints `Waiting for the sandbox's SSH gateway...`. The Tenki CLI's own `tenki sandbox ssh` fails the same way.
- **Host keys aren't pinned.** The connection is a TLS WebSocket authenticated with your API key, and each sandbox is new, so there's no stable host key to pin. The script sets `StrictHostKeyChecking=no`, like the profile `tenki sandbox ssh config install` writes.
- **Your Anthropic key is readable inside the sandbox.** `claude` and anything it runs can read it from the environment. Use a key with a spend limit.
- **A killed script leaves a sandbox behind.** After `kill -9` or a crash, the sandbox pauses at its lifetime cap and Tenki deletes it 24 hours later. List stragglers with `tenki sandbox list --tags tenki-claude`.
- **Files are kept; processes may not be.** `--keep` pauses the sandbox, and files survive. Start `claude` again after `attach`.
- **The sandbox's `~/.bashrc` runs `cd /home/tenki`.** `--shell` changes back into the repo after it, so `claude` and `--shell` both start in `/home/tenki/repo`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `No Tenki key. Set TENKI_AUTH_TOKEN ...` | Export a `tk_` key or run `tenki login --api-key <key>`. |
| `ssh not found` | Install the OpenSSH client. |
| `Waiting for the sandbox's SSH gateway...` repeats for minutes | See the first item under Things to know. After 3 minutes the script gives up and terminates the sandbox. Run it again. |
| `Permission denied (publickey).` and the script exits | The gateway refused for the whole 3 minutes. Run it again, or check [Tenki status](https://tenki.cloud). |
| `session ... created but not ready within wait budget` | The sandbox didn't come up in time. The script terminates it; run again. |
| `[unavailable] HTTP 503` | The Tenki API is unavailable. Wait and retry. |
| `claude` shows `Invalid API key` | Check `ANTHROPIC_API_KEY` in the shell you ran from. A key with `ANTHROPIC_BASE_URL` set must be valid for that endpoint. |
| `Not logged in · Run /login` | No credential was forwarded. Export `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`, or `/login` inside `claude`. |
| `Could not clean up <id>` | Run `tenki-claude rm <id>`. |

## Related

- [Claude Code](../claude-code-sandbox/): one headless turn that hands back a patch
- [MCP server](../mcp-tenki-sandbox/): sandbox tools for your local Claude Code
- [orca](../orca-tenki/): the same SSH transport behind a different client
- [Pause, snapshot, and resume](../snapshots-pause-resume/)
- [Tenki Sandbox](https://tenki.cloud/products/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
