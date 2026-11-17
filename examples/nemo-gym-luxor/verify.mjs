/**
 * Shim so the cookbook's Node verify harness can run this Python example.
 *
 * NeMo Gym 0.7.0 needs Python 3.13.14+ and a large dependency tree, so this example
 * doesn't use the shared interpreter CI gives the other Python examples. `uv sync`
 * builds its own .venv from pyproject.toml and uv.lock, fetching Python 3.13 if needed.
 */
import { spawnSync } from "node:child_process";

const run = (cmd, args) => spawnSync(cmd, args, { stdio: "inherit" }).status;
// Use uv from PATH, or install it into the current Python and run it as a module.
let uv = ["uv"];
if (spawnSync("uv", ["--version"]).status !== 0) {
	const py = process.env.PYTHON || "python3";
	if (run(py, ["-m", "pip", "install", "--quiet", "uv"]) !== 0) process.exit(1);
	uv = [py, "-m", "uv"];
}
const [cmd, ...pre] = uv;
if (run(cmd, [...pre, "sync", "--quiet", "--locked"]) !== 0) process.exit(1);
process.exit(run(".venv/bin/python", ["verify.py"]) ?? 1);
