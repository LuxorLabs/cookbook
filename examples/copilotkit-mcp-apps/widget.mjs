/**
 * The MCP App itself: the HTML a host renders in the chat.
 *
 * No framework and no build step. The page loads the MCP Apps bridge from this
 * server (`/ext-apps.js`, copied out of node_modules) and talks to the host with
 * it: the host pushes the tool's arguments and result in, and the page calls
 * back out to the app-only tools — which is what makes this an app rather than
 * a rendered blob of JSON.
 */

const STYLE = `
:root { color-scheme: light; --line:#e5e8ed; --muted:#5b6573; --blue:#047bff; --navy:#000a15; }
* { box-sizing:border-box }
body { margin:0; font:14px/1.45 ui-sans-serif,system-ui,sans-serif; color:#0b1220 }
.card { border:1px solid var(--line); border-radius:12px; overflow:hidden; background:#fff }
header { display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line); background:#fbfcfe }
header b { font-size:13px } header .id { font-family:ui-monospace,monospace; font-size:11.5px; color:var(--muted) }
header .spacer { flex:1 }
.timings { display:flex; gap:6px; padding:10px 12px; font-family:ui-monospace,monospace; font-size:11.5px; color:var(--muted); flex-wrap:wrap }
.timings span { background:#f5f7fa; border:1px solid var(--line); border-radius:6px; padding:2px 7px }
pre { margin:0; font-family:ui-monospace,monospace; font-size:12.5px; white-space:pre-wrap; word-break:break-word }
.code { margin:0 12px; padding:10px 12px; background:#fcfdfe; border:1px solid var(--line); border-radius:8px; max-height:220px; overflow:auto }
.term { margin:12px; padding:10px 12px; background:var(--navy); color:#d5deea; border-radius:8px; max-height:260px; overflow:auto }
.term .ps1 { color:#5fb3ff } .term .err { color:#ff8f87 } .term .exit { font-size:11.5px; color:#5fd49a }
.term .exit.bad { color:#ff8f87 }
.term form { display:flex; gap:8px; margin-top:8px; border-top:1px solid #15283d; padding-top:8px }
.term input { flex:1; background:transparent; border:0; outline:none; color:#fff; font:inherit }
.row { display:flex; gap:8px; align-items:center; padding:0 12px 12px }
button { font:inherit; border:1px solid var(--line); background:#fff; border-radius:8px; padding:6px 11px; cursor:pointer }
button.primary { background:var(--blue); border-color:var(--blue); color:#fff }
button.danger { color:#d92d20 } button:disabled { opacity:.5; cursor:not-allowed }
iframe { width:100%; height:420px; border:0; display:block; background:#fff }
.urlbar { flex:1; min-width:0; font-family:ui-monospace,monospace; font-size:12px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
.err-box { margin:12px; padding:10px 12px; background:#fdecea; color:#7a1a12; border-radius:8px }
`;

