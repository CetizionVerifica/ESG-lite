/**
 * PRO-0 · API contracts for Pro editing and AI template suggestion
 * (docs/design-studio/pro/01-pro-editing-and-ai-templates.md):
 *
 *   AT-1  POST /studio/templates/suggest                         R  brief → shortlist (rules + readiness + AI order)
 *   AT-2  POST /studio/docs/:id/ai {action:'suggest_layouts'}    R  (DS-9 route) → Suggestion kind 'pages', 3 options
 *         POST /studio/docs/:id/template-swap/preview            R  → proposed doc, page mapping, nothing saved
 *         POST /studio/docs/:id/template-swap/apply              R  → DocResponse (one new rev)
 *   PE-1  POST /studio/assets/:id/remove-background              R  → 202 ImageJob (503 DS_BG_UNAVAILABLE)
 *         GET  /studio/image-jobs/:id                            R  → ImageJob
 *   PE-2  GET  /studio/brand-kit/fonts                           R  → {fonts: BrandFont[]}
 *         POST /studio/brand-kit/fonts (multipart)               M  → 201 BrandFont
 *         DELETE /studio/brand-kit/fonts/:id                     M  → 204
 *         GET  /studio/brand-kit/fonts/:id/files/:fileId         R  → the font bytes (editor @font-face)
 *
 * Every route sits behind requireDesignStudio (DS_STUDIO_OFF, then DS_ROLE for
 * Users); "M" routes add requireManager. Routes that load a doc use
 * loadDocRow + assertDocSitesReadable + assertKind like DS-5. PRO-0 mounts
 * 501 DS_NOT_BUILT stubs (src/studio/pro/*.ts) that each module replaces.
 *
 * Element-level props (image adjustments, filters, duotone, text effects,
 * custom font refs) live in ./proProps.ts. Error codes: errors.ts PRO-0 block.
 */
import { z } from "zod";
import { FrameworkCodeSchema, PageFormatSchema, ReportKindSchema, YearTypeSchema, type JobStatus } from "./enums";
import { SitesSchema } from "./sources";
import type { DsErrorCode } from "./errors";
import type { ReportTemplate } from "./library";

const CompanyId = z.union([z.number(), z.string()]).optional();
const Id = z.string().min(1).max(120);
const Year = z.number().int().min(1990).max(2100);

// ===========================================================================
// AT-1 · template suggestions for a new report
// ===========================================================================

/** "What is it for?" Maps to a kind: ghg_inventory → ghg, sustainability_report → sustainability; the rest fit both. */
export const BRIEF_PURPOSES = ["sustainability_report", "ghg_inventory", "board_brief", "site_fact_sheet"] as const;
export const BRIEF_AUDIENCES = ["verifier", "board", "investors", "public"] as const;
/** About 2, 20 or 40 pages (BRIEF_LENGTH_PAGES). */
export const BRIEF_LENGTHS = ["short", "medium", "long"] as const;
export const BRIEF_LENGTH_PAGES: Record<(typeof BRIEF_LENGTHS)[number], number> = { short: 2, medium: 20, long: 40 };
export const BRIEF_TONES = ["formal", "plain", "engaging"] as const;
/** The optional free-text line: untrusted, fenced for the model (E2), never stored. */
export const BRIEF_NOTE_MAX = 500;
/** At most this many cards come back (the AI may only re-order the rule shortlist). */
export const TEMPLATE_SHORTLIST_MAX = 3;
/** report_ai_call.action for AT-1 (not a doc AI action, so not in AI_ACTIONS). */
export const TEMPLATE_SUGGEST_LOG_ACTION = "suggest_templates";

export const TemplateBriefSchema = z
  .object({
    purpose: z.enum(BRIEF_PURPOSES),
    /** Preset on the FE from what the company has switched on; must belong to `kind` (DS_VALIDATION). */
    frameworks: z.array(FrameworkCodeSchema).max(7).default([]),
    audience: z.enum(BRIEF_AUDIENCES),
    length: z.enum(BRIEF_LENGTHS),
    tone: z.enum(BRIEF_TONES).optional(),
    note: z.string().trim().max(BRIEF_NOTE_MAX).optional(),
  })
  .strict();
