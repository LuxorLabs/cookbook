# code-server

Run [code-server](https://github.com/coder/code-server) (VS Code in the browser) on a Tenki dev box that stays up until you stop it. The box is a sticky sandbox, your workspace lives on a Tenki volume, and the box is served on a named preview URL. Stop the sandbox and start it again, and you get the same URL, the same password, and the same files, with VS Code settings and extensions kept. The URL is public, so code-server's own password login is always on.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "code-server" example from https://github.com/LuxorLabs/cookbook, which runs VS Code in the browser on a persistent Tenki sandbox with a password-protected URL.
1. Clone the repo, cd into examples/code-server-tenki, and run npm install (Node.js 20 or later).
2. It needs TENKI_AUTH_TOKEN (a Tenki key starting with tk_, from https://app.tenki.cloud) in the environment. If it is missing, stop and ask me to export it. Never print the key or write it to a file.
3. Run node verify.mjs and confirm the ✓ line.
4. Run node run.mjs (add a git URL as the argument if I named a repo), then give me the URL and the password it prints.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Remind me the sandbox keeps running (and billing) until I run node run.mjs stop, and that node run.mjs delete also removes the workspace volume and the URL.
```

## Quick start

You need:

- Node.js 20 or later.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud). You don't install code-server locally.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/code-server-tenki
npm install
```

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run

```bash
node run.mjs https://github.com/sindresorhus/yocto-queue   # the repo is optional
```

```
code-server-<you> is live at https://code-server-<you>--<workspace>.us.sb.tenki.sh
password: <48 hex characters>
Stop the sandbox (keeps workspace + URL): BOX=code-server-<you> node run.mjs stop
Delete everything:                     BOX=code-server-<you> node run.mjs delete
```

Open the URL and sign in with the password. VS Code opens `/home/tenki/workspace`, with the repo cloned into it. The script exits, but the box keeps running until you stop it.

| Command | What it does |
| --- | --- |
| `node run.mjs [git-url]` | Start the box, or reattach to the running one and print the URL and password again. Clones the repo into the workspace if it isn't there. |
| `node run.mjs stop` | Terminate the sandbox. The workspace volume, the URL, and the password stay. |
| `node run.mjs delete` | Terminate the sandbox and delete the volume and the URL. |

`BOX` names the box (default `code-server-<your username>`). It is the volume's name, the URL's slug, and the sandbox's tag, so `BOX=api node run.mjs` gives you a second, separate box at its own URL.

### 4. Verify

```bash
node verify.mjs
```

```
✓ code-server-tenki: sticky box + volume + https://cs-verify-<id>--<workspace>.us.sb.tenki.sh → login page, wrong password refused, workbench 200, websocket 101 (401 without the cookie) → stop → rebuild keeps URL, password, repo → delete
```

`verify.mjs` drives `run.mjs` itself under a random `BOX` name. Over the public URL it checks code-server's login page, that a wrong password is refused, that the printed password logs in and loads the VS Code workbench, and that a websocket upgrades with the session cookie but not without it. Then it runs `stop` and starts the box again, and checks that the URL and password are unchanged and the cloned repo is still in the workspace. Finally it runs `delete` and fails if any sandbox, URL, or volume with that name is left. It takes about a minute and a half.

## How it works

Three Tenki resources share the `BOX` name, and only the sandbox is disposable:

- **A volume** (`createVolume`, 10 GiB) mounted at `/home/tenki/workspace`. It holds your files and `.code-server/`: the code-server install, the password, VS Code's user data, and extensions.
- **A named preview URL** (`tenki.previewUrls.create(slug)`). The script binds it to port 8080 of whichever sandbox is current. Binding it to a new sandbox is how the address survives a rebuild.
- **A sticky sandbox** (`createAndWait({ sticky: true, volumes: [...] })`). `sticky` means no lifetime cap: it runs until `node run.mjs stop`.

The setup step that `run.mjs` runs in the sandbox is idempotent. It downloads code-server 4.143.1 onto the volume only if it isn't there, writes a password only if there isn't one, and starts the server only if `localhost:8080/healthz` doesn't answer. So a rebuild skips the download, and running `node run.mjs` against a live box just prints the URL and password.

code-server starts with `--bind-addr 0.0.0.0:8080 --auth password`, and the password comes from the volume through the `PASSWORD` environment variable. `0.0.0.0` is required; the gateway can't reach `127.0.0.1`.

VS Code in the browser keeps a websocket open to the server. Tenki preview URLs carry websockets, and `verify.mjs` checks the upgrade through the public URL.

## Keep the URL locked

Preview URLs are public: Tenki doesn't put a login in front of them. code-server is a full terminal on the box, so never start it with `--auth none` here. With `--auth password`, an unauthenticated request redirects to `/login`, and a websocket without the session cookie gets `401`. `verify.mjs` checks both.

The password is 48 hex characters from `crypto.randomBytes`, saved once at `/home/tenki/workspace/.code-server/password`. To rotate it, delete that file in the VS Code terminal, then run `node run.mjs stop` and `node run.mjs`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `setup failed (exit <n>) ...` | The download or the clone failed; the error follows. The box is still running: fix it and run again, or `node run.mjs stop`. |
| `code-server never answered; see /tmp/code-server.log in the sandbox ...` | If you changed the start command, keep `--bind-addr 0.0.0.0:8080`. |
| The URL returns `404` | No sandbox is bound to it. Run `node run.mjs`. |
| The URL from `previewUrls.create()` never answers | An unbound URL comes back without its region (`...sb.tenki.sh`, not `...us.sb.tenki.sh`). Use the `previewUrl` that `bind()` returns, as `run.mjs` does. |
| `run.mjs stop` was skipped and the URL is gone | Terminating a sandbox deletes a named URL still bound to it. `stop` unbinds first. If you terminate the box another way, the next `node run.mjs` creates the URL again under the same name. |
| `timeout waiting for volume <id> to become ready`, or `volume is attached to a session` on `delete` | The old sandbox hasn't released the volume yet. It usually takes a few seconds after `stop`. Run the command again. |
| The slug is taken | Slugs are unique per workspace. Pick another `BOX`. |

## Notes

- Only `/home/tenki/workspace` survives a rebuild. Packages you install with `apt`, and files elsewhere in the home directory, such as `~/.gitconfig`, are gone after `stop`.
- Stopping terminates the sandbox, so running processes end. This example doesn't use `pause()`.
- The box has 2 vCPUs and 4 GB of memory. Change `cpuCores` and `memoryMb` in `run.mjs`.
- `run.mjs` installs the `linux-amd64` build. To upgrade, change `VERSION`; the next start downloads the new build next to the old one.
- The password is stored in plain text on the volume, inside the workspace VS Code opens. Anyone with access to the workspace's volumes or the box can read it.
- code-server is not Microsoft's VS Code build. Its extensions come from [Open VSX](https://open-vsx.org).

## Related

- [OpenCode](../opencode-sandbox/): OpenCode's web UI on a password-protected preview URL
- [Expose a port](../expose-a-port/): preview URLs on their own
- [Snapshots, pause and resume](../snapshots-pause-resume/): keep a sandbox's state without keeping it running
- [code-server](https://github.com/coder/code-server) and its [docs](https://coder.com/docs/code-server)
- [Tenki Sandbox](https://tenki.cloud/products/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
