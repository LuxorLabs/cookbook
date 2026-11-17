import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const py = existsSync(".venv/bin/python") ? ".venv/bin/python" : process.env.PYTHON || "python3";
const r = spawnSync(py, ["verify.py"], { stdio: "inherit" });
process.exit(r.status ?? 1);
