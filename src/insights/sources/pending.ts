/**
 * IN-1 · what isn't in the figures yet (layer rule 3, KPI D14): every panel's
 * `pending_not_in`, from the same counts the source pages show:
 *   emissions   Overview's `kpis.pending_review_count` for the period and sites (the
 *               approvals list's count: FERA twins fold into their entry)
 *   kpi_values  /kpi/esg's `pending_not_in.count` (KPI on and set up; else 0)
 *   link        the approvals queue when anything waits, else null
 * Cached per (scope, stamp), so the panels of one page compute it once.
 */
import type { PendingNotIn } from "../contracts/panels";
import { cached, cacheKey } from "../cache";
import type { InsightsScope } from "../scope";
import { pendingCount } from "./emissions";
import { esg } from "./kpi";

export const APPROVALS_LINK = "/data/approvals";

export const pendingNotIn = (scope: InsightsScope, stamp: string): Promise<PendingNotIn> =>
  cached(cacheKey("pending_not_in", scope, {}, stamp), async () => {
    const emissions = await pendingCount(scope);
    const kpi_values = scope.kpiOn ? ((await esg(scope))?.pending_not_in.count ?? 0) : 0;
    return { emissions, kpi_values, link: emissions + kpi_values > 0 ? (kpi_values && !emissions ? `${APPROVALS_LINK}?view=kpi` : APPROVALS_LINK) : null };
  });
