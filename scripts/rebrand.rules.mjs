// What the Tenki → Luxor rename does to each mention of "tenki". See scripts/README.md.
// Every case-insensitive "tenki" in the repo must be matched by a rule or a protect pattern;
// `node scripts/rebrand.mjs --check` fails on any mention that is not, so a new name is decided
// here before it spreads.
//
// scope: "text"    Markdown prose, including untagged and ```text fences (the coding-agent prompts)
//        "comment" comments in code, and in code fences inside Markdown
//        "string"  string literals in code, including Python docstrings
//        "code"    everything else in code: identifiers, keywords, and `inline code` in Markdown
//        "any"     anywhere
//        or a list of these

const PROSE = ["text", "comment", "string"];

// Example folders: examples/<name>-tenki becomes examples/<name>-luxor.
export const FOLDERS = [
	"ag2", "agentbox", "agentenv", "anchor-browser", "composio", "computesdk", "convex", "covalent", "crabbox",
	"cursor-origin", "deerflow", "harbor", "hermes", "nemo-gym", "omnara", "open-webui", "openclaw", "openhermit",
	"orca", "pi-durable", "praisonai", "prefect", "ragflow", "stickydisk", "tinyfish",
];
const FOLDER = `(?:${FOLDERS.join("|")})-tenki|(?:e2b|daytona|modal)-to-tenki-migration|mcp-tenki-sandbox`;
// Folders added after the rename (examples/<name>-luxor on disk but not listed above) are ours alone,
// so <name>-tenki is renamed wherever it stands: tags, verify lines, prompts. Same for luxor-<name> folders.
// The caller passes the folder names (rebrand.mjs takes them from git ls-files), so the rules
// don't depend on what is checked out.
export function folderRules(names) {
	const NEW = [...new Set(names.map((n) => n.match(/^(.+)-luxor$/)?.[1]).filter((n) => n && !FOLDERS.includes(n)))];
	const NEW_PREFIX = [...new Set(names.map((n) => n.match(/^luxor-(.+)$/)?.[1]).filter(Boolean))];
	return [
		...(NEW.length ? [{ scope: "any", find: new RegExp(`(?<![\\w-])(${NEW.join("|")})-tenki(?!\\w)`, "g"), replace: "$1-luxor" }] : []),
		...(NEW_PREFIX.length ? [{ scope: "any", find: new RegExp(`(?<![\\w-])tenki-(${NEW_PREFIX.join("|")})(?![\\w-])`, "g"), replace: "luxor-$1" }] : []),
	];
}
// A folder name only where it names the folder: a path, a relative link, a verify line, a package name.
const AS_FOLDER = new RegExp(`(?<=\\/|\\[|✓ |"name": "|FAILED: |\`)(${FOLDER})(?![\\w-])`, "g");

