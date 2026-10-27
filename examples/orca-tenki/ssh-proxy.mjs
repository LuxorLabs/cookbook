// ssh(1) ProxyCommand: bridges stdio <-> a Tenki sandbox's SSH WebSocket transport.
// Tenki carries SSH over ws(s)://.../v1/ssh/<id>, so a stock ssh client needs this shim.
import { TenkiSandbox } from "@tenkicloud/sandbox";

const sessionId = process.argv[2];
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });
const conn = await tenki.ssh(sessionId);

// Serialize writes; conn.write is async and ssh will not tolerate reordered bytes.
let tail = Promise.resolve();
process.stdin.on("data", (c) => { tail = tail.then(() => conn.write(new Uint8Array(c))).catch(() => {}); });
process.stdin.on("end", () => { tail.then(() => conn.close()); });

for (;;) {
	const data = await conn.read();
	if (data === null) break;
	process.stdout.write(Buffer.from(data));
}
process.exit(0);
