/**
 * IN-0 · what happens when a Superadmin flips `company.insights_enabled`
 * (PUT /admin/companies/:id): an audit_log row (`insights`, action `switch`) in
 * the same transaction as the change, as the KPI and Design Studio switches do
 * (src/kpi/switch.ts, src/studio/switch.ts). Turning it off keeps every
 * Insights row (events, AI log); nothing is sent to anyone (I2 names no
 * notification).
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../config/data-source";

export const IN_AUDIT_ENTITY = "insights";

export const currentInsightsSwitch = async (companyId: number): Promise<boolean | null> => {
  const rows: Array<{ on: boolean }> = await AppDataSource.query(`SELECT insights_enabled AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return rows.length ? rows[0].on === true : null;
};

export const auditInsightsSwitch = (m: EntityManager, companyId: number, oldValue: boolean, newValue: boolean, actorId: number | null) =>
  m.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, 'switch', $3, NULL, $4)`,
    [IN_AUDIT_ENTITY, companyId, JSON.stringify({ insights_enabled: { old: oldValue, new: newValue } }), actorId],
  );
