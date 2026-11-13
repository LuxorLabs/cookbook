# marimo notebooks on Tenki

Edit a reactive [marimo](https://marimo.io) notebook in your browser while its Python runs in a [Tenki](https://tenki.cloud) sandbox. `run.py` installs marimo in the sandbox, uploads `notebook.py`, starts `marimo edit` with an access token, and prints a public preview URL. When you press Enter, it copies the edited notebook back to your machine and terminates the sandbox.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "marimo notebooks" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo and cd into examples/marimo-tenki.
2. Create a virtualenv on Python 3.10 or later (uv venv --python 3.12 if uv is installed) and install requirements.txt into it.
3. The scripts need a Tenki API key (starts with tk_) in TENKI_API_KEY. If it isn't set, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it to a file.
4. Run node verify.mjs and confirm it prints a line starting with "✓ marimo-tenki".
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then tell me to run .venv/bin/python run.py myself, since it prints a private access link and waits for Enter.
```

## Quick start

You need:

- Python 3.10 or later. [uv](https://docs.astral.sh/uv/) is optional. `verify.mjs` also needs Node.js 20 or later.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/marimo-tenki
uv venv --python 3.12
uv pip install -r requirements.txt   # tenki>=1.4.1, websockets
```

marimo itself is installed inside the sandbox, not on your machine.

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...
```

The scripts check `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then the key that `tenki login --api-key <key>` saves in `~/.config/tenki/config.yaml`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run

```bash
.venv/bin/python run.py
```

```text
open: https://…/?access_token=…
Press Enter to copy notebook.py back and stop the sandbox...
```

Open the link and move the slider: the cell below it re-runs. Edit or add cells; marimo saves them to `notebook.py` in the sandbox, and Enter copies that file over your local `notebook.py`.

### 4. Verify

```bash
node verify.mjs      # or: .venv/bin/python verify.py
```

```text
  preview URL: https://…
✓ marimo-tenki: marimo edit → exposePort → no token: login page → token: editor → WebSocket kernel-ready
```

`verify.py` calls `serve_marimo()` from `run.py` with a random token, then checks over the preview URL that a request without the token lands on marimo's login page, that the token opens the editor, and that the notebook kernel answers on marimo's WebSocket. The sandbox is terminated either way. `verify.mjs` is a CI shim that runs `verify.py` with `.venv/bin/python` if it exists.

## How it works

`serve_marimo()` in `run.py` does the Tenki part:

```python
sb.shell(f"pip install -q {MARIMO}", check=True)
sb.fs.upload(NOTEBOOK, "notebook.py")
sb.shell(
    f'setsid marimo edit notebook.py --headless --host 0.0.0.0 --port {PORT} '
    f'--token-password "$MARIMO_TOKEN" >/tmp/marimo.log 2>&1 </dev/null &',
    env={"MARIMO_TOKEN": token},
    check=True,
)
return sb.expose_port(PORT).url.rstrip("/")
```

- **The preview URL is public.** Anyone with the URL reaches the server, so marimo's [token auth](https://docs.marimo.io/guides/deploying/authentication/) is what keeps them out. `run.py` generates a fresh token per run with `secrets.token_urlsafe`. Without it, visitors get marimo's login page. Opening `?access_token=…` once sets a session cookie.
- **`edit`, not `run`.** `marimo edit` serves the full editor, so anyone with the token can run arbitrary code, but only inside the sandbox. Swap in `marimo run notebook.py` to serve the notebook as a read-only app.
- **WebSockets work through the preview URL.** marimo's frontend talks to the kernel over `/ws`, and the gateway passes the upgrade through.
- **Background the server.** `exec()` and `shell()` wait for the command to exit, so marimo starts under `setsid … &` with its output in `/tmp/marimo.log`.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` | Export `TENKI_API_KEY` or run `tenki login --api-key <key>`. |
| `ModuleNotFoundError: No module named 'tenki'` or `'websockets'` | Run with `.venv/bin/python`, or activate `.venv`. |
| The link shows marimo's login page | The token in the URL doesn't match this run. Use the link `run.py` printed, or paste the token into the login form. |
| The link doesn't load at first | marimo and the preview route can take a few seconds after the URL prints. Reload. |
| `marimo never answered:` from `verify.py` | The message ends with the tail of `/tmp/marimo.log` from the sandbox. |

## Notes

- Everything in the sandbox, including notebook edits you didn't copy back, is gone when the sandbox ends. If `run.py` is killed before you press Enter, the sandbox stops after `max_duration` (2 hours) and the edits are lost.
- `run.py` pins `marimo==0.25.2`. Change `MARIMO` to upgrade.
- [`tenki` on PyPI](https://pypi.org/project/tenki/) · [Tenki docs: port exposure](https://tenki.cloud/docs/sandbox/sessions#port-exposure-and-networking) · [Expose a port](../expose-a-port/) (the same pattern in Node)
