/**
 * KPI-1 · what happens when a Superadmin flips `company.kpi_tracking_enabled`
 * (PUT /admin/companies/:id): an audit_log row (`kpi_setup`, action `switch`)
 * and, when it goes on, a `kpi_enabled` notification to the company's Admins
 * ("KPI tracking is ready: set it up", link /kpi/setup). Turning it off keeps
 * every KPI row (D3).
 */
import { AppDataSource } from "../config/data-source";
import { createNotification } from "../services/notificationService";

export const KPI_ENABLED_NOTIFICATION = {
  type: "kpi_enabled",
  title: "KPI tracking is ready: set it up",
  message: "Your organisation can now track ESG KPIs for GRI, BRSR and CSRD (ESRS). Choose frameworks and KPIs in KPI setup.",
  link: "/kpi/setup",
} as const;

/** Admins with a site (own or through user_sites) at the company. */
export const companyAdminIds = async (companyId: number): Promise<number[]> => {
  const rows: Array<{ user_id: number }> = await AppDataSource.query(
    `SELECT DISTINCT u.user_id FROM "user" u
       LEFT JOIN site s ON s.site_id = u.site_id
       LEFT JOIN user_sites us ON us.user_id = u.user_id
       LEFT JOIN site s2 ON s2.site_id = us.site_id
      WHERE u.role = 'Admin' AND (s.company_id = $1 OR s2.company_id = $1)
      ORDER BY u.user_id`,
    [companyId],
  );
  return rows.map((r) => Number(r.user_id));
};

export const currentKpiSwitch = async (companyId: number): Promise<boolean | null> => {
  const rows: Array<{ on: boolean }> = await AppDataSource.query(`SELECT kpi_tracking_enabled AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return rows.length ? rows[0].on === true : null;
};

/** After the switch changed: audit always; notify Admins when it went on. Never throws for the notification. */
export const kpiSwitchChanged = async (companyId: number, oldValue: boolean, newValue: boolean, actorId: number | null): Promise<void> => {
  await AppDataSource.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ('kpi_setup', $1, 'switch', $2, NULL, $3)`,
    [companyId, JSON.stringify({ kpi_tracking_enabled: { old: oldValue, new: newValue } }), actorId],
  );
  if (!newValue) return;
  for (const userId of await companyAdminIds(companyId)) {
    try {
      const n = KPI_ENABLED_NOTIFICATION;
      await createNotification(userId, n.type, n.title, n.message, n.link);
    } catch (err) {
      console.error(`[kpi] kpi_enabled notification failed (company ${companyId}, user ${userId}):`, (err as Error)?.message);
    }
  }
};
