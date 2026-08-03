# Tenki Cookbook

Working examples for [Tenki Sandbox](https://tenki.cloud/products/sandbox):
disposable Linux VMs for running code and AI agents in isolation.

Each example is self-contained, with its own README, source code, and run
instructions. New to Tenki? Start with
[Run code in a sandbox](examples/run-code-in-a-sandbox/). It covers the whole
create, execute, dispose lifecycle in about 15 lines of JavaScript.

## Quick start

You need a [Tenki account](https://tenki.cloud), an API key, your workspace ID,
and Node.js 20 or later.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/run-code-in-a-sandbox
npm install

export TENKI_AUTH_TOKEN="your-api-key"
export TENKI_WORKSPACE_ID="your-workspace-id"

node run.mjs
```

The script creates a sandbox, runs Python inside it, prints `42`, and cleans
up. Authentication and client setup are covered in the
[Sandbox SDK guide](https://tenki.cloud/docs/sandbox/sdk).

## Examples

### Sandbox API basics

| Example | What it covers |
| --- | --- |
| [Run code in a sandbox](examples/run-code-in-a-sandbox/) | Create a microVM, run a command, dispose it |
| [Work with files](examples/files-in-a-sandbox/) | Read, write, and list files with the TypeScript SDK |
| [Expose a port](examples/expose-a-port/) | Serve a web app on a public preview URL |
| [Pause, snapshot, and resume](examples/snapshots-pause-resume/) | Preserve a sandbox and pick up where it left off |
| [Run code with Python](examples/run-code-python/) | The official `tenki-sandbox` Python SDK |

### Agent frameworks

Give an agent a sandboxed place to run the code it writes.

| Example | Framework |
| --- | --- |
| [Vercel AI SDK](examples/vercel-ai-sdk/) | Tenki as the AI SDK's `experimental_sandbox` |
| [LangChain (JavaScript)](examples/langchain-code-interpreter/) | Sandboxed code interpreter tool |
| [LangChain (Python)](examples/langchain-python/) | Code-execution tool for a Python agent |
| [CrewAI](examples/crewai-code-interpreter/) | Run agent-generated code in a sandbox |
| [OpenAI Agents SDK](examples/openai-agents-sdk/) | Sandboxed execution as an agent tool |
| [LlamaIndex](examples/llamaindex/) | Sandboxed execution as a `FunctionTool` |
| [Hugging Face smolagents](examples/smolagents/) | Remote Python executor for a `CodeAgent` |

### Developer tools

| Example | Integration |
| --- | --- |
| [MCP server](examples/mcp-tenki-sandbox/) | Sandbox tools for Claude, Cursor, or any MCP client |
| [Composio](examples/composio-tenki/) | Tenki tools in a Composio agent |
| [Covalent](examples/covalent-tenki/) | Each workflow task in its own microVM |

### Agent platforms

Run a self-hosted agent platform's sandboxes on Tenki.

| Example | Platform |
| --- | --- |
| [OpenHermit](examples/openhermit-tenki/) | Sticky per-agent microVMs for an agent fleet |

### Migrating from another provider

Each guide has side-by-side code and an API mapping.

| Guide |
| --- |
| [E2B to Tenki](examples/e2b-to-tenki-migration/) |
| [Modal to Tenki](examples/modal-to-tenki-migration/) |
| [Daytona to Tenki](examples/daytona-to-tenki-migration/) |

## Verifying an example

Every example ships a `verify.mjs` script that exercises it against the live
API, so you can check that it still works before building on it. With your
credentials set:

```bash
cd examples/run-code-in-a-sandbox
npm install
node verify.mjs
```

From the repository root, `npm run verify` runs every example's script.

## Official integrations

First-party packages you can install directly in your own project:

| Integration | Install | What it does |
| --- | --- | --- |
| [Composio tools](https://github.com/TenkiCloud/composio-tools) | `npm install @tenkicloud/composio-tools` | Create, execute, snapshot, and terminate tools for Composio agents |
| [Covalent executor](https://github.com/TenkiCloud/covalent-tenki-plugin) | `pip install covalent-tenki-plugin` | Runs Covalent workflow tasks in Tenki microVMs |
| [GitHub Actions](https://github.com/TenkiCloud/actions) | `uses: TenkiCloud/actions/setup-cli@v1` | Installs the Tenki CLI and builds sandbox templates in CI |
| [Go SDK](https://github.com/TenkiCloud/tenki-sdk-go) | `go get github.com/TenkiCloud/tenki-sdk-go/sandbox` | Go client for the Tenki Sandbox API |

## Projects with built-in Tenki support

These open-source projects ship a Tenki provider or backend out of the box:

| Project | Tenki integration |
| --- | --- |
| [RAGFlow](https://github.com/infiniflow/ragflow) | Sandbox provider for the RAG engine's code executor |
| [DeerFlow](https://github.com/bytedance/deer-flow) | Sandbox provider for ByteDance's SuperAgent harness |
| [AgentBox](https://github.com/madarco/agentbox) | Provider for running parallel agents in sandboxed VMs |
| [ComputeSDK](https://github.com/computesdk/computesdk) | Tenki provider for the multi-provider compute toolkit |
| [OpenHermit](https://github.com/HCF-STUDIOS/openhermit) | Sandboxed exec backend for AI agent fleets — [example](examples/openhermit-tenki/) |

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers local
setup, the example checklist, and the verification contract.

## Resources

- [Tenki documentation](https://tenki.cloud/docs)
- [Sandbox SDK reference](https://tenki.cloud/docs/sandbox/sdk)
- [Tenki MCP server](https://github.com/LuxorLabs/tenki-mcp)
- [Tenki nodes for n8n](https://github.com/opencolin/n8n-nodes-tenki)

## License

[MIT](LICENSE)