const SCRIPT = `
// The bridge travels inside the page as bytes rather than a URL: the widget runs
// in the viewer's browser, which cannot reach this server's localhost, and a
// cross-origin script would need the host's CSP to allow this origin. A blob
// module needs neither, so the same app works local or hosted.
const bridgeBytes = Uint8Array.from(atob(BRIDGE_B64), (c) => c.charCodeAt(0));
const { App } = await import(URL.createObjectURL(new Blob([bridgeBytes], { type: "text/javascript" })));

const app = new App({ name: "Tenki sandbox", version: "1.0.0" }, {}, { autoResize: true });
const el = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
let data = null;

app.ontoolresult = (res) => {
	data = res?.structuredContent ?? {};
	render();
};
await app.connect();

/** Call one of the server's app-only tools, straight from the UI. */
async function callTool(name, args) {
	const res = await app.callServerTool({ name, arguments: args });
	if (res.isError) throw new Error(res.content?.find((c) => c.type === "text")?.text ?? "tool failed");
	return res.structuredContent ?? {};
}

function render() {
	if (!data) return;
	if (data.error) {
		el("#root").innerHTML = \`<div class="card"><header><b>Tenki</b></header><div class="err-box"><pre>\${esc(data.error)}</pre></div></div>\`;
		return;
	}
	el("#root").innerHTML = VIEW === "preview" ? previewHtml() : consoleHtml();
	wire();
}

function head(extra = "") {
	return \`<header><b>Tenki Sandbox</b><span class="id">\${esc(data.sandbox.name || data.sandbox.id)}</span>
	  <span class="id">\${data.sandbox.cpuCores} vCPU · \${Math.round(data.sandbox.memoryMb / 1024)} GB</span>
	  <span class="spacer"></span>\${extra}</header>\`;
}

function timings() {
	const t = data.timings ?? {};
	const boot = data.reused ? "reused" : \`\${t.bootMs} ms\`;
	return \`<div class="timings"><span>boot \${boot}</span><span>run \${t.runMs ?? t.serveMs ?? 0} ms</span>
	  \${data.run ? \`<span>exit \${data.run.exitCode}</span>\` : ""}</div>\`;
}

function consoleHtml() {
	const runs = (window.__runs ??= [data.run]);
	const lines = runs
		.map(
			(r) => \`<div><div><span class="ps1">$</span> \${esc(r.command)}</div>
			\${r.stdout ? \`<pre>\${esc(r.stdout)}</pre>\` : ""}\${r.stderr ? \`<pre class="err">\${esc(r.stderr)}</pre>\` : ""}
			<div class="exit \${r.exitCode === 0 ? "" : "bad"}">exit \${r.exitCode} · \${r.runMs} ms</div></div>\`,
		)
		.join("");
	const failed = runs[runs.length - 1].exitCode !== 0;
	return \`<div class="card">\${head()}\${timings()}
	  <pre class="code">\${esc(data.code)}</pre>
	  <div class="term" id="term">\${lines}
	    <form id="sh"><span class="ps1">$</span><input id="cmd" placeholder="run a command in this sandbox — ls, uname -a" autocomplete="off" spellcheck="false"></form>
	  </div>
	  <div class="row"><button class="primary" id="ask">✦ \${failed ? "Ask Copilot to fix it" : "Send output to Copilot"}</button>
	    <span class="spacer" style="flex:1"></span><button class="danger" id="kill">Destroy sandbox</button></div></div>\`;
}

function previewHtml() {
	return \`<div class="card">\${head()}\${timings()}
	  <div class="row" style="padding:0 12px 10px"><button id="reload">↻</button>
	    <span class="urlbar">\${esc(data.previewUrl)}</span><button id="open">Open ↗</button></div>
	  <iframe id="frame" src="\${esc(data.previewUrl)}" sandbox="allow-scripts allow-forms allow-same-origin"></iframe>
	  <div class="row" style="padding-top:12px"><span class="urlbar">\${esc(data.startCommand)}</span>
	    <button class="danger" id="kill">Destroy sandbox</button></div></div>\`;
}

function wire() {
	el("#kill")?.addEventListener("click", async (e) => {
		e.target.disabled = true;
		await callTool("sandbox_destroy", { sandbox_id: data.sandbox.id });
		e.target.textContent = "Destroyed";
	});
	el("#open")?.addEventListener("click", () => app.openLink({ url: data.previewUrl }));
	el("#reload")?.addEventListener("click", () => {
		el("#frame").src = data.previewUrl;
	});
	el("#sh")?.addEventListener("submit", async (e) => {
		e.preventDefault();
		const input = el("#cmd");
		const command = input.value.trim();
		if (!command) return;
		input.value = "";
		input.disabled = true;
		try {
			const res = await callTool("sandbox_exec", { sandbox_id: data.sandbox.id, command });
			window.__runs.push(res.run);
		} catch (err) {
			window.__runs.push({ command, stdout: "", stderr: String(err.message ?? err), exitCode: 1, runMs: 0 });
		}
		render();
		el("#cmd").focus();
	});
	el("#ask")?.addEventListener("click", () => {
		const last = window.__runs[window.__runs.length - 1];
		const text =
			last.exitCode === 0
				? \`Here is the output from Tenki sandbox \${data.sandbox.id}:\\n\\n\${last.stdout}\\n\\nWhat does it tell us?\`
				: \`\\\`\${last.command}\\\` failed in Tenki sandbox \${data.sandbox.id}:\\n\\n\${last.stderr}\\n\\nPlease fix it and run it again in the same sandbox (sandbox_id: \${data.sandbox.id}).\`;
		app.sendMessage({ role: "user", content: [{ type: "text", text }] });
	});
}
`;

/** The page for one view, with the view name and the bridge bundle baked in. */
export function widgetHtml(view, bridgeSource) {
	const bridge = Buffer.from(bridgeSource, "utf8").toString("base64");
	return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><style>${STYLE}</style></head>
<body><div id="root"></div>
<script type="module">const VIEW = ${JSON.stringify(view)};
const BRIDGE_B64 = "${bridge}";
${SCRIPT}
</script></body></html>`;
}
