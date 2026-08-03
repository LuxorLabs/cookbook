# Tenki Cookbook

Working examples for [Tenki Sandbox](https://tenki.cloud/products/sandbox):
disposable Linux microVMs for running code and AI agents in isolation.

Each example is self-contained, with its own README, source code, and run
instructions. New to Tenki? Start with
[Run code in a sandbox](examples/run-code-in-a-sandbox/). It covers the whole
create, execute, dispose lifecycle in about 15 lines of JavaScript.

## Quick start

You need a [Tenki account](https://tenki.cloud), an API key with your project
and workspace IDs, and Node.js 20 or later.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/run-code-in-a-sandbox
npm install

export TENKI_AUTH_TOKEN="your-api-key"
export TENKI_PROJECT_ID="your-project-id"
export TENKI_WORKSPACE_ID="your-workspace-id"

node run.mjs
```

The script creates a sandbox, runs Python inside it, prints `42`, and cleans
up. Authentication and client setup are covered in the
[Sandbox SDK guide](https://tenki.cloud/docs/sandbox/sdk).

## Examples

**Sandbox API basics**

- [Run code in a sandbox](examples/run-code-in-a-sandbox/) - create a microVM, run a command, dispose it
- [Work with files](examples/files-in-a-sandbox/) - read, write, and list files with the TypeScript SDK
- [Expose a port](examples/expose-a-port/) - serve a web app on a public preview URL
- [Pause, snapshot, and resume](examples/snapshots-pause-resume/) - preserve a sandbox and pick up where it left off
- [Run code with Python](examples/run-code-python/) - the official `tenki-sandbox` Python SDK

**Agent frameworks** - give an agent a sandboxed place to run the code it writes

- [Vercel AI SDK](examples/vercel-ai-sdk/) - Tenki as the AI SDK's `experimental_sandbox`
- [LangChain (JavaScript)](examples/langchain-code-interpreter/) - sandboxed code interpreter tool
- [LangChain (Python)](examples/langchain-python/) - code-execution tool for a Python agent
- [CrewAI](examples/crewai-code-interpreter/) - run agent-generated code in a sandbox
- [OpenAI Agents SDK](examples/openai-agents-sdk/) - sandboxed execution as an agent tool
- [LlamaIndex](examples/llamaindex/) - sandboxed execution as a `FunctionTool`
- [Hugging Face smolagents](examples/smolagents/) - remote Python executor for a `CodeAgent`

**Developer tools**

- [MCP server](examples/mcp-tenki-sandbox/) - sandbox tools for Claude, Cursor, or any MCP client
- [Composio](examples/composio-tenki/) - Tenki tools in a Composio agent
- [Covalent](examples/covalent-tenki/) - each workflow task in its own microVM

**Migration guides** - side-by-side code and an API mapping

- [E2B to Tenki](examples/e2b-to-tenki-migration/)
- [Modal to Tenki](examples/modal-to-tenki-migration/)
- [Daytona to Tenki](examples/daytona-to-tenki-migration/)

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

## Ecosystem

First-party packages:

- [Composio tools](https://github.com/TenkiCloud/composio-tools) (`npm install @tenkicloud/composio-tools`) - sandbox tools for Composio agents
- [Covalent executor](https://github.com/TenkiCloud/covalent-tenki-plugin) (`pip install covalent-tenki-plugin`) - runs Covalent workflow tasks in Tenki microVMs
- [GitHub Actions](https://github.com/TenkiCloud/actions) (`uses: TenkiCloud/actions/setup-cli@v1`) - installs the Tenki CLI and builds sandbox templates in CI
- [Go SDK](https://github.com/TenkiCloud/tenki-sdk-go) (`go get github.com/TenkiCloud/tenki-sdk-go/sandbox`) - Go client for the Tenki Sandbox API

Open-source projects with a built-in Tenki provider or backend:

- [RAGFlow](https://github.com/infiniflow/ragflow) - sandbox provider for the RAG engine's code executor
- [DeerFlow](https://github.com/bytedance/deer-flow) - sandbox provider for ByteDance's SuperAgent harness
- [AgentBox](https://github.com/madarco/agentbox) - provider for running parallel agents in sandboxed VMs
- [ComputeSDK](https://github.com/computesdk/computesdk) - Tenki provider for the multi-provider compute toolkit
- [OpenHermit](https://github.com/HCF-STUDIOS/openhermit) - sandboxed exec backend for AI agent fleets

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
