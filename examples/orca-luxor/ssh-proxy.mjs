// ssh(1) ProxyCommand: bridges stdio <-> a Luxor sandbox's SSH WebSocket transport.
// Luxor Agent Cloud carries SSH over ws(s)://.../v1/ssh/<id>, so a stock ssh client needs this shim.
import { LuxorSandbox } from "@luxorai/sandbox";

const sessionId = process.argv[2];
const luxor = new LuxorSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });
const conn = await luxor.ssh(sessionId);

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
