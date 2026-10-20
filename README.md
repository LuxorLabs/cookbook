# How to use the Tenki cookbook

**Audience:** JavaScript and Python developers who want tested, working code for [Tenki Sandbox](https://tenki.cloud/products/sandbox): disposable Linux VMs for running code and AI agents in isolation.
**Time:** ~10 minutes once you have an API key. That covers cloning, installing one JavaScript example (and optionally one Python example), a run, and a check.
**Outcome:** you've run code in a Tenki sandbox from this repo, confirmed an example works against the live API, and know which example to open next.

> **Honesty note:** every example ships a verify script, but CI doesn't run all of them. It skips `composio-tenki`, which needs a Composio API key, and `covalent-tenki`, until `covalent-tenki-plugin` 0.1.1 is on PyPI.

## Prerequisites

- A [Tenki account](https://tenki.cloud) and a `tk_` API key. Create keys at https://app.tenki.cloud.
- Node.js 24 or later. Several `run.mjs` demos, including `run-code-in-a-sandbox`, use top-level `await using`, which Node 22 can't parse. The verify scripts run on Node 20, which is what CI uses.
- Python 3.12 and `uv` for the Python examples. They need Python 3.10 or later; CI runs 3.12, and the Covalent example needs your local minor version to match the sandbox's (3.12 on the default image).
- Optional: the [Tenki CLI](https://tenki.cloud/docs/sandbox/cli), if you'd rather store your key with `tenki login` than export it in each shell.

## Step 1 — Clone the cookbook

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook
```

Each example is self-contained in its own folder under `examples/`, with its own README, source code, dependencies, and `verify.mjs`. There's nothing to install at the root. You install dependencies inside the example you run: `npm install` for a JavaScript example, or a virtual environment with the example's `requirements.txt` for a Python one.

## Step 2 — Authenticate

Export your key:

```bash
export TENKI_AUTH_TOKEN="tk_..."
```

The SDK also reads the key from `TENKI_API_KEY`, which is the name CI and the Python examples use. Each example's README shows the variable it expects.

To store the key instead, run `tenki login --api-key <key>`. It writes the key to `~/.config/tenki/config.yaml`, and every verify script reads it from there. Some demo scripts, including `run-code-in-a-sandbox/run.mjs`, read the key only from the environment, so export it before you run those.

You don't need a workspace ID to run these examples. Tenki infers the workspace from the API key. If you set `TENKI_WORKSPACE_ID`, most scripts pass it along; most verify and agent scripts also read `current_workspace_id` from `~/.config/tenki/config.yaml`. DeerFlow's own provider is an exception: if your account has more than one workspace, it needs `workspace_id` in the `sandbox:` block of its config (see [its README](examples/deerflow-tenki/)). Authentication and client setup are covered in the [Sandbox SDK guide](https://tenki.cloud/docs/sandbox/sdk).

## Step 3 — Run your first example

Start with [Run code in a sandbox](examples/run-code-in-a-sandbox/). It covers the whole create, execute, dispose lifecycle in about 15 lines of JavaScript.

```bash
cd examples/run-code-in-a-sandbox
npm install
node run.mjs
```

```
exit 0 -> 42
```

The script creates a sandbox, runs `python3 -c "print(6 * 7)"` inside it, prints the exit code and output, and terminates the sandbox when the script ends, because `await using` disposes it. The sandbox boots in about 2 seconds and is billed per second.

For Python, [Run code with Python](examples/run-code-python/) does the same with the `tenki` SDK:

```bash
cd ../..    # back to the repository root
cd examples/run-code-python
uv venv --python 3.12
uv pip install -r requirements.txt
.venv/bin/python run.py
```

`run.py` prints the same `exit 0 -> 42`. Unlike `run.mjs`, it falls back to `~/.config/tenki/config.yaml` for the key.

## Step 4 — Pick an example

Open the example closest to what you're building and follow its README, which covers setup, the code, and how to check it. The agent framework examples need a model provider key, such as `OPENAI_API_KEY`, to run the agent. Their verify scripts don't.

### Sandbox API basics

| Example | What it covers |
| --- | --- |
| [Run code in a sandbox](examples/run-code-in-a-sandbox/) | Create a sandbox, run a command, dispose it |
| [Work with files](examples/files-in-a-sandbox/) | Read, write, and list files with the TypeScript SDK |
| [Expose a port](examples/expose-a-port/) | Serve a web app on a public preview URL |
| [Pause, snapshot, and resume](examples/snapshots-pause-resume/) | Preserve a sandbox and pick up where it left off |
| [Run code with Python](examples/run-code-python/) | The official `tenki` Python SDK |

### Agent frameworks

Give an agent a sandboxed place to run the code it writes.

| Example | Framework |
| --- | --- |
| [Claude Agent SDK](examples/claude-agent-sdk/) | Tenki as the backend for the SDK's bash and file tools |
| [Vercel AI SDK](examples/vercel-ai-sdk/) | Tenki as the AI SDK's `experimental_sandbox` |
| [LangChain (JavaScript)](examples/langchain-code-interpreter/) | Sandboxed code interpreter tool |
| [LangChain (Python)](examples/langchain-python/) | Code-execution tool for a Python agent |
| [CrewAI](examples/crewai-code-interpreter/) | Run agent-generated code in a sandbox |
| [OpenAI Agents SDK](examples/openai-agents-sdk/) | Sandboxed execution as an agent tool |
| [LlamaIndex](examples/llamaindex/) | Sandboxed execution as a `FunctionTool` |
| [Hugging Face smolagents](examples/smolagents/) | Remote Python executor for a `CodeAgent` |
| [Pi Durable](examples/pi-durable-tenki/) | Remote execution env — every tool call in a disposable VM |
| [AG2](examples/ag2-tenki/) | Native sandbox backend for shell + code tools |
| [PraisonAI](examples/praisonai-tenki/) | One shared sandbox for a whole agent team |

### Developer tools

| Example | Integration |
| --- | --- |
| [MCP server](examples/mcp-tenki-sandbox/) | Sandbox tools for Claude, Cursor, or any MCP client |
| [MCP Apps](examples/copilotkit-mcp-apps/) | Tools that bring their own UI, rendered in a CopilotKit chat |
| [Claude Code](examples/claude-code-sandbox/) | Headless coding agent on a real repo checkout |
| [Codex](examples/codex-sandbox/) | OpenAI's coding agent, headless, on a real repo checkout |
| [OpenCode](examples/opencode-sandbox/) | Headless OpenCode server on a public preview URL |
| [Composio](examples/composio-tenki/) | Tenki tools in a Composio agent |
| [Covalent](examples/covalent-tenki/) | Each workflow task in its own sandbox |
| [AgentBox](examples/agentbox-tenki/) | Coding-agent boxes as Tenki VMs |
| [ComputeSDK](examples/computesdk-tenki/) | Tenki as a provider for the unified sandbox interface |
| [TinyFish](examples/tinyfish-tenki/) | Web agents, fetch, search, and remote browsers from the tenki/tinyfish image |
| [Harbor](examples/harbor-tenki/) | Agent evals and benchmarks (Terminal-Bench), each trial in its own VM |
| [Convex](examples/convex-tenki/) | A sandbox per user from Convex actions, with live state in a Convex table |

### Tenki Code Reviewer

Review pull requests with [Tenki Code Reviewer](https://tenki.cloud/products/code-reviewer).

| Example | What it covers |
| --- | --- |
| [Cursor Origin](examples/cursor-origin-tenki/) | Tenki Code Reviewer on Origin pull requests, with `AGENTS.md` review rules |

### Agent platforms

Run a self-hosted agent platform's sandboxes on Tenki.

| Example | Platform |
| --- | --- |
| [DeerFlow](examples/deerflow-tenki/) | Community sandbox provider for ByteDance's SuperAgent harness |
| [RAGFlow](examples/ragflow-tenki/) | Ephemeral sandboxes for the RAG engine's code components |
| [Open WebUI](examples/open-webui-tenki/) | Sandboxed code interpreter for the self-hosted chat platform |
| [AgentEnv](examples/agentenv-tenki/) | Built-in sandbox backend for Scale AI's RL environment framework |
| [OpenHermit](examples/openhermit-tenki/) | Sticky per-agent sandboxes for an agent fleet |
| [Omnara](examples/omnara-tenki/) | Machine pool provider for the open-source managed agent platform |

### Migrating from another provider

Each guide has side-by-side code and an API mapping.

| Guide |
| --- |
| [E2B to Tenki](examples/e2b-to-tenki-migration/) |
| [Modal to Tenki](examples/modal-to-tenki-migration/) |
| [Daytona to Tenki](examples/daytona-to-tenki-migration/) |

## Step 5 — Check any example works

Every example ships a `verify.mjs` script that exercises it against the live API and exits non-zero on any failure, so you can check that it still works before you build on it. CI runs them on every push and pull request, apart from the two skips in the honesty note, and a red build blocks the merge.

If you're still in `examples/run-code-in-a-sandbox` from Step 3, `node verify.mjs` is all you need. Otherwise:

```bash
cd ../..    # back to the repository root
cd examples/run-code-in-a-sandbox
npm install
node verify.mjs
```

```
✓ run-code-in-a-sandbox: create → exec python3 → 42 → dispose
```

That proves your key works and the example's Tenki-facing code runs against the live API: a sandbox boots, runs a command, and returns `42`. The script then disposes the sandbox, but it ignores a failed dispose, so the ✓ doesn't prove cleanup. What a verify script doesn't prove: in the agent examples it checks the sandbox tool or backend directly, with no model key, so the agent turn itself isn't tested.

In a Python example, `verify.mjs` is a shim that runs `verify.py` with the example's `.venv/bin/python` if it exists, and otherwise `$PYTHON` or `python3`. You can also run `.venv/bin/python verify.py` yourself.

To check every example at once, run the root script:

```bash
cd ../..    # back to the repository root
npm run verify
```

It runs each example's `verify.mjs` in turn and ends with `✓ all examples passed`, or with `✗ N example(s) failed` and a non-zero exit. It doesn't install anything, so install each example's dependencies first, as CI does in [`.github/workflows/verify.yml`](.github/workflows/verify.yml). Unlike CI, it doesn't skip `composio-tenki` or `covalent-tenki`; see Troubleshooting.

## Official integrations

First-party packages you can install directly in your own project:

| Integration | Install | What it does |
| --- | --- | --- |
| [Composio tools](https://github.com/LuxorLabs/tenki-composio-tools) | `npm install @tenkicloud/composio-tools` | Create, execute, snapshot, and terminate tools for Composio agents |
| [Covalent executor](https://github.com/LuxorLabs/tenki-covalent-plugin) | `pip install covalent-tenki-plugin` | Runs Covalent workflow tasks in Tenki sandboxes |
| [GitHub Actions](https://github.com/TenkiCloud/actions) | `uses: TenkiCloud/actions/setup-cli@v1` | Installs the Tenki CLI and builds sandbox templates in CI |
| [Go SDK](https://github.com/LuxorLabs/tenki-sdk-go) | `go get github.com/LuxorLabs/tenki-sdk-go/sandbox` | Go client for the Tenki Sandbox API |
| [Convex component](https://github.com/LuxorLabs/tenki-convex) | `npm install @tenkicloud/convex` | Creates and drives sandboxes from Convex actions, with each one's state in a Convex table |

**Covalent note:** `covalent-tenki-plugin` 0.1.0, the only release on PyPI, depends on the renamed `tenki-sandbox` package and doesn't install. Wait for 0.1.1.

## Projects with built-in Tenki support

These open-source projects ship a Tenki provider or backend out of the box:

| Project | Tenki integration |
| --- | --- |
| [RAGFlow](https://github.com/infiniflow/ragflow) | Sandbox provider for the RAG engine's code executor — [example](examples/ragflow-tenki/) |
| [DeerFlow](https://github.com/bytedance/deer-flow) | Sandbox provider for ByteDance's SuperAgent harness — [example](examples/deerflow-tenki/) |
| [AgentBox](https://github.com/madarco/agentbox) | Provider for running parallel agents in sandboxed VMs — [example](examples/agentbox-tenki/) |
| [ComputeSDK](https://github.com/computesdk/computesdk) | Tenki provider for the multi-provider compute toolkit — [example](examples/computesdk-tenki/) |
| [AgentEnv Framework](https://github.com/scaleapi/agentenv-framework) | Sandbox backend for Scale AI's RL environments — [example](examples/agentenv-tenki/) |
| [OpenHermit](https://github.com/HCF-STUDIOS/openhermit) | Sandboxed exec backend for AI agent fleets — [example](examples/openhermit-tenki/) |
| [Omnara](https://github.com/omnara-ai/omnara) | Machine pool provider for the open-source managed agent platform — [example](examples/omnara-tenki/) |

## Troubleshooting

- ❌ **`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** The SDK found no key. `run.mjs` reads it from the environment only, not from `~/.config/tenki/config.yaml`. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY` in the shell you run it from.
- ❌ **`invalid auth token - API keys and service tokens must start with tk_`.** The SDK accepts only `tk_` API keys. Create one at https://app.tenki.cloud.
- ❌ **``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` from a JavaScript example's `verify.mjs` (`composio-tenki` and `vercel-ai-sdk` print `No Tenki token. …` instead, and `mcp-tenki-sandbox` prints `No token. Set TENKI_API_KEY, …`), or ``No API key. Set TENKI_API_KEY, or run `tenki login --api-key <key>`.`` from a Python example's `verify.py`.** A verify script found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export one of the variables, or run `tenki login --api-key <key>`.
- ❌ **`node run.mjs` fails with a `SyntaxError` at `await using`.** Top-level `await using` needs Node 24, and Node 22 can't parse it. Switch to Node 24 or newer. `node verify.mjs` still runs on Node 20.
- ❌ **`npm run verify` prints `FAILED: <example>` for examples you haven't set up.** The script assumes every example's dependencies are already installed. Install them in each example's folder first, or run `node verify.mjs` in the one example you care about.
- ❌ **`FAILED: composio-tenki` or `FAILED: covalent-tenki` in a local `npm run verify`.** CI skips both. `composio-tenki` also needs a `COMPOSIO_API_KEY` from https://app.composio.dev. `covalent-tenki` needs `covalent-tenki-plugin` 0.1.1 or later, because 0.1.0 declares the renamed `tenki-sandbox` package and no longer installs. There's no fix for `covalent-tenki` until 0.1.1 is published. Ignore that failure locally, as CI does, or run `node verify.mjs` only in the examples you use.
- ❌ **`ModuleNotFoundError: No module named '<package>'` from a Python example's `verify.mjs`.** The shim runs the example's `.venv/bin/python` if it exists, and otherwise `$PYTHON` or `python3`, so it can't see packages installed into another interpreter. Create the venv in the example's folder with `uv venv --python 3.12` and `uv pip install -r requirements.txt`. Without a venv, you can instead set `PYTHON` to the interpreter that has them.

## FAQ

**When shouldn't I use this?** When you want a library rather than a demo. Each example is short and shows one thing, so it's meant to be read and copied, not added as a dependency. To put Tenki in your own project, install the SDK or one of the official integrations above (see the Covalent note). And don't read a passing verify script as proof that an agent example's model turn works: it checks only the Tenki-facing part.

**Which example should I copy for my own integration?** For direct SDK use, [`run-code-in-a-sandbox`](examples/run-code-in-a-sandbox/). For a framework agent with a code-execution tool, [`langchain-code-interpreter`](examples/langchain-code-interpreter/). For a pluggable sandbox backend for a framework, [`vercel-ai-sdk`](examples/vercel-ai-sdk/).

**Do the examples clean up their sandboxes?** Sandboxes are billed per second, so it matters. The two first-run scripts do: `run.mjs` disposes its sandbox with `await using`, and `run.py` with a `with` block. Every verify script is required to clean up any sandbox it creates.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers local setup, the example checklist, and the verification contract. Every new example ships a `verify.mjs` that CI runs against the live API, and adds a row to one of the tables above.

## Resources

- [Tenki documentation](https://tenki.cloud/docs)
- [Sandbox SDK reference](https://tenki.cloud/docs/sandbox/sdk)
- [Tenki CLI reference](https://tenki.cloud/docs/sandbox/cli)
- [Tenki MCP server](https://github.com/LuxorLabs/tenki-mcp)
- [Tenki nodes for n8n](https://github.com/opencolin/n8n-nodes-tenki)

## License

[MIT](LICENSE)
