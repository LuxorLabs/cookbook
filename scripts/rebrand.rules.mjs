// What the Tenki → Luxor Agent Cloud rename does to each mention of "tenki", phase by phase.
// See scripts/README.md. Every case-insensitive "tenki" in the repo must be matched by a rule
// or a protect pattern; `node scripts/rebrand.mjs --check` fails on any mention that is not,
// so a new name is decided here before it spreads.
//
// scope: "text"    Markdown prose, including untagged and ```text fences (the coding-agent prompts)
//        "comment" comments in code, and in code fences inside Markdown
//        "string"  string literals in code, including Python docstrings
//        "code"    everything else in code: identifiers, keywords, and `inline code` in Markdown
//        "any"     anywhere
//        or a list of these
// replace: null means the new name is not decided yet. The rule still classifies the mention,
// but --write skips it.

export const PHASES = ["1", "2a", "2b", "2c", "3"];

export const rules = [
	// Phase 1: prose and docs links. luxor.ai/docs already redirects to tenki.cloud/docs.
	// luxor.ai redirects to tenki.cloud keeping the path, so every page link can move now.
	{ phase: "1", scope: "any", find: /https?:\/\/(www\.)?tenki\.cloud(?=[\/\s)"'`>\]#?]|$)/gm, replace: "https://luxor.ai" },
	{ phase: "1", scope: "any", find: /(?<![.\w/])tenki\.cloud\b/g, replace: "luxor.ai" },
	// The brand as a word, wherever it is prose: Markdown, comments, and strings (log lines,
	// page titles). Not in code, where Tenki is a class (the Convex component's).
	{ phase: "1", scope: ["text", "comment", "string"], find: /\bTenki [Ss]andbox(es)?\b/g, replace: "Luxor Agent Cloud sandbox$1" },
	{ phase: "1", scope: ["text", "comment", "string"], find: /\bTenki('s)?\b(?![-_])/g, replace: "Luxor Agent Cloud$1" },
	{ phase: "1", scope: ["text", "comment", "string"], find: /\bTenki-(facing|side|backed|hosted|specific|only)\b/g, replace: "sandbox-$1" },

	// Phase 2a: app and API hosts, once app.luxor.ai serves.
	{ phase: "2a", scope: "any", find: /\bapp\.tenki\.cloud\b/g, replace: "app.luxor.ai" },
	{ phase: "2a", scope: "any", find: /\bapi\.tenki\.cloud\b/g, replace: null },

	// Phase 2b: our packages, classes, env vars, CLI and images. Names not decided yet.
	{ phase: "2b", scope: "any", find: /@tenkicloud\/[a-z0-9-]+/g, replace: null },
	{ phase: "2b", scope: "any", find: /\bTenki(Sandbox|Credentials|Compute|Worker|Resources|Session)\b/g, replace: null },
	{ phase: "2b", scope: "any", find: /\bTENKI_[A-Z0-9_]+\b/g, replace: null },
	{ phase: "2b", scope: "any", find: /(~|\$HOME|\$\{homedir\(\)\}|\bhomedir\(\)\s*,\s*["'`])?\/?\.config\/tenki\b/g, replace: null },
	{ phase: "2b", scope: "any", find: /\btenki (login|logout|whoami|sandbox|snapshot|workspace|auth|config)\b/g, replace: null },
	{ phase: "2b", scope: "any", find: /\btenki\/[a-z0-9-]+(:[a-z0-9.-]+)?/g, replace: null }, // container images
	{ phase: "2b", scope: "any", find: /\b(from|import) tenki\b|\bpip install tenki\b|pypi\.org\/project\/tenki\b|\btenki(?=[>=<~ ]=?[0-9])/g, replace: null }, // Python SDK
	{ phase: "2b", scope: "any", find: /\btenki_sandbox\b/g, replace: null },
	{ phase: "2b", scope: "any", find: /\btenki(?=\[|\s*>=|,\s|\s\+\s)|(?<=(#|\band|\bONLY|\bonly|\bIf|\bthe)\s)tenki\b(?! (provider|sandbox provider|exec backend))|\btenki(?= or crabbox)/g, replace: null },
	{ phase: "2b", scope: "any", find: /\btenki-[a-z0-9-]+#\d+/g, replace: null }, // issues in our plugin repos
	{ phase: "2b", scope: "any", find: /\btenki`?(?=`?\s+(\d\.x\s+)?(Python |Go |TypeScript |JavaScript )?(SDK|CLI|package|client)\b)|\btenki(?=`?\s\+\s)|(?<=\b(datasets|swebench|requirements),\s*)tenki\b/g, replace: null },
	{ phase: "2b", scope: "any", find: /tenki-sdk-go/g, replace: null },
	{ phase: "2b", scope: "any", find: /LuxorLabs\/tenki-[a-z0-9-]+/gi, replace: null }, // our plugin repos
	{ phase: "2b", scope: "any", find: /\b(covalent-tenki-plugin|covalent_tenki_plugin|tenki-mcp|tenki-openclaw|tenki_harbor|tenki-harbor)\b/g, replace: null },

	// Phase 2c: example folders and our own helper names inside examples.
	{ phase: "2c", scope: "any", find: /\b(e2b|daytona|modal)-to-tenki-migration\b/g, replace: "$1-migration" },
	{ phase: "2c", scope: "any", find: /\b(mcp)-tenki-sandbox\b/g, replace: "$1-sandbox" },
	{ phase: "2c", scope: "any", find: /\b([a-z0-9]+(?:-[a-z0-9]+)*)-tenki\b(?![-.]?[a-z])/g, replace: "$1" },
	{ phase: "2c", scope: "any", find: /\btenki[-_](tool|tools|executor|env|sandbox|exec|run_code|create_sandbox|terminate_sandbox|write_file|read_file|list_files)\b/g, replace: null },
	{ phase: "2c", scope: "any", find: /\b(make|create|new)?Tenki[A-Z][A-Za-z]*\b/g, replace: null },
	{ phase: "2c", scope: "any", find: /\b[a-z][A-Za-z]*Tenki[A-Za-z]*\b/g, replace: null },
	{ phase: "2c", scope: "any", find: /\btenki[A-Z][A-Za-z]*\b/g, replace: null },
	{ phase: "2c", scope: "any", find: /\b[a-z0-9]+-tenki-[a-z0-9-]+|\btenki-pool\b|\btenki:(?=`? group)|(?<=mcp add )tenki\b/g, replace: null }, // names we chose
	// Anything else in code or `inline code` is an identifier we chose (a variable, an MCP server
	// name, a tool name). Each is renamed by hand, with --dry-run, in the phase that renames its package.
	{ phase: "2c", scope: "code", find: /[A-Za-z0-9_$]*tenki[A-Za-z0-9_$]*/gi, replace: null },
	{ phase: "2c", scope: "string", find: /[A-Za-z0-9_$./:-]*tenki[A-Za-z0-9_$./:-]*/gi, replace: null }, // names in strings: tool names, ids, sample output
	{ phase: "2c", scope: "any", find: /[A-Za-z0-9_$.]*(tenki(?!\.cloud\b|\.sh\b)[._(]|[._]tenki)[A-Za-z0-9_$.]*/gi, replace: null },
];

// Mentions that stay "tenki" until something outside the cookbook changes.
export const protect = [
	// The platform: the sandbox user and the preview-URL domain.
	{ why: "platform: sandbox user", find: /\/home\/tenki\b|\buser(name)? `?tenki`?|\btenki@/g },
	{ why: "platform: preview domain", find: /\b[a-z0-9.-]*sb\.tenki\.sh\b/g },
	// Other projects' identifiers: renamed only after each upstream adds a luxor alias.
	{ why: "upstream: ComputeSDK", find: /@computesdk\/tenki\b|\bcomputesdk[./-]tenki\b/g },
	{ why: "upstream: AG2", find: /\bag2\.extensions\.tenki\b|\bag2\[tenki\]/g },
	{ why: "upstream: PraisonAI", find: /\bpraisonai[a-z_.]*\.tenki\b|\bpraisonai\[tenki\]/g },
	{ why: "upstream: provider ids", find: /(provider|backend|runtime|compute)["']?\s*[:=]\s*["']tenki["']|["']tenki["']\s*:/g },
	{ why: "upstream: links into other projects", find: /https?:\/\/(?!(app\.|api\.)?tenki\.cloud)(?!github\.com\/LuxorLabs\/)[^\s)\]>"'`]*tenki[^\s)\]>"'`]*/gi },
	{ why: "upstream: provider names in other tools' CLIs and configs", find: /(--provider|--sandbox|--type|--extra|UV_EXTRAS=|provider[=:]|tools_run_on=|default\s*=)\s*["'`]{0,2}tenki\b|\[tenki\]|\bagentbox( plugin list[^\n]*?| [a-z]+ --provider)? tenki\b|["'`]{1,2}tenki["'`]{1,2}(?=\s+(worker|provider|backend|exec|extension|group))|\b(the|a|built-in|its|SDK v2) [`"]?tenki[`"]? (provider|backend|worker|exec backend|extension|group)\b/g },
	{ why: "upstream: provider ids as strings", find: /`{0,2}["']tenki["']`{0,2}|`tenki` (sandbox provider|exec backend|provider|backend)|\b(selecting|runtime as) tenki\b|\btenki(?=\s+sandbox\s+01)|prints: tenki\b|\btenki is required\b/g },
	{ why: "platform: sandbox user and host in shell output", find: /\btenki tenki\b|x86_64\s+tenki\b/g },
	{ why: "platform: Runners labels", find: /\btenki-(standard|large|small|medium|xlarge)[a-z0-9-]*|#tenki-isnt-[a-z0-9-]+|\/blog\/tenki-[a-z0-9-]+/g },
	{ why: "platform: Code Reviewer bot", find: /@tenki-reviewer\b/g },
	{ why: "legal: copyright holder", find: /Copyright \(c\) \d{4} Tenki Cloud/g },
	// Product names that need their own decision.
	{ why: "decision: other product names", find: /\bTenki (Code Reviewer|Runners?|runners?|runner label|Cloud|Mobile|Team|blog)\b/g },
];
