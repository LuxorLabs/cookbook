/**
 * Shim so the cookbook's Node verify harness can run this Python benchmark.
 * Runs verify.py with the example's local venv if present, else `python3`.
 * Setup (Python 3.10+): `uv venv && uv pip install -r requirements.txt` (see README).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const py = existsSync(".venv/bin/python") ? ".venv/bin/python" : process.env.PYTHON || "python3";
const child = spawn(py, ["verify.py"], { stdio: "inherit" });
// Pass Ctrl-C / SIGTERM to verify.py and wait for it: it terminates its sandbox
// on the way out, and exiting first would orphan it.
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on("error", (e) => { console.error(`✗ ${e.message}`); process.exit(1); });
