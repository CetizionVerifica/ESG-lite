// Creates the mcp_tool_call table (entities/McpToolCall.ts): one row per MCP
// tool call with who, tool, plan id, outcome and duration, never payloads
// (audit row MCP-15). The per-client switch company.mcp_enabled is IM5's
// (migrate:oauth); src/mcp/clientAccess.ts treats a missing column as
// "switched off", so /mcp fails closed until that has run.
//
//   npm run migrate:mcp-log
//
// Idempotent (IF NOT EXISTS) and additive.
import "reflect-metadata";
import { AppDataSource } from "../config/data-source";

async function main() {
  await AppDataSource.initialize();
  try {
    await AppDataSource.query(
      `CREATE TABLE IF NOT EXISTS mcp_tool_call (
         id          BIGSERIAL PRIMARY KEY,
         grant_id    VARCHAR(64) NOT NULL,
         user_id     INTEGER     NOT NULL,
         company_id  INTEGER     NULL,
         tool        VARCHAR(64) NOT NULL,
         plan_id     VARCHAR(64) NULL,
         ok          BOOLEAN     NOT NULL,
         error_code  VARCHAR(64) NULL,
         duration_ms INTEGER     NOT NULL,
         created_at  TIMESTAMP   NOT NULL DEFAULT now()
       )`,
    );
    await AppDataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_mcp_tool_call_grant_id" ON mcp_tool_call (grant_id)`);
    await AppDataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_mcp_tool_call_user_id" ON mcp_tool_call (user_id)`);
    await AppDataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_mcp_tool_call_created_at" ON mcp_tool_call (created_at)`);
    console.log("mcp_tool_call present.");
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