export const rules = [
	// Runner labels: luxor.ai/docs/runners lists luxor-ubuntu-* and luxor-macos-*; tenki-* labels keep working.
	{ scope: "any", find: /\btenki-standard-(?=[a-z])/g, replace: "luxor-ubuntu-" },
	{ scope: "any", find: /\btenki-macos-(?=\d)/g, replace: "luxor-macos-" },
	{ scope: "any", find: /\btenki-(?=\[a-z0-9-\]|\.\.\.|…)/g, replace: "luxor-" },
	// The JS client reaching a sub-API: tenki.previewUrls.bind(...).
	{ scope: "code", files: /\.(m?[jt]s|tsx?|md)$/, find: /\btenki(?=\.[a-z]\w*\.[a-z]\w*\()/g, replace: "luxor" },
	// Domains. tenki.cloud, app.tenki.cloud and api.tenki.cloud all moved to luxor.ai.
	{ scope: "any", find: /https?:\/\/(www\.)?tenki\.cloud(?=[\/\s)"'`>\]#?]|$)/gm, replace: "https://luxor.ai" },
	{ scope: "any", find: /\b(app|api|mcp)\.tenki\.cloud\b/g, replace: "$1.luxor.ai" },
	{ scope: "any", find: /(?<![.\w/])tenki\.cloud\b/g, replace: "luxor.ai" },

	// Product names, as luxor.ai names them.
	{ scope: PROSE, find: /\bTenki Sandbox(es)?\b/g, replace: "Luxor Sandbox$1" },
	{ scope: PROSE, find: /\bTenki sandbox(es)?\b/g, replace: "Luxor sandbox$1" },
	{ scope: PROSE, find: /\bTenki (Code Reviewer|Runners?|runners?|blog)\b/g, replace: "Luxor $1" },
	{ scope: PROSE, find: /\bTenki CLI\b/g, replace: "Luxor CLI" },
	{ scope: PROSE, find: /\bTenki-(facing|side|backed|hosted|specific|only)\b/g, replace: "sandbox-$1" },
	// The company and platform everywhere else it is a word in prose.
	{ scope: PROSE, find: /\bTenki('s)?\b(?![-_])/g, replace: "Luxor Agent Cloud$1" },

	// npm packages: every @tenkicloud package is published as @luxorai at the same version.
	{ scope: "any", find: /@tenkicloud\/(sandbox|convex|mcp|composio-tools|agentbox-provider|openclaw)\b/g, replace: "@luxorai/$1" },
	{ scope: "any", find: /\bTenkiSandbox\b/g, replace: "LuxorSandbox" },
	{ scope: "any", find: /\btenkiToolkit\b/g, replace: "luxorToolkit" },
	{ scope: "any", find: /\btenki-mcp\b(?=\s*(server|binary|bin|\)|`|$))/gm, replace: "luxor-mcp" },

	// The CLI is `luxor` now, and `luxor login` writes ~/.config/luxor/config.yaml.
	{ scope: "any", find: /\btenki (login|logout|whoami|status|sandbox|snapshot|workspace|auth|config|template|volume|preview)\b/g, replace: "luxor $1" },
	{ scope: "any", find: /\.config\/tenki\/config\.yaml/g, replace: ".config/luxor/config.yaml" },
	{ scope: PROSE, find: /\b(the|a) tenki CLI\b|\btenki(?= or crabbox)/g, replace: (m) => m.replace("tenki", "luxor") },

	// Example folders and the names of things the examples themselves define.
	{ scope: "any", find: AS_FOLDER, replace: (m) => m.replace("-to-tenki-", "-to-luxor-").replace("-tenki", "-luxor") },
	{ scope: "any", find: /\btenki([-_])(tools?|sandbox|env|executor)(?=\.(mjs|py)\b|["'`]|\s+import\b|$)/gm, replace: "luxor$1$2" },
	{ scope: "any", find: /\b(make|create)Tenki(Tools|Sandbox|Env)\b/g, replace: "$1Luxor$2" },
	{ scope: "any", find: /\btenkiEnv\b/g, replace: "luxorEnv" },
	// The variable that holds the SDK client: const tenki = new LuxorSandbox(...) becomes const luxor.
	{ scope: "code", find: /\b(const|let|var) tenki\b|\btenki(?=\.(createAndWait|create|get|list|createSnapshotAndWait|deleteSnapshot|snapshots|sessions|volumes|whoAmI|getUsage|workspaces|templates|exec|destroy|writeFile|readFile)\b)|(?<=[(,{] ?)tenki(?=[,)} ])/g, replace: (m) => m.replace("tenki", "luxor") },
	{ scope: "any", find: /\bTenkiCodeInterpreter\b/g, replace: "LuxorCodeInterpreter" },
	{ scope: "any", files: /smolagents\//, find: /\bTenkiExecutor\b/g, replace: "LuxorExecutor" },
	{ scope: "any", find: /\btenki_client\b/g, replace: "luxor_client" },
	{ scope: "any", find: /\bserverId: "tenki"/g, replace: 'serverId: "luxor"' },
	{ scope: "any", find: /\bmcp__tenki__/g, replace: "mcp__luxor__" },
	{ scope: "any", find: /\b(mcpServers: \{ |claude mcp add |claude mcp add --transport http |claude mcp login |claude mcp get |name: ")tenki\b/g, replace: "$1luxor" },
	{ scope: "any", find: /\btenki-(sandboxes|orca|example|verify|cookbook-verify|pool|remote-mcp-server|remote)\b/g, replace: "luxor-$1" },
	{ scope: "any", find: /\b(ragflow|prefect)-tenki-verify\b/g, replace: "$1-luxor-verify" },
	// Strings the examples print and check, and names they give things.
	{ scope: "any", find: /\bhello-from-tenki\b|\bhello from tenki\b|\bmodal->tenki\b|\bhello-tenki\b|\bpi-env:tenki:|\bpi-durable-tenki(?= \$)|\btenki-\$\{|reconcile tenki sandboxes|ui:\/\/tenki\//g, replace: (m) => m.replace("tenki", "luxor") },
	{ scope: "code", find: /\btenki(?=\.[a-z]\w*\()/g, replace: "luxor" },
	{ scope: "code", files: /\.md$/, find: /\bTenki(?= (token|kernel|backend at|→))/g, replace: "Luxor Agent Cloud" }, // messages our own scripts print
	{ scope: "any", find: /\bswebench-tenki\.json\b|\btenki-api-key\b|`tenki-…`/g, replace: (m) => m.replace("tenki", "luxor") },
	// UI text in the CopilotKit example lives in JSX and nested template literals, which the tokenizer reads as code.
	{ scope: "any", files: /copilotkit-mcp-apps\//, find: /\bTenki (Sandbox|sandbox(es)?)\b/g, replace: (m) => m.replace("Tenki", "Luxor") },
	{ scope: "any", files: /copilotkit-mcp-apps\//, find: /<b>Tenki<\/b>/g, replace: "<b>Luxor</b>" },
	{ scope: "any", files: /copilotkit-mcp-apps\//, find: /\btenki(?=\.[a-z]\w*\()/g, replace: "luxor" },
	{ scope: "any", files: /\.ya?ml$/, find: /\bTenki\b(?![-_])/g, replace: "Luxor Agent Cloud" },
];

// Names that stay "tenki" because something outside the cookbook still uses them.
export const protect = [
	// The platform.
	{ why: "platform: sandbox user", find: /\/home\/tenki\b|\buser(name)? `?tenki`?|\btenki@|\btenki tenki\b|x86_64\s+tenki\b/g },
	{ why: "platform: preview domain", find: /\b[a-z0-9.-]*sb\.tenki\.sh\b/g },
	{ why: "platform: Code Reviewer bot", find: /@tenki-reviewer\b/g },
	{ why: "platform: container images", find: /\btenki\/(anchor|tinyfish)\b(:[a-z0-9.-]+)?/g },
	// What the SDKs and packages still call themselves.
	{ why: "SDK: TENKI_* environment variables, the fallback the SDKs and plugins still read", find: /\bTENKI_[A-Z0-9_]+\b/g },
	{ why: "SDK: the Python package's classes", files: /\.py$/, find: /\btenki(?=\.[A-Z]\w*)/g },
	{ why: "SDK: the Python package", find: /(?:^|;|`)\s*(from|import) tenki\b|\bpip install tenki\b|pypi\.org\/project\/tenki\b|\btenki(?=\[|\s*[><=~]=?\s*[0-9])|\btenki_sandbox\b|`tenki`|\btenki`?(?=`?\s+(\d\.x\s+)?(Python |Go )?(SDK|package|client)\b)|(?<=(#|\band|\bONLY|\bonly|\bdatasets|\bswebench|\brequirements),?\s)tenki\b|\btenki(?=\s\+\s)/gm },
	{ why: "SDK: the Go module and SDK repos", find: /tenki-sdk-(go|python|es)|\btenkisdk\b/g },
	{ why: "SDK: plugin and integration repos", find: /\b(LuxorLabs|TenkiCloud|opencolin)\/[\w.-]*tenki[\w.-]*|\btenki-[a-z0-9-]+#\d+|\bTenkiCloud\b/g },
	{ why: "SDK: MCP tool names and server id", find: /\btenki_(?!(tools?|executor|client)\b)[a-z_]+\b|\btenki-mcp\b|"tenki" MCP server/g },
	{ why: "SDK: plugin ids in OpenClaw and AgentBox", find: /id "tenki"|\bprovider: tenki\b|\bkind: tenki\b|\btenki:(?=`? group)/g },
	// The Convex component still exports its class as Tenki and registers as components.tenki,
	// so its example keeps the class and the variable that holds it.
	{ why: "SDK: the Convex component's Tenki class", files: /convex-(tenki|luxor)\//, scope: "code", find: /\bcomponents\.tenki\b|\b(class|new) Tenki\b|\b(import \{ ?|\{ ?)Tenki\b|\bTenki(?=[(<.])|\btenki(?=\.[a-zA-Z]|\s*=\s*new\b|\s*[,)])|\b(const|let) tenki\b|\bimport tenki\b|\btenki(?= from)/g },
	{ why: "SDK: the Convex component's Tenki class", files: /convex-(tenki|luxor)\//, find: /\btenki\.create\b/g },
	{ why: "SDK: the Convex component name", find: /\bcomponents\.tenki\b|\buse\(tenki\)|\bimport tenki from\b/g },
	{ why: "SDK: names the packages define (env vars, tool slugs, runtime tags)", find: /[A-Z_]*TENKI[A-Z_]*|\boc-tenki-|\bworker-type: tenki\b|\btenki-prod\b|\bid: tenki\b|\blinux tenki\b|\btenki: (collect|exec)\b/g },
	{ why: "SDK: messages the packages print, quoted in troubleshooting", scope: "code", files: /\.md$/, find: /\bTenki\b(?! (token|kernel|backend at|→))/g },
	{ why: "upstream: the Covalent plugin's executor class", files: /covalent-(tenki|luxor)\/|^README\.md$/, find: /\bTenkiExecutor\b/g },
	{ why: "upstream: Covalent's executor variable", files: /covalent-(tenki|luxor)\//, find: /\btenki\b(?= = Tenki|\))|executor=tenki\b/g },
	{ why: "SDK: configs the old tenki CLI wrote, still read as a fallback", find: /\["luxor", "tenki"\]|\("luxor", "tenki"\)|\{"luxor", "tenki"\}/g },
	{ why: "upstream: Crabbox's provider block, and the binary name it looks for by default", files: /crabbox-(tenki|luxor)\//, find: /\btenki:(?=\s|`)|\bnamed tenki\b/g },
	{ why: "SDK: the OpenClaw plugin may depend on the SDK under either npm scope", files: /openclaw-(tenki|luxor)\/verify\.mjs$/, find: /@\(tenkicloud\|luxorai\)/g },
	{ why: "upstream: the pinned Hermes fork reads only the old tenki CLI's config", files: /hermes-(tenki|luxor)\//, find: /\.config\/tenki\/config\.yaml|\btenki login\b/g },
	{ why: "SDK: the Python SDK's old PyPI name, and its branch names", find: /(?<!mcp-)\btenki-sandbox\b(?!\.mjs)|\btenki-sdk-1\.x\b/g },
	{ why: "SDK: the OpenClaw plugin id", find: /\bplugins\.entries\.tenki\b|\bPlugin tenki\b|\bInvalid tenki plugin\b/g },
	{ why: "platform: the sandbox user, as id -un prints it", find: /"tenki https:|username: "tenki"/g },
	{ why: "upstream: DeerFlow's sandbox names", find: /deer-flow-tenki-/g },
	{ why: "legal: copyright holder", find: /Copyright \(c\) \d{4} Tenki Cloud/g },
	// Other projects' identifiers: renamed only after each upstream adds a luxor alias.
	{ why: "upstream: links into other projects", find: /https?:\/\/(?!(app\.|api\.|mcp\.)?tenki\.cloud)(?!github\.com\/LuxorLabs\/)(?!www\.npmjs\.com\/package\/@tenkicloud\/)[^\s)\]>"'`]*tenki[^\s)\]>"'`]*/gi },
	{ why: "upstream: AG2, PraisonAI, ComputeSDK, Prefect, agentenv, Harbor, Covalent, Hermes, NeMo Gym, OpenHermit", find: /\{ ?tenki ?\}(?= from "@computesdk)|(?<!examples\/|\.\.\/|✓ |FAILED: )@computesdk\/tenki\b|\bcomputesdk[./]tenki\b|\bag2\.extensions\.tenki\b|\bag2\[tenki\]|\bpraisonai[a-z_.]*\.tenki\b|\bpraisonai\[tenki\]|\bTenki(Environment|Compute|ComputeLegacy|Worker|WorkerJobConfiguration|Credentials|Resources|SandboxProvider|ExecBackend|Session)\b|(?<!examples\/|\.\.\/|✓ |FAILED: |\/path\/to\/)\b(covalent[-_]tenki[-_]plugin|tenki_harbor|tenki-harbor|nemo-gym-tenki|hermes-tenki|prefect_tenki|prefect-tenki|tenki-prefect|langchain-tenki|praisonai-tenki|openhermit-tenki|tenki-plugin)\b|\btenki_snapshots\b|\btools\.environments\.tenki\b|\benvironments\/tenki\.py\b/g },
	{ why: "upstream: provider names in other tools' CLIs and configs", find: /(--provider|--sandbox|--type|--extra|UV_EXTRAS=|provider[=:]|tools_run_on=|default\s*=|sandbox_providers\/|providers\/|providers\.)\s*["'`]{0,2}tenki\b|\[tenki\]|\bagentbox( plugin list[^\n]*?| [a-z]+ --provider)? tenki\b|(?<!name: |serverId: )["'`]{1,2}tenki["'`]{1,2}|\b(the|a|built-in|its|SDK v2) [`"]?tenki[`"]? (provider|backend|worker|exec backend|extension|group|sandbox provider)\b|\b(selecting|runtime as) tenki\b|\btenki(?=\s+sandbox\s+01)|prints: tenki\b|\btenki is required\b|\bsandbox\/tenki(_test)?\.go\b|backends\/tenki\.ts\b|\bpackages\/tenki\b|\bcommunity\.tenki\b|tenki-backend\.test\.ts|\bextensions\/tenki\.mdx\b|compute\/tenki\.py\b|\bprovider=tenki\b|\btoolkit: "TENKI"/g },
	{ why: "upstream: names other tools give their Tenki provider", find: /--(env-|agent-)?sandbox tenki\b|\btenki\(\)|,tenki\b|test_tenki_provider\.py|tenki-harness-evals|TERMINAL_ENV=tenki|\bterminal\.tenki\b|"tenki\.py"|tenki_\*|owui_tenki_out|\.\/tenki-openclaw|(STATE_DIR|\.openclaw)\/tenki\b|\btenki-default\b|"type":"tenki"|sandbox type: tenki|SANDBOX_PROVIDER_TYPE=tenki|`tenki: [a-zA-Z][^`]*`|executor type: tenki|\btenki(?=\.(diskGB|image)\b)|crabbox-provider-tenki|\/tenki-prepared\.json|\btenki:(?=\s+cpus)|\btarget: linux\b/g },
	{ why: "upstream: blog and docs slugs", find: /#tenki-isnt-[a-z0-9-]+|\/blog\/[a-z0-9-]*tenki[a-z0-9-]*/g },
];
