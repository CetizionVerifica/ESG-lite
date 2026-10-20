/**
 * DS-5 · designs (report docs), readiness and the auto-build: the shapes of
 * 01-contracts §4 `GET /readiness`, `GET/POST /docs`, `GET/PATCH/DELETE
 * /docs/:id`, `POST /docs/:id/rebuild`, `/presence` and `/duplicate`.
 * The FE mirror is the "DS-5" block of ESG-lite_FE src/lib/studio/contracts.ts.
 *
 * Also the template build contract DS-5 reads from `report_template.doc`
 * (DS-4 writes it): a ReportDoc v2 with placeholders, plus optional build
 * hints (TemplateBuildHints) that are stripped before the doc is validated.
 */
import { z } from "zod";
import { FrameworkCodeSchema, PageFormatSchema, ReportKindSchema, YearTypeSchema, type DocPurpose, type PageFormat, type ReportKind, type ReportStatus, type YearType } from "./enums";
import { SitesSchema } from "./sources";

const Year = z.number().int().min(1990).max(2100);
const CompanyId = z.union([z.number(), z.string()]).optional();

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** `templateId: "blank"` makes a one-page blank design in `format` (05-ux S2 "Blank A4" card). */
export const BLANK_TEMPLATE = "blank" as const;

/** POST /studio/docs. `inputs` is an inputs patch (DS-2 `applyInputPatch`): `{key: {value, source?}}`. */
export const CreateDocBodySchema = z
  .object({
    kind: ReportKindSchema,
    templateId: z.union([z.number().int().positive(), z.literal(BLANK_TEMPLATE)]),
    year: Year,
    yearType: YearTypeSchema,
    sites: SitesSchema.default("all"),
    frameworks: z.array(FrameworkCodeSchema).max(7).default([]),
    compareYear: Year.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    /** Only for a blank design (a template sets its own format). */
    format: PageFormatSchema.optional(),
    inputs: z.record(z.string(), z.unknown()).default({}),
    ai: z.boolean().default(false),
    company_id: CompanyId,
  })
  .strict();
export type CreateDocBody = z.infer<typeof CreateDocBodySchema>;

/** PATCH /studio/docs/:id: the whole doc (autosave), a rename, or both. */
export const PatchDocBodySchema = z
  .object({
    rev: z.number().int().min(0),
    doc: z.unknown().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    company_id: CompanyId,
  })
  .strict()
  .refine((b) => b.doc !== undefined || b.title !== undefined, { message: "Send doc or title", path: ["doc"] });

export const RebuildBodySchema = z
  .object({
    pageIds: z.array(z.string().min(1).max(120)).max(500).optional(),
    keepUserEdits: z.literal(true).default(true),
    company_id: CompanyId,
  })
  .strict();

export const DuplicateBodySchema = z.object({ title: z.string().trim().min(1).max(200).optional(), company_id: CompanyId }).strict();

/** Query of GET /studio/docs. */
export const ListDocsQuerySchema = z
  .object({ kind: ReportKindSchema.optional(), year: z.coerce.number().int().min(1990).max(2100).optional(), company_id: z.string().optional() })
  .strict();

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export const BUILD_STEP_IDS = ["template", "data", "layout", "inputs", "ai", "save"] as const;
export type BuildStepId = (typeof BUILD_STEP_IDS)[number];
export const BUILD_STATES = ["running", "done", "failed"] as const;
export type BuildState = (typeof BUILD_STATES)[number];

export interface BuildStep {
  id: BuildStepId;
  label: string;
  state: "pending" | "running" | "done" | "skipped" | "failed";
  /** What the step found, e.g. "22 pages" or "AI drafting arrives with DS-9; template text kept". */
  note?: string;
}

/** `report_doc.build`: the auto-build progress, polled with GET /docs/:id?build=1. */
export interface BuildProgress {
  state: BuildState;
  steps: BuildStep[];
  /** Pages the template had that were left out because their data is empty. */
  dropped: Array<{ pageId: string; name: string; reason: string }>;
  pageCount: number | null;
  startedAt: string;
  finishedAt: string | null;
  error?: { code: string; message: string };
}

/** A row of GET /studio/docs (the home "Recent designs"). */
export interface DocSummary {
  id: number;
  kind: ReportKind;
  purpose: DocPurpose;
  format: PageFormat;
  title: string;
  year: number;
  yearType: YearType;
  status: ReportStatus;
  rev: number;
  pageCount: number;
  templateId: number | null;
  sourceDocId: number | null;
  /** n of the newest final version, if any ("Final v2"). */
  finalVersion: number | null;
  buildState: BuildState | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  /** Until DS-11 renders thumbnails, null (the FE draws the first page with the renderer mirror). */
  thumbnailUrl: string | null;
}

