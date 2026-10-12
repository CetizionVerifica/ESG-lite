import { z } from "zod";
import { defineTool, ToolDefinition } from "../../registry";
import { MCP_CODES } from "../../codes";
import { McpToolError } from "../../errors";

/**
 * Read tools (docs/mcp-import/01-contracts.md §8). IM6 registers them as
 * stubs that answer NOT_IMPLEMENTED so clients see the final tool list and
 * scopes from day one; IM7 (src/mcp/tools/read/) replaces this file with the
 * real handlers over the IM3 context service and the IM0 input schemas.
 */
const notImplemented = async () => {
  throw new McpToolError(MCP_CODES.NOT_IMPLEMENTED);
};

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const companyId = z.number().int().positive().describe("The client's company_id (from whoami).");
const siteId = z.number().int().positive().describe("site_id from list_sites_and_categories.");
const categoryId = z.number().int().positive().describe("category_id from list_sites_and_categories.");

export const readTools: ToolDefinition<any>[] = [
  defineTool({
    name: "whoami",
    title: "Who am I",
    description: "The signed-in ESGLite Superadmin, the clients with Claude imports switched on, and the import limits.",
    input: {},
    scope: "imports:read",
    clientKey: null,
    annotations: readOnly,
    handler: notImplemented,
  }),
  defineTool({
    name: "list_sites_and_categories",
    title: "List sites and categories",
    description: "Sites of one client with the categories assigned to each, their period modes, forms and readiness.",
    input: { company_id: companyId },
    scope: "imports:read",
    annotations: readOnly,
    handler: notImplemented,
  }),
  defineTool({
    name: "get_category_form",
    title: "Get category form",
    description: "The data-entry form of one site × category: fields, calculation mode, units, period modes and common activity names.",
    input: { site_id: siteId, category_id: categoryId },
    scope: "imports:read",
    clientKey: null,
    annotations: readOnly,
    handler: notImplemented,
  }),
  defineTool({
    name: "find_activity",
    title: "Find activity",
    description: "Up to 10 activity names (factors and saved mappings) matching a query for one site × category.",
    input: { site_id: siteId, category_id: categoryId, query: z.string().min(1).max(200) },
    scope: "imports:read",
    clientKey: null,
    annotations: readOnly,
    handler: notImplemented,
  }),
  defineTool({
    name: "check_readiness",
    title: "Check readiness",
    description: "Which site × category pairs of a client can take rows for a year, and what is missing (form, factors) for the rest.",
    input: { company_id: companyId, year: z.number().int().min(2000).max(2100) },
    scope: "imports:read",
    annotations: readOnly,
    handler: notImplemented,
  }),
];
