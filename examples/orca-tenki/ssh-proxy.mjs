// An ssh ProxyCommand: ssh runs this script and talks through its input and output
// instead of opening a network connection itself. Tenki carries SSH over a WebSocket
// (ws(s)://.../v1/ssh/<id>), so this script relays bytes between ssh and that WebSocket.
import { TenkiSandbox } from "@tenkicloud/sandbox";

const sessionId = process.argv[2];
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });
const conn = await tenki.ssh(sessionId);

// Send chunks one at a time, in order: conn.write is async, and ssh breaks if bytes arrive out of order.
let tail = Promise.resolve();
process.stdin.on("data", (c) => { tail = tail.then(() => conn.write(new Uint8Array(c))).catch(() => {}); });
process.stdin.on("end", () => { tail.then(() => conn.close()); });

for (;;) {
	const data = await conn.read();
	if (data === null) break;
	process.stdout.write(Buffer.from(data));
}
process.exit(0);
