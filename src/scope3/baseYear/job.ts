// S3-14 nightly base-year check: compares every frozen Scope 3 base year with
// today's rows and keeps one open recalculation proposal per company.
// Runs at 02:40 server time; logs counts only.
import cron from "node-cron";
import { checkAllCompanies } from "./service";

let started = false;

export function startBaseYearScheduler() {
  if (started || process.env.SCOPE3_BASE_YEAR_JOB === "off") return;
  started = true;
  cron.schedule("40 2 * * *", async () => {
    try {
      const counts = await checkAllCompanies();
      console.log("[scope3] nightly base-year check:", JSON.stringify(counts));
    } catch (err) {
      console.error("[scope3] nightly base-year check failed:", (err as any)?.code ?? (err as Error)?.message);
    }
  });
}
