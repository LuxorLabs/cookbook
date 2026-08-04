// Run code on Tenki through ComputeSDK — one provider interface, swappable backends.
import { compute } from "computesdk";
import { tenki } from "@computesdk/tenki";

compute.setConfig({ provider: tenki({ apiKey: process.env.TENKI_API_KEY }) });

const sandbox = await compute.sandbox.create();
try {
	// runCommand goes through `sh -lc`, so shell syntax works.
	const hello = await sandbox.runCommand('echo "Hello from $(uname -sr)"');
	console.log(hello.stdout.trim());

	await sandbox.filesystem.writeFile("/home/tenki/app.py", 'print(6 * 7)\n');
	const result = await sandbox.runCommand("python3 /home/tenki/app.py");
	console.log(result.stdout.trim()); // 42
} finally {
	await sandbox.destroy();
}
