/**
 * Shim so the cookbook's Node verify harness can run this Python example.
 * Runs verify.py with the example's local venv if present, else `python3`.
 * Setup (Python 3.10+): `uv venv && uv pip install -r requirements.txt` (see README).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

// Resolve against this file, not the caller's cwd, so the harness can run it from anywhere.
const dir = import.meta.dirname;
const venv = `${dir}/.venv/bin/python`;
const py = existsSync(venv) ? venv : process.env.PYTHON || "python3";
const r = spawnSync(py, ["verify.py"], { cwd: dir, stdio: "inherit" });
if (r.error) console.error(`Couldn't start ${py}: ${r.error.message}`);
if (r.signal) console.error(`verify.py was killed by ${r.signal}`);
process.exit(r.status ?? 1);
