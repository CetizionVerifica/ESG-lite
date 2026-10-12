import { z } from "zod";
import { defineTool, ToolDefinition } from "../../registry";
import { MCP_CODES } from "../../codes";
import { McpToolError } from "../../errors";

/**
 * Import tools (docs/mcp-import/01-contracts.md §8). IM6 registers them as
 * stubs that answer NOT_IMPLEMENTED; IM8 (src/mcp/tools/import/) replaces
 * this file with the real handlers over the IM2 plans service, using the
 * IM0 row and plan schemas as input.
 */
const notImplemented = async () => {
  throw new McpToolError(MCP_CODES.NOT_IMPLEMENTED);
};

const companyId = z.number().int().positive().describe("The client's company_id (from whoami).");
const planId = z.string().uuid().describe("plan_id returned by plan_import.");
const version = z.number().int().nonnegative().describe("The plan version you last saw.");

export const importTools: ToolDefinition<any>[] = [
  defineTool({
    name: "plan_import",
    title: "Plan an import",
    description:
      "Validates and calculates rows from a workbook into a draft plan (or appends to one with plan_id). Nothing is saved until commit_import.",
    input: {
      company_id: companyId,
      source_name: z.string().min(1).max(200),
      rows: z.array(z.record(z.string(), z.unknown())).max(2000),
      plan_id: planId.optional(),
      version: version.optional(),
    },
    scope: "imports:write",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: notImplemented,
  }),
  defineTool({
    name: "get_import_plan",
    title: "Get an import plan",
    description: "A plan's summary, totals and a page of its rows, filtered by state or issue code.",
    input: {
      plan_id: planId,
      state: z.enum(["ready", "issue", "skipped"]).optional(),
      code: z.string().max(64).optional(),
      page: z.number().int().min(1).optional(),
    },
    scope: "imports:read",
    clientKey: null,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: notImplemented,
  }),
  defineTool({
    name: "update_import_plan",
    title: "Update an import plan",
    description: "Fixes rows (set fields or skip) and resolves activity names, then recalculates the plan.",
    input: {
      plan_id: planId,
      version,
      changes: z.array(z.record(z.string(), z.unknown())).optional(),
      activity_matches: z.array(z.record(z.string(), z.unknown())).optional(),
    },
    scope: "imports:write",
    clientKey: null,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    handler: notImplemented,
  }),
  defineTool({
    name: "commit_import",
    title: "Commit an import",
    description:
      "Saves the plan's ready rows as one pending upload batch for the client's managers to approve. Show the user the totals by category and month and the issue count, and get an explicit yes, before calling this.",
    input: {
      plan_id: planId,
      version,
      skip_rows_with_issues: z.boolean(),
      confirm: z.literal(true),
    },
    scope: "imports:write",
    clientKey: null,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: notImplemented,
  }),
  defineTool({
    name: "cancel_import_plan",
    title: "Cancel an import plan",
    description: "Discards a draft plan. Nothing saved is touched.",
    input: { plan_id: planId },
    scope: "imports:write",
    clientKey: null,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: notImplemented,
  }),
  defineTool({
    name: "list_upload_batches",
    title: "List upload batches",
    description: "Upload batches of a client with pending, approved and rejected counts.",
    input: {
      company_id: companyId,
      status: z.enum(["pending", "approved", "rejected"]).optional(),
      page: z.number().int().min(1).optional(),
    },
    scope: "imports:read",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: notImplemented,
  }),
];
