// Run commands and write a file in a Tenki sandbox through Pi Durable's env
// interface, pause the sandbox, and show the next call picks up where it left off.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { createTenkiEnv } from "./tenki-env.mjs";

const { session, connection, env, dispose } = await createTenkiEnv();
try {
	const info = await connection.info();
	console.log(`daemon up: pi-env ${info.version} on ${info.os}/${info.arch}`);

	let out = "";
	getOrThrow(await env.exec(["uname", "-sr"], { onOutput: (t) => (out += t) }, BACKGROUND_CONTEXT));
	console.log(`exec -> ${out.trim()}`);

	getOrThrow(await env.writeFile("notes.txt", "state the agent built up\n", BACKGROUND_CONTEXT));

	console.log("pausing (snapshot memory + disk, free the VM) ...");
	await session.pause();

	// Same env object: this read resumes the sandbox and respawns the daemon.
	const back = getOrThrow(await env.readTextFile("notes.txt", BACKGROUND_CONTEXT));
	console.log(`resumed -> ${back.trim()}`);
} finally {
	await dispose();
}
