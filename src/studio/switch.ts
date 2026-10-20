/**
 * DS-0 · what happens when a Superadmin flips `company.design_studio_enabled`
 * (PUT /admin/companies/:id): an audit_log row (`design_studio`, action
 * `switch`) in the same transaction as the change, as the KPI switch does
 * (src/kpi/switch.ts). Turning it off keeps every studio row; nothing is sent
 * to anyone (D4 names no notification).
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../config/data-source";

export const DS_AUDIT_ENTITY = "design_studio";

export const currentStudioSwitch = async (companyId: number): Promise<boolean | null> => {
  const rows: Array<{ on: boolean }> = await AppDataSource.query(`SELECT design_studio_enabled AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return rows.length ? rows[0].on === true : null;
};

export const auditStudioSwitch = (m: EntityManager, companyId: number, oldValue: boolean, newValue: boolean, actorId: number | null) =>
  m.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, 'switch', $3, NULL, $4)`,
    [DS_AUDIT_ENTITY, companyId, JSON.stringify({ design_studio_enabled: { old: oldValue, new: newValue } }), actorId],
  );
