import { task } from "@trigger.dev/sdk";
import { createSandbox, runCommand } from "../tenki.mjs";

// Runs an untrusted command in a Tenki microVM instead of on the Trigger.dev worker.
export const runInSandbox = task({
  id: "run-in-sandbox",
  maxDuration: 600, // seconds of compute for this run
  retry: { maxAttempts: 2 }, // a retried attempt boots a fresh sandbox
  run: async (payload: { command: string }) => {
    const sandbox = await createSandbox();
    try {
      return await runCommand(sandbox, payload.command);
    } finally {
      await sandbox.close();
    }
  },
});
