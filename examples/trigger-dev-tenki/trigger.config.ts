import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "<your project ref>", // from your Trigger.dev project settings
  dirs: ["./src/trigger"],
  maxDuration: 3600,
});
