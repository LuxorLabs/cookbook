// A scripted brain that makes the same moves a model would on one kind of prompt, "Count the
// primes in [a, b)", with no model key. Every agent splits its range into 4 equal parts until
// the bottom level; each of the 64 bottom agents runs a segmented sieve in its sandbox, and
// every agent above runs the sum of its sub-agents' counts in its own. verify.mjs uses it so
// CI checks the sandbox half with a known answer: 664,579 primes below 10,000,000.
const RANGE = /\[\s*([\d_,]+)\s*,\s*([\d_,]+)\s*\)/;
const num = (s) => Number(s.replace(/[_,]/g, ""));
const parse = (prompt) => {
	const m = prompt.match(RANGE);
	if (!m) throw new Error(`the scripted brain only answers "Count the primes in [a, b)", not: ${prompt}`);
	return [num(m[1]), num(m[2])];
};
const think = () => new Promise((f) => setTimeout(f, 300 + Math.random() * 500)); // stands in for model latency

const SIEVE = (a, b) => `from math import isqrt
a, b = ${a}, ${b}
small = bytearray([1]) * (isqrt(b) + 1)
small[:2] = b"\\0\\0"
for i in range(2, isqrt(isqrt(b)) + 1):
    if small[i]:
        small[i * i :: i] = bytearray(len(small[i * i :: i]))
seg = bytearray([1]) * (b - a)
for p in (i for i, v in enumerate(small) if v):
    start = max(p * p, (a + p - 1) // p * p)
    seg[start - a :: p] = bytearray(len(seg[start - a :: p]))
for n in range(a, min(b, 2)):
    seg[n - a] = 0
print(sum(seg))
`;

export const scriptedBrain = {
	name: "scripted brain (no model)",
	async split({ prompt, fanout }) {
		await think();
		const [a, b] = parse(prompt);
		const cut = (i) => a + Math.round(((b - a) * i) / fanout);
		return Array.from({ length: fanout }, (_, i) => ({ title: `[${cut(i).toLocaleString("en-US")}, ${cut(i + 1).toLocaleString("en-US")})`, prompt: `Count the primes in [${cut(i)}, ${cut(i + 1)}).` }));
	},
	async step({ prompt, results, transcript }) {
		await think();
		if (transcript.length) return { answer: transcript.at(-1).output.split("\n")[1].trim() };
		if (results.length) return { run: `print(sum([${results.map((r) => Number(r.answer)).join(", ")}]))\n` };
		return { run: SIEVE(...parse(prompt)) };
	},
};
