import { AppDataSource } from "../config/data-source";
import { McpToolCall } from "../entities/McpToolCall";
import { log } from "../utils/logger";

export interface ToolCallLogEntry {
  grant_id: string;
  user_id: number;
  company_id: number | null;
  tool: string;
  plan_id: string | null;
  ok: boolean;
  error_code: string | null;
  duration_ms: number;
}

/**
 * Writes one mcp_tool_call row and bumps oauth_grant.last_used_at (IM5's
 * table; skipped quietly where it does not exist yet). Best effort: a logging
 * failure is itself logged and never changes the tool result.
 */
export const recordToolCall = async (entry: ToolCallLogEntry): Promise<void> => {
  try {
    await AppDataSource.getRepository(McpToolCall).insert({ ...entry });
  } catch (err: any) {
    log.warn("MCP", "Could not write the tool-call log row", { tool: entry.tool, error: err?.message });
  }
  if (entry.grant_id.startsWith("test-")) return;
  try {
    await AppDataSource.query(`UPDATE oauth_grant SET last_used_at = now() WHERE grant_id = $1`, [entry.grant_id]);
  } catch (err: any) {
    if (err?.code !== "42P01" && err?.code !== "42703") {
      log.warn("MCP", "Could not update oauth_grant.last_used_at", { error: err?.message });
    }
  }
};
