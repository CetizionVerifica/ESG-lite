/**
 * AS-1 · the per-client switches `company.assistant_enabled`,
 * `company.assistant_files_enabled` and `company.assistant_data_enabled`
 * (default off, Superadmin only, through PUT /admin/companies/:id). Flipping one writes an audit_log row (`assistant`,
 * action `switch`) in the same transaction, as the Insights, KPI and Design
 * Studio switches do. Turning one off keeps the call log.
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../config/data-source";

export const AS_AUDIT_ENTITY = "assistant";

export const currentAssistantSwitch = async (companyId: number): Promise<boolean | null> => {
  const rows: Array<{ on: boolean }> = await AppDataSource.query(`SELECT assistant_enabled AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return rows.length ? rows[0].on === true : null;
};

export const currentAssistantFilesSwitch = async (companyId: number): Promise<boolean | null> => {
  const rows: Array<{ on: boolean }> = await AppDataSource.query(`SELECT assistant_files_enabled AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return rows.length ? rows[0].on === true : null;
};

export const currentAssistantDataSwitch = async (companyId: number): Promise<boolean | null> => {
  const rows: Array<{ on: boolean }> = await AppDataSource.query(`SELECT assistant_data_enabled AS "on" FROM company WHERE company_id = $1`, [companyId]);
  return rows.length ? rows[0].on === true : null;
};

export const auditAssistantSwitch = (
  m: EntityManager,
  companyId: number,
  oldValue: boolean,
  newValue: boolean,
  actorId: number | null,
  field: "assistant_enabled" | "assistant_files_enabled" | "assistant_data_enabled" = "assistant_enabled",
) =>
  m.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, 'switch', $3, NULL, $4)`,
    [AS_AUDIT_ENTITY, companyId, JSON.stringify({ [field]: { old: oldValue, new: newValue } }), actorId],
  );
