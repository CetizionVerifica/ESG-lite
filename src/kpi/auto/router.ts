/**
 * KPI-5 route, behind requireKpiTracking (01-contracts §3):
 *   POST /kpi/auto/refresh?year=   Manager, Admin, Superadmin (User → 403 KPI_FORBIDDEN)
 *     → {year, refreshed, unchanged, removed, locked, values, formulas: {written, unchanged, removed, locked}}
 *   `year` is a reporting year in the company's year type; `values` are the auto values of that year
 *   on the caller's sites after the refresh.
 * A Superadmin passes company_id.
 */
import { Router } from "express";
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { KpiError } from "../contracts/errors";
import { KpiAutoRefreshQuerySchema } from "../contracts/schemas";
import { kpiCaller, type KpiRequest } from "../guard";
import { handle, parse } from "../http";
import { kpiSettings } from "../setup/settings";
import { periodsFor } from "../values/period";
import { evidenceFor, toValueOut } from "../values/service";
import { refreshAuto } from "./refresh";

const REFRESHERS = new Set<string>([UserRole.MANAGER, UserRole.ADMIN, UserRole.SUPERADMIN]);

const router = Router();

router.post(
  "/auto/refresh",
  handle("auto refresh", async (req, res) => {
    const caller = kpiCaller(req as KpiRequest);
    if (!REFRESHERS.has(caller.role)) throw new KpiError("KPI_FORBIDDEN");
    const { year } = parse(KpiAutoRefreshQuerySchema, req.query ?? {});
    const r = await refreshAuto(caller.companyId, year);
    const m = AppDataSource.manager;
    const yr = periodsFor("annual", (await kpiSettings(m, caller.companyId)).year_type, year)[0];
    const rows = await m.query(
      `SELECT v.*, d.code AS kpi_code, d.canonical_unit FROM kpi_value v JOIN kpi_definition d ON d.id = v.kpi_definition_id
        WHERE v.company_id = $1 AND v.source = 'auto' AND v.period_start >= $2 AND v.period_end <= $3
          AND ($4::int[] IS NULL OR v.site_id IS NULL OR v.site_id = ANY($4::int[]))
        ORDER BY d.code, v.site_id NULLS FIRST, v.period_start`,
      [caller.companyId, yr.start, yr.end, caller.sites ? [...caller.sites] : null],
    );
    const ev = await evidenceFor(m, rows.map((x: { id: number }) => Number(x.id)));
    res.json({
      year,
      refreshed: r.refreshed,
      unchanged: r.unchanged,
      removed: r.removed,
      locked: r.locked,
      values: rows.map((x: Record<string, unknown>) => toValueOut(x, ev.get(Number(x.id)))),
      formulas: { written: r.formulas.written, unchanged: r.formulas.unchanged, removed: r.formulas.removed, locked: r.formulas.locked },
    });
  }),
);

export default router;
