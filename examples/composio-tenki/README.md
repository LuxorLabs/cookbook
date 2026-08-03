# Composio agent on Tenki

Give any [Composio](https://composio.dev) agent disposable Tenki microVMs. The official [`@tenkicloud/composio-tools`](https://github.com/TenkiCloud/composio-tools) package registers a **Tenki custom toolkit** — the agent gets `CREATE_SANDBOX`, `EXEC_COMMAND`, `LIST_SANDBOXES`, `GET_SANDBOX`, `CREATE_SNAPSHOT`, and `TERMINATE_SANDBOX`, all running in-process against the Tenki SDK. No extra backend.

## The integration (the whole thing)

```js
import { Composio } from "@composio/core";
import { tenkiToolkit } from "@tenkicloud/composio-tools";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
const session = await composio.sessions.create("default", {
  experimental: { customToolkits: [tenkiToolkit()] },
});
// the agent can now call LOCAL_TENKI_CREATE_SANDBOX, LOCAL_TENKI_EXEC_COMMAND, …
```

`tenkiToolkit()` reads `TENKI_API_KEY` from the environment (or takes `authToken`/`workspaceId` options). Custom toolkits are **session-scoped**: tool calls run through `session.execute(slug, args)`, and definitions come from `session.customTools()`.

## Two files

- **`verify.mjs`** — the CI proof, no LLM. Binds the toolkit to a real Composio session and drives the tools directly: create a sandbox → run `python3 -c 'print(6*7)'` → assert `42` → terminate. This is what CI runs.
- **`agent.mjs`** — the full experience. Claude is handed the Tenki toolkit and asked to boot a sandbox, inspect it, and clean up — choosing the tool calls itself.

## Run it

```bash
npm install
export COMPOSIO_API_KEY=...        # https://app.composio.dev
export TENKI_AUTH_TOKEN=...        # or `tenki login`

node verify.mjs                    # no LLM — proves the sandbox path
export ANTHROPIC_API_KEY=...       # then the full agent:
node agent.mjs
```

## Keys

| Key | For | Where |
|---|---|---|
| `COMPOSIO_API_KEY` | Composio session | https://app.composio.dev |
| `TENKI_AUTH_TOKEN` (or `tenki login`) | the sandboxes | https://app.tenki.cloud |
| `ANTHROPIC_API_KEY` | `agent.mjs` only | https://console.anthropic.com |

> **CI note:** unlike the other examples, `verify.mjs` needs `COMPOSIO_API_KEY` **in addition to** the Tenki token. Wire it as a CI secret before this example goes green.