/** GET/PATCH /studio/docs/:id, POST /docs, POST /docs/:id/rebuild. */
export interface DocResponse {
  id: number;
  doc: unknown;
  rev: number;
  status: ReportStatus;
  title: string;
  dataHash: string | null;
  updatedAt: string;
  build: BuildProgress | null;
}

// ---------------------------------------------------------------------------
// Readiness (GET /studio/readiness?kind=&year=&yearType=&sites=)
// ---------------------------------------------------------------------------

export const GHG_GAP_KINDS = ["pending_entries", "rejected_entries", "site_no_data", "months_missing", "scope3_unaddressed", "no_data"] as const;
export type GhgGapKind = (typeof GHG_GAP_KINDS)[number];

export interface ReadinessGap {
  kind: GhgGapKind | "kpi_missing" | "kpi_pending" | "year_not_locked" | "kpi_setup";
  severity: "error" | "warning" | "info";
  message: string;
  /** App route that fixes it (Review, the ledger, Scope 3 screening, KPI review). */
  link: string | null;
  linkLabel: string | null;
  siteId?: number;
  months?: string[];
  categories?: number[];
  count?: number;
}

export interface GhgReadiness {
  kind: "ghg";
  year: number;
  yearType: YearType;
  /** "FY 2025–26" / "2025". */
  periodLabel: string;
  approvedRows: number;
  pendingRows: number;
  rejectedRows: number;
  /** Sites in scope with at least one approved row, and how many are in scope. */
  sitesCovered: number;
  sitesTotal: number;
  sitesMissing: Array<{ id: number; name: string }>;
  /** Months with approved data across the monthly sites, of the months expected so far. */
  monthsCovered: number;
  monthsExpected: number;
  monthsMissing: Array<{ siteId: number; siteName: string; months: string[] }>;
  /** "n/15" and the numbers behind it. */
  scope3Addressed: string;
  scope3: { reported: number[]; excluded: number[]; unaddressed: number[] };
  /** ready = nothing to fix; almost = only warnings; not_ready = errors (pending entries, no data). */
  state: "ready" | "almost" | "not_ready";
  gaps: ReadinessGap[];
}

export interface SustainabilityReadiness {
  kind: "sustainability";
  year: number;
  yearType: YearType;
  periodLabel: string;
  setupDone: boolean;
  locked: boolean;
  lockedAt: string | null;
  coverage: Array<{ framework: string; pct: number }>;
  missing: Array<{ kpi: string; name: string; sites: number[]; periods: string[] }>;
  pendingCount: number;
  state: "ready" | "almost" | "not_ready";
  gaps: ReadinessGap[];
}

export type Readiness = GhgReadiness | SustainabilityReadiness;

// ---------------------------------------------------------------------------
// Template build contract (report_template.doc, written by DS-4)
// ---------------------------------------------------------------------------

/**
 * Per-page build hints. A template may put them on a page object
 * (`keepEmpty`, `requires`, `emptyText`) or in a top-level
 * `build.pages[pageId]` map; DS-5 strips both before validating the doc.
 *
 *  requires   'data' (default for a page with GHG/KPI bindings or chips): the page is
 *             dropped when every such binding resolves to no data; 'none': never dropped.
 *  keepEmpty  keep the page even when its data is empty (e.g. "Scope 3 not yet reported").
 *  emptyText  when kept empty, text elements whose `id` ends with ".empty" get this text.
 */
export const TemplatePageHintSchema = z
  .object({
    requires: z.enum(["data", "none"]).optional(),
    keepEmpty: z.boolean().optional(),
    emptyText: z.string().max(500).optional(),
  })
  .strict();
export type TemplatePageHint = z.infer<typeof TemplatePageHintSchema>;
export const TEMPLATE_PAGE_HINT_KEYS = ["requires", "keepEmpty", "emptyText"] as const;

/**
 * Text placeholders filled at build time (in text, callout and flow content,
 * and in chart titles and tile labels):
 *   {{company.name}} {{meta.title}} {{meta.year}} {{meta.period}} {{meta.periodShort}}
 *   {{meta.compareYear}} {{meta.sites}} {{meta.frameworks}} {{input:<ReportInputKey>}}
 * An input with no value becomes "[<label>: add it in Report details]" and is
 * flagged by checks later (DS-12).
 * The DS-4 seed templates use the short forms {{company}}, {{title}}, {{year}}
 * and {{period}}; they mean company.name, meta.title, meta.year and
 * meta.periodShort (Wave 2 integration).
 */
export const PLACEHOLDER_PATTERN = /\{\{\s*(company\.name|meta\.title|meta\.year|meta\.period|meta\.periodShort|meta\.compareYear|meta\.sites|meta\.frameworks|input:[a-z0-9_]+|company|title|year|period)\s*\}\}/g;
