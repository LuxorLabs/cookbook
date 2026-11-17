// Runs inside the sandbox. Anchor runs the browser; this VM runs the Playwright client.
import { chromium } from "playwright-core"; // preinstalled in tenki/anchor under /home/tenki/node_modules

const apiKey = process.env.ANCHOR_API_KEY;
if (!apiKey) throw new Error("ANCHOR_API_KEY is required");
const url = process.argv[2] ?? "https://example.com";
const sessions = "https://api.anchorbrowser.io/v1/sessions";

// Set Anchor's two timers (in minutes) instead of relying on defaults: max_duration caps the
// session's lifetime, idle_timeout ends it once nothing has been connected to it for that long.
const response = await fetch(sessions, {
	method: "POST",
	headers: { "anchor-api-key": apiKey, "content-type": "application/json" },
	body: JSON.stringify({ session: { timeout: { max_duration: 5, idle_timeout: 1 } } }),
});
if (!response.ok) throw new Error(`Anchor returned HTTP ${response.status}: ${await response.text()}`);
const payload = await response.json();
const session = payload.data ?? payload;

let browser;
try {
	browser = await chromium.connectOverCDP(session.cdp_url);
	const context = browser.contexts()[0] ?? (await browser.newContext());
	const page = context.pages()[0] ?? (await context.newPage());
	await page.goto(url);
	console.log(JSON.stringify({ url: page.url(), title: await page.title() }));
} finally {
	// End the Anchor session even if closing the CDP connection throws.
	try {
		await browser?.close();
	} finally {
		const ended = await fetch(`${sessions}/${session.id}`, {
			method: "DELETE",
			headers: { "anchor-api-key": apiKey },
		});
		if (!ended.ok) throw new Error(`Anchor session ${session.id} not ended: HTTP ${ended.status}`);
	}
}
