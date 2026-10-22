import { z } from "zod";
import { AppDataSource } from "../../../config/data-source";
import {
  ActivityOptionSchema,
  CalcModeSchema,
  ContextCategorySchema,
  FormFieldSchema,
  ImportContextSchema,
  ReadinessCellSchema,
  ReportingPeriodSchema,
  ToolInputs,
} from "../../../imports/contracts";
import { ImportError } from "../../../imports/errors";
import { IMPORT_LIMITS } from "../../../imports/limits";
import {
  buildImportContext,
  buildReadiness,
  loadForm,
  resolveImportScope,
  searchActivities,
  type ImportScope,
} from "../../../imports/context/service";
import { UserRole } from "../../../types/type";
import { MCP_CODES } from "../../codes";
import { McpToolError } from "../../errors";
import { defineTool, McpToolContext, ToolDefinition } from "../../registry";

/**
 * IM7 · Read tools (docs/mcp-import/01-contracts.md §8, spec in ./CLAUDE.md).
 * Thin wrappers over the IM3 context service: the same scope, forms,
 * activities and readiness the HTTP API returns, shaped for an MCP client.
 * Summary lines carry ids and counts only; names from factors, mappings or
 * sheets stay inside structuredContent.
 */

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const SCOPE = "imports:read" as const;

export const FIND_ACTIVITY_LIMIT = IMPORT_LIMITS.ACTIVITY_SEARCH_RESULTS;
export const FORM_ACTIVITY_LIMIT = 50;

// ---- output schemas (IM0 shapes plus what IM3 adds; see src/imports/context/CLAUDE.md) ----

const ReadFormFieldSchema = FormFieldSchema.extend({
  depends_on: z.string().optional(),
  show_for: z.array(z.string()).optional(),
  required_for: z.array(z.string()).optional(),
});
const ReadFormSchema = z.object({
  calc_mode: CalcModeSchema,
  method_column: z.string().optional(),
  fields: z.array(ReadFormFieldSchema),
});
const ReadCategorySchema = ContextCategorySchema.extend({ form: ReadFormSchema.nullable() });
const ReadContextSchema = ImportContextSchema.extend({
  sites: z.array(z.object({ site_id: z.number().int(), name: z.string(), categories: z.array(ReadCategorySchema) })),
});
const ReadReadinessCellSchema = ReadinessCellSchema.extend({
  site_name: z.string(),
  category_name: z.string(),
  lookup_year: z.number().int(),
  factor_for_year: z.boolean(),
  ready: z.boolean(),
  missing: z.array(z.object({ what: z.enum(["form", "factor", "factor_for_year"]), fix_page: z.string() })),
});

/**
 * Shape of each tool's `structuredContent` (zod raw shapes; CI validates every
 * success result against them). Not published as an MCP `outputSchema`: the
 * official TypeScript client validates the structuredContent of error results
 * too, and the §9 error shape `{ code, details }` would fail every tool error.
 */
export const ReadToolOutputs = {
  whoami: {
    user: z.object({ user_id: z.number().int(), name: z.string(), email: z.string(), role: z.string() }),
    scopes: z.array(z.string()),
    clients: z.array(z.object({ company_id: z.number().int(), name: z.string() })),
    limits: z.object({
      rows_per_request: z.number().int(),
      rows_per_plan: z.number().int(),
      draft_plans_per_user: z.number().int(),
      plan_expiry_hours: z.number().int(),
      find_activity_matches: z.number().int(),
    }),
  },
  list_sites_and_categories: ReadContextSchema.shape,
  get_category_form: {
    company_id: z.number().int(),
    site_id: z.number().int(),
    site_name: z.string(),
    category_id: z.number().int(),
    category_name: z.string(),
    scope: z.enum(["Scope 1", "Scope 2", "Scope 3"]).nullable(),
    period_modes: z.array(ReportingPeriodSchema),
    form: ReadFormSchema.nullable(),
    units: z.array(z.string()),
    readiness: z.object({ form: z.boolean(), factor_years: z.array(z.number().int()) }),
    activity_count: z.number().int(),
    /** The most used activity names first (approved and pending rows), then the rest alphabetically; at most 50. */
    activities: z.array(ActivityOptionSchema.extend({ uses: z.number().int() })),
  },
  find_activity: {
    company_id: z.number().int(),
    site_id: z.number().int(),
    category_id: z.number().int(),
    matches: z.array(ActivityOptionSchema),
    /** True when more names matched than were returned; narrow the query. */
    truncated: z.boolean(),
  },
  check_readiness: {
    company_id: z.number().int(),
    year: z.number().int(),
    cells: z.array(ReadReadinessCellSchema),
    gaps: z.number().int(),
    /** Cells that can take rows now. */
    ready: z.number().int(),
  },
};

// ---- helpers ----

