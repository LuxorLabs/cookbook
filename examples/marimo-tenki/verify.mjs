/**
 * Shim so the cookbook's Node verify harness can run this Python example.
 * Runs verify.py with the example's local venv if present, else `python3`.
 * Setup (Python 3.10+): `uv venv && uv pip install -r requirements.txt` (see README).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const py = existsSync(".venv/bin/python") ? ".venv/bin/python" : process.env.PYTHON || "python3";
const r = spawnSync(py, ["verify.py"], { stdio: "inherit" });
process.exit(r.status ?? 1);