export type TemplateBrief = z.infer<typeof TemplateBriefSchema>;

/** POST /studio/templates/suggest. year/yearType/sites pick the approved data readiness is scored on. */
export const TemplateSuggestBodySchema = z
  .object({
    kind: ReportKindSchema,
    brief: TemplateBriefSchema,
    year: Year,
    yearType: YearTypeSchema.default("CY"),
    sites: SitesSchema.default("all"),
    /** Only templates in this format; absent = any format. */
    format: PageFormatSchema.optional(),
    company_id: CompanyId,
  })
  .strict();
export type TemplateSuggestBody = z.infer<typeof TemplateSuggestBodySchema>;

/** What a readiness badge counts. Counts only: never a figure. */
export const READINESS_BADGE_KEYS = ["scope12_months", "scope3_categories", "kpi_coverage", "targets", "base_year"] as const;
export type ReadinessBadgeKey = (typeof READINESS_BADGE_KEYS)[number];
export const READINESS_LEVELS = ["ready", "partial", "low"] as const;
export type ReadinessLevel = (typeof READINESS_LEVELS)[number];

export interface ReadinessBadge {
  key: ReadinessBadgeKey;
  /** Server-written, e.g. "Scope 3: 9 of 15 categories have data". */
  label: string;
  have: number;
  of: number;
  /** ok = all there; partial = some; missing = none. */
  status: "ok" | "partial" | "missing";
  /** Pages of this template that would print "Not reported" (or say why excluded) because of this gap. */
  notReportedPages: number;
  /** KPI coverage badges name their framework. */
  framework?: string;
}

export interface TemplateReadiness {
  /** 0..100: share of the template's data-bound pages that would have data. */
  score: number;
  level: ReadinessLevel;
  badges: ReadinessBadge[];
  /** Sum over the template's pages, not over badges (a page counts once). */
  notReportedPages: number;
}

export interface TemplateSuggestion {
  templateId: number;
  /** 1 = best fit. Rule order when aiUsed is false. */
  rank: number;
  /** The card's name, format, look, page count and thumbnail. */
  template: ReportTemplate;
  readiness: TemplateReadiness;
  /** 2–3 short reasons from the AI (guarded); [] when aiUsed is false. */
  reasons: string[];
  /** Page ids of the template's doc the AI suggests dropping (only ids the template has). */
  pagesToDrop: string[];
  /** Layout slugs (ReportLayout.slug, same family) the AI suggests adding. */
  pagesToAdd: string[];
}

export interface TemplateSuggestResponse {
  shortlist: TemplateSuggestion[];
  /** False when the AI was unavailable, over budget or its answer failed the guard twice: rule order, no reasons. */
  aiUsed: boolean;
  model: string | null;
  /** How many templates of the kind the rules looked at ("3 of 11 GHG templates"). */
  considered: number;
}

/**
 * What the model must return for AT-1 (zod → literal-number rule against the
 * offered counts → ids must be in the shortlist → one retry → rule order).
 */
