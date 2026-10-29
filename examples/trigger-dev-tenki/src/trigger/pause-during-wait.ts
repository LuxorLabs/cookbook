import { task, wait } from "@trigger.dev/sdk";
import { createSandbox, pauseSandbox, resumeSandbox, runCommand } from "../tenki.mjs";

// Build state in a sandbox, wait an hour for something external, then continue in the same sandbox.
// The Trigger.dev run is checkpointed during wait.for(); pausing the sandbox stops Tenki billing too.
export const pauseDuringWait = task({
  id: "pause-during-wait",
  run: async (payload: { setup: string; after: string }) => {
    // Keep the paused sandbox longer than the wait.
    let sandbox = await createSandbox({ pauseRetentionMs: 2 * 60 * 60_000 });
    try {
      await runCommand(sandbox, payload.setup);

      const id = await pauseSandbox(sandbox);
      await wait.for({ hours: 1 });
      sandbox = await resumeSandbox(id);

      return await runCommand(sandbox, payload.after);
    } finally {
      await sandbox.close();
    }
  },
});
