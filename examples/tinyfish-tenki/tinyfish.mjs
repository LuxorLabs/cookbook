// Runs inside the sandbox. TinyFish runs the browser; this VM runs the code.
import { TinyFish } from "@tiny-fish/sdk";
import { chromium } from "playwright-core";

const client = new TinyFish(); // reads TINYFISH_API_KEY
const url = process.argv[2] ?? "https://example.com";

// The SDK has no close method, so end the session with TinyFish's DELETE endpoint. TinyFish says a
// 409, 500, 503 or 504 means termination wasn't confirmed and to retry; on 429 or 503, wait for Retry-After.
// A network error or a request with no response in 15 seconds is retried too.
async function endSession(id) {
	for (let attempt = 1; ; attempt++) {
		let res, failure;
		try {
			res = await fetch(`https://api.browser.tinyfish.ai/${id}`, {
				method: "DELETE",
				headers: { "X-API-Key": process.env.TINYFISH_API_KEY },
				signal: AbortSignal.timeout(15_000),
			});
			if (res.ok) return;
			failure = `HTTP ${res.status}`;
		} catch (err) {
			failure = err.cause?.message ?? err.message;
		}
		if ((res && ![409, 429, 500, 503, 504].includes(res.status)) || attempt === 3) {
			throw new Error(`TinyFish browser session ${id} not confirmed ended: ${failure}`);
		}
		const wait = Math.min(Number(res?.headers.get("retry-after")) || attempt, 30);
		await new Promise((resolve) => setTimeout(resolve, wait * 1000));
	}
}

const fetched = await client.fetch.getContents({ urls: [url], format: "markdown" });
console.log("fetch:", fetched.results[0]?.title);

const found = await client.search.query({ query: "remote browser for AI agents" });
console.log("search:", found.results.slice(0, 3).map((r) => r.url).join(" "));

// timeout_seconds caps how long an idle session lives if cleanup never runs.
const session = await client.browser.sessions.create({ timeout_seconds: 120 });
let browser;
try {
	browser = await chromium.connectOverCDP(session.cdp_url);
	const context = browser.contexts()[0] ?? (await browser.newContext());
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto(url);
	console.log("browser:", await page.title());
} finally {
	await browser?.close();
	await endSession(session.session_id);
}
