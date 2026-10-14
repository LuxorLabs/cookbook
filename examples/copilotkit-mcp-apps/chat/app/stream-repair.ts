/**
 * Fetch wrapper for OpenAI-compatible relays that repairs streamed tool-call indexes.
 *
 * The AI SDK's chat-completions parser keeps tool calls in an array keyed by
 * `delta.tool_calls[].index` and assumes those indexes are dense and 0-based.
 * Relays in front of Anthropic models (Aisa, verified) forward Anthropic's
 * *content-block* index instead: when the model writes a sentence before the
 * tool call, the text is block 0 and the call arrives as `index: 1`. The array
 * then has a hole at 0 and the stream dies with
 * `Cannot read properties of undefined (reading 'hasFinished')`.
 *
 * Repair: renumber calls densely in order of first appearance (a delta that
 * carries an `id` opens a call). An id-less fragment at an index that never
 * opened a call is folded into the most recent call, which also covers relays
 * that label a call's closing fragment with the next index.
 */
type ToolDelta = { id?: string | null; index?: number };

export function repairChunk(json: string, state: { dense: Map<number, number>; last: number | null }): string {
	let chunk: any;
	try {
		chunk = JSON.parse(json);
	} catch {
		return json;
	}
	let touched = false;
	for (const choice of chunk?.choices ?? []) {
		const calls: ToolDelta[] | undefined = choice?.delta?.tool_calls;
		if (!Array.isArray(calls)) continue;
		for (const call of calls) {
			if (call.id === null) {
				delete call.id;
				touched = true;
			}
			const raw = typeof call.index === "number" ? call.index : null;
			if (raw === null) continue;
			let mapped = state.dense.get(raw);
			if (mapped === undefined && typeof call.id === "string" && call.id) {
				mapped = state.dense.size;
				state.dense.set(raw, mapped);
			}
			if (mapped === undefined) mapped = state.last ?? 0;
			state.last = mapped;
			if (mapped !== raw) {
				call.index = mapped;
				touched = true;
			}
		}
	}
	return touched ? JSON.stringify(chunk) : json;
}

function repairStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	const state = { dense: new Map<number, number>(), last: null as number | null };
	let buffer = "";
	const fix = (line: string) => {
		if (!line.startsWith("data:")) return line;
		const payload = line.slice(5).trimStart();
		if (!payload || payload === "[DONE]") return line;
		return `data: ${repairChunk(payload, state)}`;
	};
	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(bytes, controller) {
				buffer += decoder.decode(bytes, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? ""; // a partial line waits for the next read
				if (lines.length) controller.enqueue(encoder.encode(lines.map(fix).join("\n") + "\n"));
			},
			flush(controller) {
				buffer += decoder.decode();
				if (buffer) controller.enqueue(encoder.encode(fix(buffer)));
			},
		}),
	);
}

export const repairingFetch: typeof globalThis.fetch = async (input, init) => {
	const res = await fetch(input, init);
	if (!res.body || !(res.headers.get("content-type") || "").includes("text/event-stream")) return res;
	return new Response(repairStream(res.body), { status: res.status, statusText: res.statusText, headers: res.headers });
};
