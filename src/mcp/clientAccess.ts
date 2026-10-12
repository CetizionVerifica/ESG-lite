import { AppDataSource } from "../config/data-source";
import { log } from "../utils/logger";
import { MCP_CODES } from "./codes";
import { McpToolError } from "./errors";

/**
 * Per-call client check (non-negotiable 6 and decision D4): a Superadmin's
 * token is not tied to one client, so every tool that names a `company_id`
 * is checked against that client's `status` and `mcp_enabled` switch.
 *
 * `company.mcp_enabled` belongs to IM5 (Company entity, `migrate:oauth`,
 * toggled through the admin companies endpoint). It is read here with plain
 * SQL so this works whichever PR merges first. Where the column is still
 * missing the answer is "switched off" (fail closed) and a warning is logged
 * once.
 */
let warnedMissingColumn = false;

export interface ClientAccess {
  company_id: number;
  name: string;
  active: boolean;
  mcp_enabled: boolean;
}

export const readClientAccess = async (companyId: number): Promise<ClientAccess | null> => {
  let rows: { company_id: number; name: string; status: boolean; mcp_enabled: boolean | null }[];
  try {
    rows = await AppDataSource.query(
      `SELECT company_id, name, status, mcp_enabled FROM company WHERE company_id = $1`,
      [companyId],
    );
  } catch (err: any) {
    if (err?.code !== "42703") throw err; // undefined_column
    if (!warnedMissingColumn) {
      warnedMissingColumn = true;
      log.warn("MCP", "company.mcp_enabled is missing; run `npm run migrate:oauth` (IM5). Treating every client as switched off.");
    }
    rows = (
      await AppDataSource.query(`SELECT company_id, name, status FROM company WHERE company_id = $1`, [companyId])
    ).map((r: any) => ({ ...r, mcp_enabled: false }));
  }
  const row = rows[0];
  if (!row) return null;
  return { company_id: Number(row.company_id), name: row.name, active: row.status !== false, mcp_enabled: row.mcp_enabled === true };
};

/**
 * Throws the matching McpToolError unless the client exists, is active and
 * has Claude imports switched on.
 */
export const assertClientUsable = async (companyId: number): Promise<ClientAccess> => {
  if (!Number.isInteger(companyId) || companyId <= 0) {
    throw new McpToolError(MCP_CODES.CLIENT_NOT_FOUND, undefined, { company_id: companyId });
  }
  const client = await readClientAccess(companyId);
  if (!client) throw new McpToolError(MCP_CODES.CLIENT_NOT_FOUND, undefined, { company_id: companyId });
  if (!client.active) throw new McpToolError(MCP_CODES.CLIENT_INACTIVE, undefined, { company_id: companyId });
  if (!client.mcp_enabled) throw new McpToolError(MCP_CODES.MCP_DISABLED_FOR_CLIENT, undefined, { company_id: companyId });
  return client;
};
