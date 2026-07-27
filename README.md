# Tenki Cookbook

Working examples for running code and AI agents in isolated, disposable Linux
microVMs with [Tenki Sandbox](https://tenki.cloud/products/sandbox).

Use this cookbook to:

- run untrusted or agent-generated code without exposing your host;
- give popular agent frameworks a secure code-execution tool;
- expose sandboxed services through public preview URLs;
- preserve an environment with snapshots; or
- migrate an existing E2B, Modal, or Daytona integration to Tenki.

New to Tenki? Start with
[Run code in a sandbox](examples/run-code-in-a-sandbox/). It covers the core
create, execute, and dispose lifecycle in about 15 lines of JavaScript.

## Quick start

You need:

- a [Tenki account](https://tenki.cloud);
- a Tenki API key and your project and workspace IDs; and
- Node.js 20 or later.

Clone the cookbook and run the introductory example:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/run-code-in-a-sandbox
npm install

export TENKI_AUTH_TOKEN="your-api-key"
export TENKI_PROJECT_ID="your-project-id"
export TENKI_WORKSPACE_ID="your-workspace-id"

node run.mjs
```

The script creates a sandbox, runs Python inside it, prints `42`, and disposes
the sandbox automatically. See the
[Sandbox SDK guide](https://tenki.cloud/docs/sandbox/sdk) for authentication
and client setup details.

## Find an example

### Learn the Sandbox API

| Example | What you will learn |
| --- | --- |
| [Run code in a sandbox](examples/run-code-in-a-sandbox/) | Create a microVM, execute a command, read its output, and dispose it |
| [Work with files](examples/files-in-a-sandbox/) | Write, read, and list files with the TypeScript SDK |
| [Expose a port](examples/expose-a-port/) | Run a web server and create a public preview URL |
| [Pause, snapshot, and resume](examples/snapshots-pause-resume/) | Preserve a sandbox and resume it with its state intact |
| [Run code with Python](examples/run-code-python/) | Use the official `tenki-sandbox` Python SDK |

### Add secure code execution to an agent

| Example | Framework or use case |
| --- | --- |
| [Vercel AI SDK](examples/vercel-ai-sdk/) | Use Tenki as the AI SDK's `experimental_sandbox` |
| [LangChain (JavaScript)](examples/langchain-code-interpreter/) | Give a LangChain agent a sandboxed code interpreter |
| [LangChain (Python)](examples/langchain-python/) | Add a Tenki code-execution tool to a Python agent |
| [CrewAI](examples/crewai-code-interpreter/) | Run agent-generated code in a Tenki sandbox |
| [OpenAI Agents SDK](examples/openai-agents-sdk/) | Add sandboxed execution as an agent tool |
| [LlamaIndex](examples/llamaindex/) | Wrap sandboxed execution in a `FunctionTool` |
| [Hugging Face smolagents](examples/smolagents/) | Back a `CodeAgent` with a remote Python executor |
| [Vercel Eve](examples/eve-agent-on-tenki/) | Use Tenki as an Eve agent's sandbox backend |

### Connect Tenki to developer tools

| Example | Integration |
| --- | --- |
| [MCP server](examples/mcp-tenki-sandbox/) | Give Claude, Cursor, or another MCP client access to Tenki sandbox tools |
| [Composio](examples/composio-tenki/) | Add Tenki tools to a Composio agent |
| [Covalent](examples/covalent-tenki/) | Run each workflow task in its own microVM |

### Migrate to Tenki

| Guide | What it includes |
| --- | --- |
| [E2B to Tenki](examples/e2b-to-tenki-migration/) | Side-by-side code and an API mapping |
| [Modal to Tenki](examples/modal-to-tenki-migration/) | Side-by-side code and an API mapping |
| [Daytona to Tenki](examples/daytona-to-tenki-migration/) | Side-by-side code and an API mapping |

Each example is self-contained. Open its README for prerequisites, complete
source code, and run instructions.

## Tested against the live API

Cookbook examples should be useful when you need them, not just when they are
written. Each example includes a `verify.mjs` script that exercises its
Tenki-facing behavior against the live API. CI runs those checks on every push
and pull request.

To verify an individual example after setting your Tenki credentials:

```bash
cd examples/run-code-in-a-sandbox
npm install
node verify.mjs
```

Maintainers and contributors can run every example from the repository root:

```bash
npm run verify
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the verification contract and the
recommended structure for new examples.

## Official integrations

These first-party packages can be installed directly in your own project:

| Integration | Install | What it does |
| --- | --- | --- |
| [Composio tools](https://github.com/TenkiCloud/composio-tools) | `npm install @tenkicloud/composio-tools` | Provides create, execute, snapshot, and terminate tools for Composio agents |
| [Covalent executor](https://github.com/TenkiCloud/covalent-tenki-plugin) | `pip install covalent-tenki-plugin` | Runs Covalent workflow tasks in disposable Tenki microVMs |
| [GitHub Actions](https://github.com/TenkiCloud/actions) | `uses: TenkiCloud/actions/setup-cli@v1` | Installs the Tenki CLI and builds sandbox templates in CI |
| [Go SDK](https://github.com/TenkiCloud/tenki-sdk-go) | `go get github.com/TenkiCloud/tenki-sdk-go/sandbox` | Provides a Go client for the Tenki Sandbox API |

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for local
setup and the example checklist, then choose an idea from
[ROADMAP.md](ROADMAP.md).

## Resources

- [Tenki documentation](https://tenki.cloud/docs)
- [Sandbox SDK reference](https://tenki.cloud/docs/sandbox/sdk)
- [Tenki MCP server](https://github.com/opencolin/tenki-mcp)
- [Tenki backend for Vercel Eve](https://github.com/opencolin/tenki-eve-sandbox)
- [Tenki nodes for n8n](https://github.com/opencolin/n8n-nodes-tenki)

## License

[MIT](LICENSE)
