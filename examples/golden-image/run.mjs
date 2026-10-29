// Build a toolchain once on a builder sandbox, snapshot it, and start every later sandbox
// from that snapshot. The restore takes seconds; the install happened once.
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });
const workspaceId = process.env.TENKI_WORKSPACE_ID;

let snapshot;
try {
	// 1. The builder. Make it the SMALLEST machine you will ever restore the image onto: a
	//    restored sandbox never comes up smaller than the snapshot it restores (see README).
	{
		await using builder = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, workspaceId });

		// The "install". Stands in for apt-get, npm install -g, a language runtime, a CLI agent.
		await builder.exec(["sh", "-c", 'mkdir -p ~/.local/bin && printf \'#!/bin/sh\\necho hello from the golden image\\n\' > ~/.local/bin/hello && chmod +x ~/.local/bin/hello']);

		// 2. Snapshot it. The snapshot outlives the builder; the builder is disposed at the brace.
		snapshot = await tenki.createSnapshotAndWait(builder.id, {
			name: "golden-example",
			expiresAt: new Date(Date.now() + 60 * 60 * 1000), // keep yours for good: omit expiresAt
		});
		if (snapshot.state !== "READY") throw new Error(`snapshot is ${snapshot.state}`);
		console.log(`golden image ${snapshot.id} is ${snapshot.state}`);
	}

	// 3. Restore. A new sandbox, with a new id, that already has the tool installed.
	await using sandbox = await tenki.createAndWait({ snapshotId: snapshot.id, cpuCores: 1, memoryMb: 1024, workspaceId });
	const r = await sandbox.exec(["sh", "-lc", "~/.local/bin/hello"]);
	console.log(`restored -> ${stdoutText(r).trim()}`); // restored -> hello from the golden image
} finally {
	// This demo's snapshot only; a real golden image stays. Deleted even when a step above threw.
	if (snapshot) await tenki.deleteSnapshot(snapshot.id).catch(() => {}); // or it expires in an hour
}
