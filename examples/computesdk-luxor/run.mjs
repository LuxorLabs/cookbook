// Run code on Luxor Agent Cloud through ComputeSDK — one provider interface, swappable backends.
import { compute } from "computesdk";
import { tenki } from "@computesdk/tenki";

compute.setConfig({ provider: tenki({ apiKey: process.env.LUXORAI_API_KEY || process.env.LUXORAI_AUTH_TOKEN || process.env.TENKI_API_KEY || process.env.TENKI_AUTH_TOKEN }) });

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
