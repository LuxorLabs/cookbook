import { defineApp } from "convex/server";
import tenki from "@luxorai/convex/convex.config.js";

const app = defineApp();
app.use(tenki);

export default app;
