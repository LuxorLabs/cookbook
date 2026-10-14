"use client";

import { CopilotChat, useConfigureSuggestions } from "@copilotkit/react-core/v2";

export default function Page() {
	useConfigureSuggestions({
		available: "before-first-message",
		suggestions: [
			{ title: "Prove it's a real machine", message: "Show me this sandbox is real: run uname -a, nproc, free -m and df -h /, then summarize the machine in one line." },
			{ title: "Run code", message: "Estimate pi with a Monte Carlo simulation at 1k, 10k and 1M samples, and print the convergence as an ASCII bar chart." },
			{ title: "Ship a web app", message: "Build a polished Pomodoro timer with start/pause/reset and a progress ring, and serve it." },
		],
	});

	return (
		<main className="shell">
			<header>
				<b>MCP Apps</b> on Tenki sandboxes — tools that bring their own UI
			</header>
			<CopilotChat agentId="default" className="chat" labels={{ chatInputPlaceholder: "Ask for anything that needs a computer…" }} />
		</main>
	);
}
