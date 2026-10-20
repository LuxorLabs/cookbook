import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("reconcile tenki sandboxes", { minutes: 5 }, internal.maintenance.reconcile);

export default crons;
