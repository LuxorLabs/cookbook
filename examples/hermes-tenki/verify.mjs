/**
 * Shim so the cookbook's Node verify harness can run this Python example.
 * Fetches the pinned Hermes checkout if it's missing, then runs verify.py with
 * the example's .venv if present, else `python3`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (!existsSync("hermes-agent/tools/environments/tenki.py")) {
	const setup = spawnSync("bash", ["setup.sh"], { stdio: "inherit" });
	if (setup.status !== 0) process.exit(setup.status ?? 1);
}
const py = existsSync(".venv/bin/python") ? ".venv/bin/python" : process.env.PYTHON || "python3";
const r = spawnSync(py, ["verify.py"], { stdio: "inherit" });
process.exit(r.status ?? 1);
