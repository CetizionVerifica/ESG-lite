import { z } from "zod";
import { defineTool, McpToolContext, ToolDefinition } from "../../registry";
import { assertClientUsable } from "../../clientAccess";
import {
  ActivityMatchSchema,
  ImportPlanWithRows,
  ImportRowShape,
  PatchPlanBodySchema,
  RowIssueCodeSchema,
  RowStateSchema,
  ToolInputs,
  parseImportRows,
} from "../../../imports/contracts";
import { ImportError } from "../../../imports/errors";
import { IMPORT_LIMITS } from "../../../imports/limits";
import * as plans from "../../../imports/plans/service";
import type { TokenUser } from "../../../imports/plans/scope";

/**
 * Import tools (docs/mcp-import/01-contracts.md §8, IM8). Thin handlers over
 * the IM2 plans service with `channel: "mcp"`: the service (and IM1's writer
 * under it) owns every rule, total and transaction; this file only turns a
 * tool call into a service call and checks the plan's client switch.
 *
 * - `plan_import` and `list_upload_batches` name a `company_id`; the
 *   registry checks that client (exists, active, mcp_enabled) before the
 *   handler runs.
 * - The `plan_id` tools set `clientKey: null` and check the plan's own
 *   client here (`loadPlanForTool`), so a client switched off after planning
 *   can neither be read nor committed.
 * - Rows arrive loose (unknown keys kept) so total-like keys can be reported
 *   as CLIENT_TOTAL_IGNORED; `parseImportRows` then strips and validates them
 *   with the IM0 schema. Totals are never read from a client.
 * - Results go in `structuredContent`; the summary line is "<tool>: ok", so
 *   sheet text never reads as a message from ESGLite.
 */

const user = (ctx: McpToolContext): TokenUser => ({ userId: ctx.user.user_id, role: ctx.user.role });

const validation = (err: unknown): never => {
  if (err instanceof z.ZodError) {
    throw new ImportError("IMPORT_VALIDATION", err.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })));
  }
  throw err;
};

/**
 * The plan, visible to this Superadmin, with its client's switch checked.
 * When the caller named a `company_id`, the plan must belong to it, and that
 * is checked before the switch: a mismatch is IMPORT_FORBIDDEN about the
 * named client, never a message about the plan's real owner.
 */
const loadPlanForTool = async (ctx: McpToolContext, planId: string, companyId?: number) => {
  ctx.setPlanId(planId);
  const plan = await plans.loadVisiblePlan(user(ctx), planId);
  if (companyId !== undefined && plan.company_id !== companyId) {
    throw new ImportError("IMPORT_FORBIDDEN", { plan_id: plan.plan_id, company_id: companyId }, "This plan belongs to a different client.");
  }
  await assertClientUsable(plan.company_id);
  return plan;
};

/** The IM0 row shape, keeping unknown keys so total-like ones can be flagged. */
const looseRow = ImportRowShape.loose();
const looseChange = z
  .object({
    row_ref: z.string().trim().min(1).max(IMPORT_LIMITS.ROW_REF_MAX_CHARS),
    set: ImportRowShape.partial().omit({ row_ref: true }).loose().optional(),
    skip: z.boolean().optional(),
  })
  .describe("Set fields of a row (same keys as a row) or skip it");

const planInput = ToolInputs.plan_import.shape;
const updateInput = ToolInputs.update_import_plan.shape;

const notReadOnly = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

