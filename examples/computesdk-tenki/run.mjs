// Run code on Tenki through ComputeSDK — one provider interface, swappable backends.
// The official @computesdk/tenki provider drives Tenki microVMs under the hood.
import { compute } from "computesdk";
import { tenki } from "@computesdk/tenki";

// The provider also reads TENKI_API_KEY / TENKI_AUTH_TOKEN from the environment.
compute.setConfig({ provider: tenki({ apiKey: process.env.TENKI_API_KEY }) });

const sandbox = await compute.sandbox.create();
try {
	// runCommand wraps the command in `sh -lc`, so pipes, globs, and env expansion work.
	const hello = await sandbox.runCommand('echo "Hello from $(uname -sr)"');
	console.log(hello.stdout.trim());

	// Native filesystem API — files move over Tenki's data plane, not through shell quoting.
	await sandbox.filesystem.writeFile("/home/tenki/app.py", 'print(6 * 7)\n');
	const result = await sandbox.runCommand("python3 /home/tenki/app.py");
	console.log(result.stdout.trim()); // 42
} finally {
	await sandbox.destroy();
}
