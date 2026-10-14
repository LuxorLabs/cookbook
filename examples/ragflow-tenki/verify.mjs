/**
 * Shim so the cookbook's Node verify harness can run this Go example.
 * RAGFlow's Tenki provider is Go-only, so the proof uses the same Go SDK
 * module and version RAGFlow pins (see go.mod). Needs Go 1.25.3+ on PATH;
 * an older Go downloads the right toolchain automatically (GOTOOLCHAIN=auto).
 */
import { spawnSync } from "node:child_process";

const r = spawnSync("go", ["run", "."], { stdio: "inherit" });
if (r.error) console.error(`✗ could not run go: ${r.error.message}`);
process.exit(r.status ?? 1);