/** Decision D4, checked again in every handler (the HTTP layer already refused non-Superadmins). */
const assertSuperadmin = (ctx: McpToolContext): void => {
  if (ctx.user.role !== UserRole.SUPERADMIN) throw new McpToolError(MCP_CODES.MCP_SUPERADMIN_ONLY);
};

const caller = (ctx: McpToolContext) => ({ user_id: ctx.user.user_id, role: ctx.user.role });

/** Stops between sequential awaits once the registry's 30 s timeout, or the client, has cancelled the call. */
const checkpoint = (ctx: McpToolContext): void => ctx.signal.throwIfAborted();

const text = (line: string) => ({ type: "text" as const, text: line });

/** The client a site belongs to; unknown sites read as "not yours" (IMPORT_FORBIDDEN), never "not found". */
async function companyOfSite(site_id: number): Promise<number> {
  const rows: { company_id: number }[] = await AppDataSource.query(`SELECT company_id FROM site WHERE site_id = $1`, [site_id]);
  const id = rows[0]?.company_id;
  if (!id) throw new ImportError("IMPORT_FORBIDDEN");
  return Number(id);
}

/**
 * Scope for a site-addressed tool. The registry has already checked the
 * client named by `company_id` (active, mcp_enabled) and logs it; a site of
 * another client is IMPORT_FORBIDDEN.
 */
async function scopeForSite(ctx: McpToolContext, site_id: number, company_id: number): Promise<ImportScope> {
  if ((await companyOfSite(site_id)) !== company_id) throw new ImportError("IMPORT_FORBIDDEN");
  checkpoint(ctx);
  return resolveImportScope(caller(ctx), company_id);
}

/** How often each activity name was used in saved rows of a site × category (rejected rows excluded). */
async function activityUses(site_id: number, category_id: number): Promise<Map<string, number>> {
  const rows: { name: string; n: string }[] = await AppDataSource.query(
    `SELECT lower(trim(activity_data->>'emission_category')) AS name, count(*)::int AS n
       FROM emission
      WHERE site_id = $1 AND category_id = $2 AND status <> 'rejected' AND activity_data ? 'emission_category'
      GROUP BY 1`,
    [site_id, category_id],
  );
  return new Map(rows.filter((r) => r.name).map((r) => [r.name, Number(r.n)]));
}

const companyId = z.number().int().positive().describe("The client's company_id (from whoami).");
const siteId = z.number().int().positive().describe("site_id from list_sites_and_categories.");
const categoryId = z.number().int().positive().describe("category_id from list_sites_and_categories.");
const siteCompanyId = companyId.describe("The client's company_id (from whoami); the site must belong to it.");

// ---- tools ----

