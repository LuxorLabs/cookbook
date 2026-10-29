import { logger, schedules } from "@trigger.dev/sdk"

import { stopIdleSandboxes } from "@/lib/tenki"

// Tenki does not stop idle sandboxes by itself, so this pauses every bot
// sandbox that has been idle for 15 minutes.
// A paused sandbox is not billed and resumes on its bot's next tool call.
export const pauseIdleSandboxes = schedules.task({
  id: "pause-idle-sandboxes",
  cron: "*/5 * * * *",
  maxDuration: 240,
  run: async () => {
    const paused = await stopIdleSandboxes(15)
    logger.info("Idle sandboxes paused", { count: paused.length, ids: paused })
  },
})
