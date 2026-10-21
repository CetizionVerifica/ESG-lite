/**
 * IN-1 · the one way a panel answers (layer rules 5 and 7). Every module's GET
 * route is `panelRoute(panelId, build, opts)`:
 *
 *   1. resolveScope (query → sites, period; 400 IN_VALIDATION, 404 IN_SITE_NOT_FOUND);
 *   2. `opts.kpi`: KPI tracking off → 200 `availability: 'kpi_off'`, data null (layer rule 1);
 *   3. the data stamp; If-None-Match equal to its ETag → 304, no body;
 *   4. the cached envelope for (panel, scope, extras, stamp), else `build(scope)` wrapped in
 *      PanelResponse<T>: period, sites, label, pending_not_in, stamp, links.
 *
 * `build` returns {data} for ok, or {availability, reason} with data null; it never sets
 * the envelope fields itself. `pending_not_in` is shared by every panel of a scope and stamp.
 */
import type { Response } from "express";
import type { ZodType } from "zod";
import type { Availability, PanelId } from "./contracts/enums";
import type { InsightsQuery } from "./contracts/schemas";
import type { PanelResponse, PendingNotIn } from "./contracts/panels";
import { cached, cacheKey, etagOf } from "./cache";
import type { InsightsRequest } from "./guard";
import { handle } from "./http";
import { resolveScope, type InsightsScope } from "./scope";
import { pendingNotIn } from "./sources/pending";
import { dataStamp } from "./sources/stamp";

export interface PanelBuild<T> {
  availability?: Availability;
  reason?: string;
  data?: T | null;
  links?: Record<string, string>;
}

export interface PanelOptions<Q extends InsightsQuery> {
  schema?: ZodType<Q>;
  /** Query fields beyond the common ones that change the answer (cache key). */
  extras?: (q: Q) => Record<string, unknown>;
  /** A KPI panel: answers kpi_off while KPI tracking is off. */
  kpi?: boolean;
}

/** Builds the envelope for a scope (also used by the cards engine to read other panels). */
export async function panelResponse<T, Q extends InsightsQuery>(
  panel: PanelId,
  scope: InsightsScope<Q>,
  build: (scope: InsightsScope<Q>) => Promise<PanelBuild<T>>,
  opts: PanelOptions<Q> = {},
): Promise<PanelResponse<T>> {
  const stamp = await dataStamp(scope as InsightsScope);
  const extras = opts.extras ? opts.extras(scope.query) : {};
  return cached(cacheKey(panel, scope as InsightsScope, extras, stamp), async () => {
    const b: PanelBuild<T> = opts.kpi && !scope.kpiOn ? { availability: "kpi_off", reason: "KPI tracking is off for this company." } : await build(scope);
    const availability = b.availability ?? "ok";
    const pending: PendingNotIn = await pendingNotIn(scope as InsightsScope, stamp);
    return {
      panel,
      availability,
      ...(b.reason ? { reason: b.reason } : {}),
      period: scope.period,
      sites: scope.sites,
      label: scope.label,
      data: availability === "ok" ? (b.data ?? null) : null,
      pending_not_in: pending,
      stamp,
      links: b.links ?? {},
    };
  });
}

/** An Express handler for a panel's GET route. */
export function panelRoute<T, Q extends InsightsQuery = InsightsQuery>(panel: PanelId, build: (scope: InsightsScope<Q>) => Promise<PanelBuild<T>>, opts: PanelOptions<Q> = {}) {
  return handle(panel, async (req, res: Response) => {
    const scope = await resolveScope<Q>(req as InsightsRequest, opts.schema);
    const stamp = await dataStamp(scope as InsightsScope);
    const etag = etagOf(stamp);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, no-cache");
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.json(await panelResponse(panel, scope, build, opts));
  });
}
