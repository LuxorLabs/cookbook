// Runs inside the sandbox. TinyFish runs the browser; this VM runs the code.
import { TinyFish } from "@tiny-fish/sdk";
import { chromium } from "playwright-core";

const client = new TinyFish(); // reads TINYFISH_API_KEY
const url = process.argv[2] ?? "https://example.com";

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
	// The SDK has no close method, and a session keeps running until it's deleted or its inactivity timeout fires.
	await fetch(`https://api.browser.tinyfish.ai/${session.session_id}`, {
		method: "DELETE",
		headers: { "X-API-Key": process.env.TINYFISH_API_KEY },
	});
}