export const importTools: ToolDefinition<any>[] = [
  defineTool({
    name: "plan_import",
    title: "Plan an import",
    description:
      "Validates and calculates rows from a workbook into a draft plan, or appends rows to a draft plan when plan_id and its current version are given (send at most 2,000 rows per call). Every row's site must belong to company_id. Returns the plan summary, totals, issue summary and the first 50 rows with issues. Nothing is saved until commit_import.",
    input: {
      company_id: planInput.company_id,
      source_name: planInput.source_name.describe("Workbook or sheet name shown on the upload batch; ignored when appending with plan_id (the plan keeps its own)"),
      rows: z.array(looseRow).min(1).max(IMPORT_LIMITS.ROWS_PER_REQUEST),
      plan_id: planInput.plan_id,
      version: planInput.version,
    },
    scope: "imports:write",
    annotations: notReadOnly,
    handler: async (ctx, input) => {
      let parsed: ReturnType<typeof parseImportRows>;
      try {
        parsed = parseImportRows(input.rows);
      } catch (err) {
        return validation(err);
      }
      const totalLike = new Set(parsed.stripped.map((s) => s.row_ref));
      let result: ImportPlanWithRows;
      if (input.plan_id) {
        if (input.version === undefined) throw new ImportError("IMPORT_VALIDATION", [{ path: "version", message: "version is required when plan_id is given" }], "Send the plan's current version when appending with plan_id.");
        const plan = await loadPlanForTool(ctx, input.plan_id, input.company_id);
        result = await plans.appendRows(user(ctx), plan.plan_id, { version: input.version, rows: parsed.rows }, totalLike);
        ctx.log("appended rows", { plan_id: plan.plan_id, rows: parsed.rows.length, version: result.version });
      } else {
        result = await plans.createPlan(user(ctx), { source_name: input.source_name, channel: "mcp", company_id: input.company_id, rows: parsed.rows }, totalLike);
        ctx.setPlanId(result.plan_id);
        ctx.log("planned rows", { plan_id: result.plan_id, company_id: input.company_id, rows: parsed.rows.length });
      }
      const { rows, ...plan } = result;
      return { ...plan, rows: rows.filter((r) => r.state === "issue").slice(0, IMPORT_LIMITS.PLAN_PREVIEW_ROWS) };
    },
  }),
  defineTool({
    name: "get_import_plan",
    title: "Get an import plan",
    description: "A plan's summary, totals and a page of 50 rows (issues first), filtered by state or issue code.",
    input: {
      plan_id: ToolInputs.get_import_plan.shape.plan_id,
      state: RowStateSchema.optional(),
      code: RowIssueCodeSchema.optional(),
      page: ToolInputs.get_import_plan.shape.page,
    },
    scope: "imports:read",
    clientKey: null,
    annotations: readOnly,
    handler: async (ctx, input) => {
      const plan = await loadPlanForTool(ctx, input.plan_id);
      return plans.getPlan(user(ctx), plan.plan_id, { state: input.state, code: input.code, page: input.page });
    },
  }),
  defineTool({
    name: "update_import_plan",
    title: "Update an import plan",
    description:
      "Fixes rows of a draft plan (set fields or skip them by row_ref) and resolves activity names (sheet wording → an existing factor name for that site and category), then recalculates the whole plan and returns it with a new version.",
    input: {
      plan_id: updateInput.plan_id,
      version: updateInput.version,
      changes: z.array(looseChange).max(IMPORT_LIMITS.ROWS_PER_REQUEST).optional(),
      activity_matches: z.array(ActivityMatchSchema).max(IMPORT_LIMITS.ROWS_PER_REQUEST).optional(),
    },
    scope: "imports:write",
    clientKey: null,
    annotations: notReadOnly,
    handler: async (ctx, input) => {
      const plan = await loadPlanForTool(ctx, input.plan_id);
      const totalLike = plans.findTotalLikeChanges(input.changes);
      let body: z.infer<typeof PatchPlanBodySchema>;
      try {
        body = PatchPlanBodySchema.parse({ version: input.version, changes: input.changes, activity_matches: input.activity_matches });
      } catch (err) {
        return validation(err);
      }
      const result = await plans.patchPlan(user(ctx), plan.plan_id, body, totalLike);
      ctx.log("updated plan", { plan_id: plan.plan_id, changes: body.changes?.length ?? 0, matches: body.activity_matches?.length ?? 0, version: result.version });
      return result;
    },
  }),
  defineTool({
    name: "commit_import",
    title: "Commit an import",
    description:
      "Saves the plan's ready rows as one pending upload batch for the client's managers to approve, and returns the plan with its batch id. Before calling this, show the user the totals by category and by month and the number of rows with issues, and get an explicit yes. Pass the plan's current version; a repeat call with the same version returns the same batch and saves nothing twice.",
    input: ToolInputs.commit_import.shape,
    scope: "imports:write",
    clientKey: null,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ctx, input) => {
      const plan = await loadPlanForTool(ctx, input.plan_id);
      const result = await plans.commitPlan(user(ctx), plan.plan_id, {
        version: input.version,
        skip_rows_with_issues: input.skip_rows_with_issues,
        idempotency_key: `${plan.plan_id}:${input.version}`,
      });
      ctx.log("committed plan", { plan_id: plan.plan_id, upload_batch_id: result.committed?.upload_batch_id, inserted: result.committed?.inserted });
      return result;
    },
  }),
  defineTool({
    name: "cancel_import_plan",
    title: "Cancel an import plan",
    description: "Discards a draft plan. Nothing already saved is touched.",
    input: ToolInputs.cancel_import_plan.shape,
    scope: "imports:write",
    clientKey: null,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: async (ctx, input) => {
      const plan = await loadPlanForTool(ctx, input.plan_id);
      return plans.cancelPlan(user(ctx), plan.plan_id);
    },
  }),
  defineTool({
    name: "list_upload_batches",
    title: "List upload batches",
    description:
      "Upload batches of a client, newest first, 50 per page, each with its pending, approved and rejected row counts, so you can answer whether an upload has been approved yet.",
    input: ToolInputs.list_upload_batches.shape,
    scope: "imports:read",
    annotations: readOnly,
    handler: async (ctx, input) => {
      const batches = await plans.listBatches(user(ctx), { company_id: input.company_id, status: input.status, page: input.page });
      return { company_id: input.company_id, page: input.page ?? 1, page_size: IMPORT_LIMITS.DEFAULT_PAGE_SIZE, batches };
    },
  }),
];