export const readTools: ToolDefinition<any>[] = [
  defineTool({
    name: "whoami",
    title: "Who am I",
    description:
      "Call first. Returns the signed-in ESGLite Superadmin, the clients that have Claude imports switched on (use their company_id in every other tool) and the import limits.",
    input: ToolInputs.whoami.shape,
    scope: SCOPE,
    clientKey: null,
    annotations: readOnly,
    handler: async (ctx) => {
      assertSuperadmin(ctx);
      const [user] = (await AppDataSource.query(`SELECT user_id, name, email, role FROM "user" WHERE user_id = $1`, [ctx.user.user_id])) as {
        user_id: number;
        name: string | null;
        email: string;
        role: string;
      }[];
      if (!user) throw new McpToolError(MCP_CODES.MCP_SUPERADMIN_ONLY);
      checkpoint(ctx);
      let clients: { company_id: number; name: string }[] = [];
      try {
        clients = await AppDataSource.query(
          `SELECT company_id, name FROM company WHERE mcp_enabled = true AND status = true ORDER BY name ASC, company_id ASC`,
        );
      } catch (err: any) {
        if (err?.code !== "42703") throw err; // IM5 migration not run: no client is switched on yet
      }
      const data = {
        user: { user_id: Number(user.user_id), name: user.name ?? "", email: user.email, role: user.role },
        scopes: ctx.scopes,
        clients: clients.map((c) => ({ company_id: Number(c.company_id), name: c.name })),
        limits: {
          rows_per_request: IMPORT_LIMITS.ROWS_PER_REQUEST,
          rows_per_plan: IMPORT_LIMITS.ROWS_PER_PLAN,
          draft_plans_per_user: IMPORT_LIMITS.DRAFT_PLANS_PER_USER,
          plan_expiry_hours: IMPORT_LIMITS.PLAN_EXPIRY_HOURS,
          find_activity_matches: FIND_ACTIVITY_LIMIT,
        },
      };
      return { content: [text(`whoami: user ${data.user.user_id}, ${data.clients.length} client(s) with Claude imports on`)], structuredContent: data };
    },
  }),

  defineTool({
    name: "list_sites_and_categories",
    title: "List sites and categories",
    description:
      "Call before plan_import to get site_id and category_id (plan_import does not accept names). Every site of one client with the categories assigned to it, each with period modes, data-entry form, units and readiness. Activity names are not included: use get_category_form or find_activity.",
    input: ToolInputs.list_sites_and_categories.shape,
    scope: SCOPE,
    annotations: readOnly,
    handler: async (ctx, input) => {
      assertSuperadmin(ctx);
      const scope = await resolveImportScope(caller(ctx), input.company_id);
      checkpoint(ctx);
      const context = await buildImportContext(scope);
      const categories = context.sites.reduce((n, s) => n + s.categories.length, 0);
      return {
        content: [text(`list_sites_and_categories: company ${context.company.company_id}, ${context.sites.length} site(s), ${categories} site × category pair(s)`)],
        structuredContent: context,
      };
    },
  }),

  defineTool({
    name: "get_category_form",
    title: "Get category form",
    description:
      "The data-entry form of one site × category before mapping a sheet: fields (which are required, select options, what depends on what), calculation mode, accepted units, period modes, readiness and the 50 most used activity names. Use find_activity for a name that is not listed.",
    input: { ...ToolInputs.get_category_form.shape, company_id: siteCompanyId },
    scope: SCOPE,
    annotations: readOnly,
    handler: async (ctx, input) => {
      assertSuperadmin(ctx);
      const { site_id, category_id } = input;
      const scope = await scopeForSite(ctx, site_id, input.company_id);
      checkpoint(ctx);
      const context = await buildImportContext(scope);
      checkpoint(ctx);
      const site = context.sites.find((s) => s.site_id === site_id);
      const category = site?.categories.find((c) => c.category_id === category_id);
      if (!site || !category) throw new ImportError("IMPORT_FORBIDDEN", { reason: "CATEGORY_NOT_ASSIGNED" });
      const [options, uses, form] = await Promise.all([
        // Every name, so the usage sort below picks the 50 most used rather than the first 50 by name.
        searchActivities(scope, site_id, category_id, undefined, Number.MAX_SAFE_INTEGER),
        activityUses(site_id, category_id),
        loadForm(site_id, category_id), // fresh, not the 60 s cached copy
      ]);
      const activities = options
        .map((o) => ({ ...o, uses: uses.get(o.name.toLowerCase()) ?? 0 }))
        .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
        .slice(0, FORM_ACTIVITY_LIMIT);
      const data = {
        company_id: context.company.company_id,
        site_id,
        site_name: site.name,
        category_id,
        category_name: category.name,
        scope: category.scope,
        period_modes: category.period_modes,
        form: form ?? category.form,
        units: category.units,
        readiness: { ...category.readiness, form: (form ?? category.form) !== null },
        activity_count: category.activity_count,
        activities,
      };
      return {
        content: [
          text(
            `get_category_form: site ${site_id} × category ${category_id}, form ${data.form ? "present" : "missing"}, ${activities.length} activity name(s)`,
          ),
        ],
        structuredContent: data,
      };
    },
  }),

  defineTool({
    name: "find_activity",
    title: "Find activity",
    description:
      "Up to 10 activity names (emission factors and the client's saved mappings) matching a query for one site × category, exact matches first. Use it to resolve a sheet's wording to a name plan_import accepts; nothing is created. accepted_units: units the row can use for this activity.",
    input: { ...ToolInputs.find_activity.shape, company_id: siteCompanyId },
    scope: SCOPE,
    annotations: readOnly,
    handler: async (ctx, input) => {
      assertSuperadmin(ctx);
      const { site_id, category_id, query } = input;
      const scope = await scopeForSite(ctx, site_id, input.company_id);
      checkpoint(ctx);
      const found = await searchActivities(scope, site_id, category_id, query, FIND_ACTIVITY_LIMIT + 1);
      const matches = found.slice(0, FIND_ACTIVITY_LIMIT);
      const data = { company_id: scope.company_id, site_id, category_id, matches, truncated: found.length > FIND_ACTIVITY_LIMIT };
      return {
        content: [text(`find_activity: site ${site_id} × category ${category_id}, ${matches.length} match(es)${data.truncated ? ", more available" : ""}`)],
        structuredContent: data,
      };
    },
  }),

  defineTool({
    name: "check_readiness",
    title: "Check readiness",
    description:
      "Call before plan_import for a reporting year. Which site × category pairs of a client can take rows (form configured and factors present) and, for the rest, what is missing with the ESGLite page that fixes it. Tell the user about the gaps; nothing here can be fixed from Claude.",
    input: ToolInputs.check_readiness.shape,
    scope: SCOPE,
    annotations: readOnly,
    handler: async (ctx, input) => {
      assertSuperadmin(ctx);
      const scope = await resolveImportScope(caller(ctx), input.company_id);
      checkpoint(ctx);
      const readiness = await buildReadiness(scope, input.year);
      const data = { ...readiness, ready: readiness.cells.length - readiness.gaps };
      return {
        content: [text(`check_readiness: company ${data.company_id}, year ${data.year}, ${data.ready} of ${data.cells.length} ready, ${data.gaps} gap(s)`)],
        structuredContent: data,
      };
    },
  }),
];