export const TemplateSuggestModelOutputSchema = z
  .object({
    picks: z
      .array(
        z
          .object({
            templateId: z.number().int().positive(),
            reasons: z.array(z.string().trim().min(1).max(200)).min(1).max(3),
            pagesToDrop: z.array(Id).max(40).default([]),
            pagesToAdd: z.array(Id).max(20).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(TEMPLATE_SHORTLIST_MAX),
  })
  .strict();
export type TemplateSuggestModelOutput = z.infer<typeof TemplateSuggestModelOutputSchema>;

// ===========================================================================
// AT-2 · suggest layouts (DS-9 action) and try another template
// ===========================================================================

/** `suggest_layouts` always offers this many options for the target page. */
export const LAYOUT_OPTIONS_PER_PAGE = 3;
export const LAYOUT_OPTION_IDS = ["A", "B", "C"] as const;

/**
 * Suggestion (ai.ts) for `suggest_layouts`: kind 'pages', `payload.pages` holds
 * the 3 options as FreeformPages with the target page's id, and
 * `payload.layoutOptions[i]` describes `payload.pages[i]`.
 * Invariants the server checks before answering (and the FE before applying):
 *  - every element of the original page that carries a binding or data chips
 *    is in every option, with identical props (only frame/z may change);
 *  - text content is unchanged; no element is invented except library blocks
 *    from the named layout (dividers, shapes, placeholders);
 *  - each page re-validates with ElementSchema and the doc's format.
 * Apply = replace the page, one undo step ("AI: layout A").
 */
export const LayoutOptionMetaSchema = z
  .object({
    id: z.enum(LAYOUT_OPTION_IDS),
    name: z.string().trim().min(1).max(80),
    /** The library layout the option was built from (ReportLayout.slug). */
    layoutSlug: Id,
    /** Guarded text (no literal figures). */
    reason: z.string().trim().max(400),
    /** Original element ids placed by this option (all of them, per the invariant). */
    placedElementIds: z.array(Id).max(500),
  })
  .strict();
export type LayoutOptionMeta = z.infer<typeof LayoutOptionMetaSchema>;

/** What the model returns for `suggest_layouts`: it picks candidate layouts and maps element ids to their slots; the server builds the pages. */
export const SuggestLayoutsModelOutputSchema = z
  .object({
    options: z
      .array(
        z
          .object({
            layoutSlug: Id,
            name: z.string().trim().min(1).max(80),
            reason: z.string().trim().max(400),
            slots: z.array(z.object({ slot: Id, elementId: Id }).strict()).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(LAYOUT_OPTIONS_PER_PAGE),
  })
  .strict();
export type SuggestLayoutsModelOutput = z.infer<typeof SuggestLayoutsModelOutputSchema>;

/** POST /docs/:id/template-swap/preview and /apply. */
export const TemplateSwapBodySchema = z
  .object({
    templateId: z.number().int().positive(),
    /** The doc rev the preview was made from; a stale rev answers 409 DS_VERSION_CONFLICT {rev}. */
    rev: z.number().int().min(0),
    company_id: CompanyId,
  })
  .strict();
export type TemplateSwapBody = z.infer<typeof TemplateSwapBodySchema>;

/** apply also sends the preview's hash: the server rebuilds and answers 409 DS_VERSION_CONFLICT when it differs. */
export const TemplateSwapApplyBodySchema = TemplateSwapBodySchema.extend({ previewHash: z.string().min(1).max(128) }).strict();
export type TemplateSwapApplyBody = z.infer<typeof TemplateSwapApplyBodySchema>;

export const SWAP_PAGE_STATUSES = ["mapped", "kept", "added"] as const;
export type SwapPageStatus = (typeof SWAP_PAGE_STATUSES)[number];

export interface SwapPageMapping {
  pageId: string;
  fromLayoutId: string | null;
  /** null when no layout of the new template has the page's role: the page keeps its own layout ('kept'). */
  toLayoutId: string | null;
  status: SwapPageStatus;
}

/** An element the new layout has no slot for: it is kept on the page at its old frame, never dropped. */
export interface SwapUnplaced {
  pageId: string;
  elementId: string;
  reason: "no_slot" | "locked";
}

export interface TemplateSwapPreview {
  fromTemplateId: string;
  templateId: number;
  rev: number;
  /** The whole proposed ReportDoc (validated); text, chips, charts and bindings carried over unchanged. */
  doc: unknown;
  pages: SwapPageMapping[];
  unplaced: SwapUnplaced[];
  /** sha256 of the proposed doc; send it back to /apply. */
  previewHash: string;
}

// ===========================================================================
// PE-1 · background remover (server ONNX job, E1)
// ===========================================================================

/** The env var that names the segmentation model (u2net / u2netp / ISNet-style ONNX). Unset → 503 DS_BG_UNAVAILABLE. */
export const BG_MODEL_ENV = "STUDIO_BG_MODEL_PATH";
/** Model input side in px (square), single-channel mask output. */
export const BG_MODEL_INPUT_PX = 320;
/** Images whose source mime can be processed (SVG answers DS_ASSET_TYPE). */
export const BG_INPUT_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

export const IMAGE_JOB_KINDS = ["remove_background"] as const;
export type ImageJobKind = (typeof IMAGE_JOB_KINDS)[number];

/** POST /assets/:id/remove-background (no other fields). */
export const RemoveBackgroundBodySchema = z.object({ company_id: CompanyId }).strict();

/** POST /assets/:id/remove-background (202) and GET /image-jobs/:id. */
export interface ImageJob {
  id: number;
  kind: ImageJobKind;
  /** The source asset (kept). */
  assetId: string;
  status: JobStatus;
  /** The new derived PNG asset when done (StudioAsset.derivedFrom = {assetId, op}). */
  resultAssetId: string | null;
  errorCode: DsErrorCode | null;
  /** DS_JOB_FAILED details.reason: model | image | timeout | storage. */
  errorReason: string | null;
  createdAt: string;
  finishedAt: string | null;
}

// ===========================================================================
// PE-2 · custom brand fonts (E3) and find and replace (FE-only op)
// ===========================================================================

export const FONT_FILE_FORMATS = ["woff2", "ttf", "otf"] as const;
export type FontFileFormat = (typeof FONT_FILE_FORMATS)[number];
export const FONT_MAX_BYTES = 5 * 1024 * 1024;
export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export const FONT_STYLES = ["normal", "italic"] as const;
export type FontStyle = (typeof FONT_STYLES)[number];
export const FONT_FAMILY_MAX = 60;
/** Families per company. */
export const BRAND_FONTS_MAX = 20;
/**
 * Magic bytes the server checks (the file name and mime are not trusted):
 * woff2 "wOF2"; ttf 00 01 00 00 or "true"; otf "OTTO". Anything else → 415 DS_FONT_TYPE.
 */
export const FONT_MAGIC: Record<FontFileFormat, readonly string[]> = {
  woff2: ["774f4632"],
  ttf: ["00010000", "74727565"],
  otf: ["4f54544f"],
};

/**
 * Multipart fields next to `file` (one file per request). A file for a family
 * the company already has joins it; the same weight + style again → 409
 * DS_FONT_EXISTS. `licenceConfirmed` must be "true" (else 422 DS_FONT_LICENCE);
 * the server stores who and when.
 */
export const FontUploadFieldsSchema = z
  .object({
    family: z.string().trim().min(1, "Name the font family").max(FONT_FAMILY_MAX).regex(/^[^"'<>;{}\\]*$/, "A font name can't contain quotes, < > ; { } or \\"),
    weight: z.coerce.number().int().refine((w) => (FONT_WEIGHTS as readonly number[]).includes(w), "Weight is 100, 200 … 900").default(400),
    style: z.enum(FONT_STYLES).default("normal"),
    licenceConfirmed: z.preprocess((v) => v === true || v === "true", z.boolean()),
    company_id: CompanyId,
  })
  .passthrough();
export type FontUploadFields = z.infer<typeof FontUploadFieldsSchema>;

export interface BrandFontFile {
  /** The stored file's id (studio asset storage, not a report image asset). */
  assetId: string;
  weight: number;
  style: FontStyle;
  format: FontFileFormat;
  bytes: number;
  /** GET /studio/brand-kit/fonts/:id/files/:assetId (the editor's @font-face src). */
  url: string;
}

/** One uploaded family. In docs it is referenced as `custom:<id>` (proProps FontRef). */
export interface BrandFont {
  id: number;
  /** `custom:<id>` */
  ref: string;
  family: string;
  weights: number[];
  styles: FontStyle[];
  assetIds: string[];
  files: BrandFontFile[];
  licenceConfirmedBy: number;
  licenceConfirmedAt: string;
  createdAt: string;
}
export interface BrandFontsResponse {
  fonts: BrandFont[];
  /** Manager or Superadmin: may upload and delete. */
  canEdit: boolean;
}
