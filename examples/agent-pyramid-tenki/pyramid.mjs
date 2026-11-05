// A recursive agent pyramid on Tenki. Every agent runs the same loop:
//   1. Take a prompt. Either answer it, or split it into up to 4 self-contained sub-prompts.
//   2. Hand each sub-prompt to a sub-agent, which runs this same loop, all in parallel.
//   3. Combine the sub-agents' answers into an answer to its own prompt.
// Any agent can run Python while it answers, in a sandbox of its own that boots on its first
// run and is terminated when the agent finishes. Three levels of splitting by 4 is
// 1 + 4 + 16 + 64 = 85 agents.
import { stdoutText, stderrText } from "@tenkicloud/sandbox";

const tail = (s, n = 1500) => (s.length > n ? "…" + s.slice(-n) : s);

/**
 * Run a prompt through the pyramid. `brain` decides whether to split (`split`) and takes one
 * step at a time towards an answer (`step`); `emit` receives every state change, which is what
 * the 3D viewer draws. Returns the root node: { id, title, prompt, answer, children, runs }.
 */
export async function runPyramid({ tenki, brain, prompt, fanout = 4, depth = 3, maxRuns = 4, workspaceId, emit = () => {} }) {
	const say = (id, patch) => emit({ id, t: Date.now(), ...patch });

	async function agent(id, title, prompt, level) {
		say(id, { title, detail: prompt, level, state: "thinking" });
		let sandbox; // booted on the first run, so agents that only delegate never take one
		const node = { id, title, prompt, children: [], runs: 0, answer: "" };
		try {
			// 1. Split, unless this is the bottom of the pyramid.
			const subtasks = level < depth ? (await brain.split({ prompt, level, depth, fanout })).slice(0, fanout) : [];
			if (subtasks.length) {
				subtasks.forEach((s, i) => say(`${id}.${i}`, { title: s.title, detail: s.prompt, level: level + 1, state: "waiting" }));
				say(id, { state: "waiting", detail: `${prompt}\n\nwaiting on ${subtasks.length} sub-agents` });
				// 2. Sub-agents work in parallel. A failed one reports its error as its answer.
				node.children = await Promise.all(
					subtasks.map((s, i) => agent(`${id}.${i}`, s.title, s.prompt, level + 1).catch((e) => ({ id: `${id}.${i}`, title: s.title, answer: `FAILED: ${e?.message ?? e}`, children: [], runs: 0 }))),
				);
				say(id, { state: "thinking", detail: `combining ${subtasks.length} answers` });
			}
			// 3. Answer, running code in the sandbox as often as the brain asks, up to maxRuns.
			const results = node.children.map((c) => ({ title: c.title, answer: c.answer }));
			const transcript = [];
			for (;;) {
				const step = await brain.step({ prompt, results, transcript, runsLeft: maxRuns - node.runs });
				if (step.answer !== undefined || node.runs >= maxRuns) {
					node.answer = String(step.answer ?? "no answer within the run limit");
					say(id, { state: "passed", answer: node.answer });
					return node;
				}
				if (!sandbox) {
					say(id, { box: "booting" });
					sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId, tags: ["agent-pyramid"], metadata: { agent: id } });
					say(id, { box: "ready", sandboxId: sandbox.id });
				}
				node.runs++;
				say(id, { state: "running", code: step.run, run: node.runs });
				await sandbox.writeFile("/home/tenki/step.py", step.run);
				const r = await sandbox.exec(["python3", "/home/tenki/step.py"], { timeoutMs: 120_000 });
				const output = `exit ${r.exitCode}\n${tail(stdoutText(r))}${stderrText(r) ? `\nstderr:\n${tail(stderrText(r))}` : ""}`;
				transcript.push({ run: step.run, output });
				say(id, { state: "thinking", output });
			}
		} catch (e) {
			say(id, { state: "failed", detail: String(e?.message ?? e) });
			throw e;
		} finally {
			if (sandbox) {
				await sandbox[Symbol.asyncDispose]().catch(() => {});
				say(id, { box: "gone" });
			}
		}
	}

	return agent("r", "root", prompt, 0);
}

/** A brain backed by any OpenAI-compatible chat completions endpoint. */
export function llmBrain({ apiKey, baseURL, model }) {
	const chat = async (messages) => {
		for (let i = 0; ; i++) {
			const r = await fetch(`${baseURL}/chat/completions`, {
				method: "POST",
				headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
				body: JSON.stringify({ model, response_format: { type: "json_object" }, messages }),
			});
			if (r.ok) {
				const text = (await r.json()).choices?.[0]?.message?.content ?? "";
				try {
					return JSON.parse(text.replace(/^\s*```(?:json)?|```\s*$/g, ""));
				} catch {
					if (i >= 2) throw new Error(`model returned non-JSON: ${text.slice(0, 200)}`);
				}
			} else if (i >= 3 || (r.status !== 429 && r.status < 500)) throw new Error(`model ${r.status}: ${(await r.text()).slice(0, 300)}`);
			await new Promise((f) => setTimeout(f, 2000 * (i + 1)));
		}
	};
	const system = (fanout) =>
		`You are one agent in a pyramid of agents. Each agent gets a prompt and either answers it itself or splits it into up to ${fanout} smaller, ` +
		`self-contained prompts for sub-agents, which work in parallel, can split again, and report back. You have a private Linux sandbox with ` +
		`Python 3.12 (standard library only) for calculations and checks. Reply with JSON only.`;
	return {
		name: `model ${model}`,
		split: async ({ prompt, level, depth, fanout }) =>
			(await chat([
				{ role: "system", content: system(fanout) },
				{
					role: "user",
					content:
						`You are at level ${level} of ${depth}. Your prompt:\n${prompt}\n\n` +
						`If it divides into 2 to ${fanout} independent parts that are each worth an agent, reply {"subtasks":[{"title":"2 to 4 words","prompt":"a complete, self-contained prompt"}]}. ` +
						`Sub-agents see only their own prompt, so include every detail they need. If it is small enough to answer well yourself, reply {"subtasks":[]}.`,
				},
			])).subtasks ?? [],
		step: ({ prompt, results, transcript, runsLeft }) =>
			chat([
				{ role: "system", content: system(4) },
				{
					role: "user",
					content:
						`Your prompt:\n${prompt}\n\n` +
						(results.length ? `Your sub-agents answered:\n${results.map((r, i) => `${i + 1}. ${r.title}:\n${tail(r.answer, 2000)}`).join("\n\n")}\n\nCombine their answers into one answer to your prompt.\n\n` : "") +
						`To run Python in your sandbox, reply {"run":"the code"} and you will see its output (${runsLeft} runs left). When you are done, reply {"answer":"your complete answer"}.`,
				},
				...transcript.flatMap((t) => [
					{ role: "assistant", content: JSON.stringify({ run: t.run }) },
					{ role: "user", content: `Output:\n${t.output}` },
				]),
			]),
	};
}

/** The brain the scripts pick: --offline or no key gives the scripted one, otherwise a model. */
export async function pickBrain({ offline = false } = {}) {
	const env = process.env;
	if (!offline && env.OPENAI_API_KEY) return llmBrain({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL || "https://api.openai.com/v1", model: env.MODEL || "gpt-4.1-mini" });
	if (!offline && env.OPENROUTER_API_KEY) return llmBrain({ apiKey: env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1", model: env.MODEL || "openai/gpt-4.1-mini" });
	return (await import("./scripted.mjs")).scriptedBrain;
}
