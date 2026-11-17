# Luxor Agent Cloud cookbook

Runnable examples for [Luxor Sandbox](https://luxor.ai/products/sandbox). Each folder under `examples/` is a short program you can run against the live API and copy into your own project.

The first example takes about 10 minutes once you have an API key.

## Quick start

You need:

- A [Luxor Agent Cloud account](https://luxor.ai) and a `tk_` API key. Create keys at [app.luxor.ai](https://app.luxor.ai).
- Node.js 24 or later for the JavaScript demos. Several `run.mjs` scripts, including the first example, use top-level `await using`, which Node 22 cannot parse. The verify scripts also run on Node 20. CI runs them on Node 24.
- Python 3.12 and [uv](https://docs.astral.sh/uv/) for the Python examples. They run on Python 3.10 or later. CI uses 3.12. The Covalent example needs your local minor version to match the sandbox image (3.12 on the default image).
- Optional: the [Luxor CLI](https://luxor.ai/docs/sandbox/cli), if you want `luxor login` to store the key. Install it with `curl -fsSL https://luxor.ai/install.sh | bash` or `npm install -g @luxorai/cli`.

### 1. Clone

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook
```

Each example is self-contained: its own README, source, and dependencies. Nothing installs at the repository root. Install dependencies inside the example you run, with `npm install` or a virtual environment and that folder's `requirements.txt`.

### 2. Set your API key

```bash
export LUXORAI_API_KEY="tk_..."
```

The SDKs (`@luxorai/sandbox` and the `tenki` Python package, 1.5.2 or later) read `LUXORAI_AUTH_TOKEN` or `LUXORAI_API_KEY`, and still accept the old `TENKI_AUTH_TOKEN` and `TENKI_API_KEY`. The scripts here read them in that order. Examples that run through another project's plugin, such as AG2, Harbor or RAGFlow, still use `TENKI_API_KEY`, because those plugins read it themselves. Each example README names the variable it expects.

To store the key, run `luxor login --api-key <key>`. That writes `~/.config/luxor/config.yaml`, and every verify script reads it from there. Some demos, including `examples/run-code-in-a-sandbox/run.mjs`, read the environment only, so export the key before you run those.

Luxor Agent Cloud infers the workspace from the API key. If you set `LUXORAI_WORKSPACE_ID` (or the old `TENKI_WORKSPACE_ID`), most scripts pass it through. Most verify and agent scripts also read `current_workspace_id` from `~/.config/luxor/config.yaml`. DeerFlow's provider is the exception: when the account has more than one workspace, set `workspace_id` in the `sandbox:` block of its config ([DeerFlow example](examples/deerflow-luxor/)). Authentication and client setup are in the [Sandbox SDK guide](https://luxor.ai/docs/sandbox/sdk).

### 3. Run the first example

Start with [Run code in a sandbox](examples/run-code-in-a-sandbox/). It is the create, execute, and dispose lifecycle in about 15 lines of JavaScript.

```bash
cd examples/run-code-in-a-sandbox
npm install
node run.mjs
```

```
exit 0 -> 42
```

The script creates a sandbox, runs `python3 -c "print(6 * 7)"` inside it, prints the exit code and output, and terminates the sandbox when the script ends, because `await using` disposes it. The sandbox is billed per second.

The same loop in Python is [Run code with Python](examples/run-code-python/). From the repository root:

```bash
cd examples/run-code-python
uv venv --python 3.12
uv pip install -r requirements.txt
.venv/bin/python run.py
```

`run.py` prints `exit 0 -> 42`. It also accepts a key saved by `luxor login`.

## Examples

Open the example closest to what you are building and follow its README. Agent-framework examples need a model provider key, such as `OPENAI_API_KEY`, to run the agent. Their verify scripts call the sandbox tool directly and do not need that key.

### Sandbox API

| Example | What it covers |
| --- | --- |
| [Run code in a sandbox](examples/run-code-in-a-sandbox/) | Create a sandbox, run a command, dispose it |
| [Work with files](examples/files-in-a-sandbox/) | Read, write, and list files with the TypeScript SDK |
| [Expose a port](examples/expose-a-port/) | Serve a web app on a public preview URL |
| [Pause, snapshot, and resume](examples/snapshots-pause-resume/) | Preserve a sandbox and pick up where it left off |
| [Run code with Python](examples/run-code-python/) | The official `tenki` Python SDK |
| [Run a full-stack app](examples/agent-fullstack-app/) | Serve an API, frontend, and seeded database from one sandbox |

### Agent frameworks

Give an agent a sandbox to run the code it writes.

| Example | What it covers |
| --- | --- |
| [Claude Agent SDK](examples/claude-agent-sdk/) | Luxor Agent Cloud as the backend for the SDK's bash and file tools |
| [Vercel AI SDK](examples/vercel-ai-sdk/) | Luxor Agent Cloud as the AI SDK's `experimental_sandbox` |
| [LangChain (JavaScript)](examples/langchain-code-interpreter/) | Sandboxed code interpreter tool |
| [LangChain (Python)](examples/langchain-python/) | Code-execution tool for a Python agent |
| [CrewAI](examples/crewai-code-interpreter/) | Run agent-generated code in a sandbox |
| [OpenAI Agents SDK](examples/openai-agents-sdk/) | Sandboxed execution as an agent tool |
| [LlamaIndex](examples/llamaindex/) | Sandboxed execution as a `FunctionTool` |
| [Hugging Face smolagents](examples/smolagents/) | Remote Python executor for a `CodeAgent` |
| [Pi Durable](examples/pi-durable-luxor/) | Remote execution env. Every tool call runs in a sandbox |
| [AG2](examples/ag2-luxor/) | Native sandbox backend for shell and code tools |
| [PraisonAI](examples/praisonai-luxor/) | One shared sandbox for a whole agent team |

### Developer tools

| Example | What it covers |
| --- | --- |
| [MCP server](examples/mcp-luxor-sandbox/) | Sandbox tools for Claude, Cursor, or any MCP client |
| [MCP Apps](examples/copilotkit-mcp-apps/) | Tools that bring their own UI, rendered in a CopilotKit chat |
| [Claude Code](examples/claude-code-sandbox/) | Headless coding agent on a real repo checkout |
| [Codex](examples/codex-sandbox/) | OpenAI's coding agent, headless, on a real repo checkout |
| [OpenCode](examples/opencode-sandbox/) | Headless OpenCode server on a public preview URL |
| [Composio](examples/composio-luxor/) | Luxor Agent Cloud tools in a Composio agent |
| [Covalent](examples/covalent-luxor/) | Each workflow task in its own sandbox |
| [AgentBox](examples/agentbox-luxor/) | Coding-agent boxes on Luxor sandboxes |
| [ComputeSDK](examples/computesdk-luxor/) | Luxor Agent Cloud as a provider for the unified sandbox interface |
| [TinyFish](examples/tinyfish-luxor/) | Web agents, fetch, search, and remote browsers from the tenki/tinyfish image |
| [Harbor](examples/harbor-luxor/) | Agent evals and benchmarks (Terminal-Bench), one sandbox per trial |
| [Convex](examples/convex-luxor/) | A sandbox per user from Convex actions, with live state in a Convex table |

### Luxor Code Reviewer

Review pull requests with [Luxor Code Reviewer](https://luxor.ai/products/code-reviewer).

| Example | What it covers |
| --- | --- |
| [Cursor Origin](examples/cursor-origin-luxor/) | Luxor Code Reviewer on Origin pull requests, with `AGENTS.md` review rules |

### Agent platforms

Run a self-hosted agent platform's sandboxes on Luxor Agent Cloud.

| Example | What it covers |
| --- | --- |
| [DeerFlow](examples/deerflow-luxor/) | Community sandbox provider for ByteDance's SuperAgent harness |
| [RAGFlow](examples/ragflow-luxor/) | Ephemeral sandboxes for the RAG engine's code components |
| [Open WebUI](examples/open-webui-luxor/) | Sandboxed code interpreter for the self-hosted chat platform |
| [AgentEnv](examples/agentenv-luxor/) | Built-in sandbox backend for Scale AI's RL environment framework |
| [OpenHermit](examples/openhermit-luxor/) | Sticky per-agent sandboxes for an agent fleet |
| [Omnara](examples/omnara-luxor/) | Machine pool provider for the open-source managed agent platform |

### Migrating from another provider

Each guide shows the two APIs side by side.

| From | Guide |
| --- | --- |
| E2B | [E2B to Luxor Agent Cloud](examples/e2b-to-luxor-migration/) |
| Modal | [Modal to Luxor Agent Cloud](examples/modal-to-luxor-migration/) |
| Daytona | [Daytona to Luxor Agent Cloud](examples/daytona-to-luxor-migration/) |

## Check an example

Every example includes `verify.mjs`. It calls the live API and exits non-zero when a check fails.

```bash
cd examples/run-code-in-a-sandbox
npm install
node verify.mjs
```

```
✓ run-code-in-a-sandbox: create → exec python3 → 42 → dispose
```

That line means your key works: a sandbox boots, runs a command, and returns `42`. Verify scripts still exit 0 if the final dispose fails, so the check mark is about the command result. In an agent example, the script checks the sandbox tool or backend and does not run a model turn.

In a Python example, `verify.mjs` is a shim. It runs `verify.py` with the example's `.venv/bin/python` when that interpreter exists, and otherwise with `$PYTHON` or `python3`. You can also run `.venv/bin/python verify.py` yourself.

To check every example, from the repository root:

```bash
node verify.mjs
```

It runs each example's `verify.mjs` and ends with `✓ all examples passed`, or with `✗ N example(s) failed` and a non-zero exit. It does not install dependencies. Install them first, as CI does in [`.github/workflows/verify.yml`](.github/workflows/verify.yml).

CI runs the same checks on every push and pull request, and a failed check blocks the merge. Three examples are skipped in CI:

- `composio-luxor`, which needs a Composio API key
- `covalent-luxor`, until [`covalent-tenki-plugin` 0.1.1](https://github.com/LuxorLabs/tenki-covalent-plugin/pull/1) is on PyPI
- `orca-luxor`, until gateway SSH host keys are stable across connections

`node verify.mjs` on your machine runs those three as well. If they fail locally, see Troubleshooting.

## Official integrations

Packages you install in your own project:

| Integration | Install | What it does |
| --- | --- | --- |
| [Composio tools](https://github.com/LuxorLabs/tenki-composio-tools) | `npm install @tenkicloud/composio-tools` | Create, execute, snapshot, and terminate tools for Composio agents |
| [Covalent executor](https://github.com/LuxorLabs/tenki-covalent-plugin) | `pip install covalent-tenki-plugin` | Runs Covalent workflow tasks in Tenki sandboxes |
| [GitHub Actions](https://github.com/LuxorLabs/tenki-actions) | `uses: LuxorLabs/tenki-actions/setup-cli@v1` | Installs the Tenki CLI and builds sandbox templates in CI |
| [Go SDK](https://github.com/LuxorLabs/tenki-sdk-go) | `go get github.com/LuxorLabs/tenki-sdk-go/sandbox` | Go client for the Tenki Sandbox API |
| [Convex component](https://github.com/LuxorLabs/tenki-convex) | `npm install @tenkicloud/convex` | Creates and drives sandboxes from Convex actions, with each one's state in a Convex table |

`covalent-tenki-plugin` 0.1.0 is the only release on PyPI. It depends on the renamed `tenki-sandbox` package, so `pip install` fails until 0.1.1 is published.

## Projects with built-in Luxor Agent Cloud support

These projects ship a Luxor Agent Cloud provider or backend:

| Project | Luxor Agent Cloud integration |
| --- | --- |
| [RAGFlow](https://github.com/infiniflow/ragflow) | Sandbox provider for the RAG engine's code executor — [example](examples/ragflow-luxor/) |
| [DeerFlow](https://github.com/bytedance/deer-flow) | Sandbox provider for ByteDance's SuperAgent harness — [example](examples/deerflow-luxor/) |
| [AgentBox](https://github.com/madarco/agentbox) | Provider for running parallel agents in sandboxes — [example](examples/agentbox-luxor/) |
| [ComputeSDK](https://github.com/computesdk/computesdk) | Luxor Agent Cloud provider for the multi-provider compute toolkit — [example](examples/computesdk-luxor/) |
| [AgentEnv Framework](https://github.com/scaleapi/agentenv-framework) | Sandbox backend for Scale AI's RL environments — [example](examples/agentenv-luxor/) |
| [OpenHermit](https://github.com/HCF-STUDIOS/openhermit) | Sandboxed exec backend for AI agent fleets — [example](examples/openhermit-luxor/) |
| [Omnara](https://github.com/omnara-ai/omnara) | Machine pool provider for the open-source managed agent platform — [example](examples/omnara-luxor/) |

## Troubleshooting

- **`missing auth token - set LUXORAI_AUTH_TOKEN or LUXORAI_API_KEY (or TENKI_AUTH_TOKEN or TENKI_API_KEY) or use authToken option`.** The SDK found no key. `run.mjs` reads the environment only. Export `LUXORAI_API_KEY` in the shell you run it from.
- **`invalid auth token - API keys and service tokens must start with tk_`.** The SDK accepts `tk_` API keys. Create one at [app.luxor.ai](https://app.luxor.ai).
- **`No token. Set LUXORAI_AUTH_TOKEN, or run luxor login`.** A JavaScript `verify.mjs` found no key in `LUXORAI_AUTH_TOKEN`, `LUXORAI_API_KEY`, the old `TENKI_*` names, or `~/.config/luxor/config.yaml`. `composio-luxor` and `vercel-ai-sdk` print `No Luxor Agent Cloud token. …`. `mcp-luxor-sandbox` prints `No token. Set LUXORAI_API_KEY, …`. Export `LUXORAI_API_KEY`, or run `luxor login --api-key <key>`.
- **`No API key. Set LUXORAI_API_KEY, or run luxor login --api-key <key>`.** A Python `verify.py` found no key in those same places. Export `LUXORAI_API_KEY`, or run `luxor login --api-key <key>`. Plugin examples that print `Set TENKI_API_KEY` want the old name.
- **`node run.mjs` fails with a `SyntaxError` at `await using`.** Top-level `await using` needs Node 24. Node 22 cannot parse it. `node verify.mjs` still runs on Node 20.
- **`node verify.mjs` at the repository root prints `FAILED: <example>` for an example you have not set up.** The root script expects that example's dependencies to be installed already. Install them in the example folder, or run that folder's own `node verify.mjs`.
- **`FAILED: composio-luxor` or `FAILED: covalent-luxor` from `node verify.mjs` at the repository root.** CI skips both. `composio-luxor` also needs a `COMPOSIO_API_KEY` from [app.composio.dev](https://app.composio.dev). `covalent-luxor` needs `covalent-tenki-plugin` 0.1.1 or later, because 0.1.0 depends on the renamed `tenki-sandbox` package and no longer installs. Until 0.1.1 is published, run `node verify.mjs` inside the examples you use.
- **`ModuleNotFoundError: No module named '<package>'` from a Python example's `verify.mjs`.** The shim runs `.venv/bin/python` when that file exists, and otherwise `$PYTHON` or `python3`. Create the venv in the example folder with `uv venv --python 3.12` and `uv pip install -r requirements.txt`. You can also set `PYTHON` to an interpreter that already has the packages.

## FAQ

**Can I depend on this repository from an app?** Each example is a short program to read and copy. To use Luxor Agent Cloud in a project you ship, install the SDK or one of the [official integrations](#official-integrations) above. A passing verify script checks the Luxor Agent Cloud calls in that example. In the agent examples it does not run a model turn.

**Which example should I copy?** For the SDK, [`run-code-in-a-sandbox`](examples/run-code-in-a-sandbox/). For a framework agent with a code-execution tool, [`langchain-code-interpreter`](examples/langchain-code-interpreter/). For a pluggable sandbox backend, [`vercel-ai-sdk`](examples/vercel-ai-sdk/).

**Do the examples clean up their sandboxes?** Sandboxes are billed per second. `run.mjs` disposes its sandbox with `await using`, and `run.py` uses a `with` block. Every verify script is required to clean up any sandbox it creates.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers local setup, the example checklist, and the verification contract. A new example ships a `verify.mjs` that CI runs against the live API, and adds a row to one of the tables above.

## Resources

- [Luxor Agent Cloud documentation](https://luxor.ai/docs)
- [Sandbox SDK reference](https://luxor.ai/docs/sandbox/sdk)
- [Luxor CLI reference](https://luxor.ai/docs/sandbox/cli)
- [Luxor Agent Cloud MCP server](https://github.com/LuxorLabs/tenki-mcp)
- [Luxor Agent Cloud nodes for n8n](https://github.com/opencolin/n8n-nodes-tenki)

## License

[MIT](LICENSE)
