/**
 * KPI-8 · history of a KPI value through the existing audit-log endpoint:
 * `GET /user/audit-logs?entity_type=kpi_value&entity_id=` (the record drawer's
 * History). The same tenant rules as `GET /kpi/values`: the value's company
 * must be the caller's (a Superadmin may read any), its site one of the
 * caller's (company-level values: every role of the company), someone else's
 * draft is hidden, and the company's KPI switch must be on. Anything else
 * answers 404 (403 KPI_TRACKING_OFF when the switch is off), never the rows.
 */
import { AppDataSource } from "../../config/data-source";
import { UserRole } from "../../types/type";
import { KpiError } from "../contracts/errors";
import { callerSites, kpiTrackingEnabled } from "../guard";
import { canSee } from "../values/service";
import { resolveUserCompanyId } from "../../utils/companyScope";

type Row = Record<string, any>;

/** Throws KPI_NOT_FOUND / KPI_TRACKING_OFF unless the caller may read value `id`'s history. */
export async function assertKpiValueHistory(user: { userId?: unknown; role?: unknown } | undefined, id: number): Promise<void> {
  const [v]: Row[] = await AppDataSource.query(`SELECT id, company_id, site_id, status, entered_by FROM kpi_value WHERE id = $1`, [id]);
  if (!v) throw new KpiError("KPI_NOT_FOUND");
  const userId = Number(user?.userId) || 0;
  const role = String(user?.role ?? "");
  const companyId = Number(v.company_id);
  if (role !== UserRole.SUPERADMIN) {
    const own = await resolveUserCompanyId(userId);
    const sites = await callerSites(userId, role, companyId);
    // Internal accounts may reach a company through a site of it, as kpiCompanyFor allows.
    if (own !== companyId && !(sites && sites.size)) throw new KpiError("KPI_NOT_FOUND");
    if (!canSee({ companyId, userId, role, sites }, v)) throw new KpiError("KPI_NOT_FOUND");
  }
  if (!(await kpiTrackingEnabled(companyId))) throw new KpiError("KPI_TRACKING_OFF");
}
