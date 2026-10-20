/**
 * Design Studio contracts (DS-0) §1: enums. Copied from
 * docs/design-studio/01-contracts.md §1 and the RS base
 * (docs/design-studio/rs-base/01-contracts.md §1) it extends.
 *
 * Changed only by a DS-0 follow-up; every module imports from here and never
 * redefines a value. The FE mirror is ESG-lite_FE src/lib/studio/contracts.ts,
 * kept in step by ci/studio-contracts.json (see scripts/studio-contracts-snapshot.cjs).
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Report kinds, formats and purposes (DS §1)
// ---------------------------------------------------------------------------

/** `ghg` needs only the studio switch; `sustainability` also needs KPI tracking (D4). */
export const REPORT_KINDS = ["ghg", "sustainability"] as const;
export const ReportKindSchema = z.enum(REPORT_KINDS);
export type ReportKind = z.infer<typeof ReportKindSchema>;

/** One format per doc (D18). Sizes: PAGE_FORMAT_SIZES below (DS-1 render/formats.ts must agree). */
export const PAGE_FORMATS = ["a4", "a4_landscape", "letter", "a5", "slide_16_9", "square", "social_191"] as const;
export const PageFormatSchema = z.enum(PAGE_FORMATS);
export type PageFormat = z.infer<typeof PageFormatSchema>;

/**
 * Page size in millimetres and the bleed the format prints with (DS-1 §1:
 * 3 mm for print formats, 0 for screen formats). The schema uses it to keep
 * frames on the page. DS-1's `render/formats.ts` owns safe margins and must
 * keep these sizes (its unit test compares them).
 */
export const PAGE_FORMAT_SIZES: Record<PageFormat, { wMm: number; hMm: number; bleedMm: number }> = {
  a4: { wMm: 210, hMm: 297, bleedMm: 3 },
  a4_landscape: { wMm: 297, hMm: 210, bleedMm: 3 },
  letter: { wMm: 215.9, hMm: 279.4, bleedMm: 3 },
  a5: { wMm: 148, hMm: 210, bleedMm: 3 },
  slide_16_9: { wMm: 338.7, hMm: 190.5, bleedMm: 0 },
  square: { wMm: 285.75, hMm: 285.75, bleedMm: 0 },
  social_191: { wMm: 317.5, hMm: 166.1, bleedMm: 0 },
};

/** Set by templates and by Resize (DS-10). */
export const DOC_PURPOSES = ["report", "summary", "deck", "social"] as const;
export const DocPurposeSchema = z.enum(DOC_PURPOSES);
export type DocPurpose = z.infer<typeof DocPurposeSchema>;

// ---------------------------------------------------------------------------
// Document status, versions, pages (RS §1, DS changes)
// ---------------------------------------------------------------------------

export const REPORT_STATUSES = ["draft", "in_review", "approved", "final"] as const;
export const ReportStatusSchema = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

/** DS §3: `autosave` added for version history (DS-5, DS-13). */
export const VERSION_KINDS = ["snapshot", "review", "final", "autosave"] as const;
export const VersionKindSchema = z.enum(VERSION_KINDS);
export type VersionKind = z.infer<typeof VersionKindSchema>;

export const PAGE_KINDS = ["freeform", "flow"] as const;
export const PageKindSchema = z.enum(PAGE_KINDS);
export type PageKind = z.infer<typeof PageKindSchema>;

/** RS flow types plus the GHG ones (DS-1 §7). */
export const FLOW_TYPES = [
  "toc",
  "narrative",
  "data_tables",
  "gri_index",
  "brsr_index",
  "esrs_index",
  "methodology",
  "glossary",
  "ghgp_index",
  "iso_index",
  "ghg_factor_table",
  "scope3_categories",
] as const;
export const FlowTypeSchema = z.enum(FLOW_TYPES);
export type FlowType = z.infer<typeof FlowTypeSchema>;

export const LAYOUT_KINDS = [
  "cover",
  "contents",
  "leadership",
  "about",
  "highlights",
  "chapter_opener",
  "data_page",
  "targets",
  "materiality",
  "people",
  "quote",
  "back_cover",
  "blank",
] as const;
export const LayoutKindSchema = z.enum(LAYOUT_KINDS);
export type LayoutKind = z.infer<typeof LayoutKindSchema>;

/** RS element types plus the DS ones (frame: an image mask; grid: a photo collage of n frames). */
export const ELEMENT_TYPES = [
  "text",
  "kpi_tile",
  "chart",
  "table",
  "image",
  "shape",
  "icon",
  "sdg",
  "divider",
  "page_number",
  "placeholder",
  "frame",
  "grid",
  "line",
  "big_number",
  "progress",
  "callout",
  "qr",
] as const;
export const ElementTypeSchema = z.enum(ELEMENT_TYPES);
export type ElementType = z.infer<typeof ElementTypeSchema>;

/** RS chart kinds plus the GHG ones (renderers in DS-8). */
export const CHART_KINDS = [
  "stacked_bar",
  "bar",
  "line",
  "donut",
  "share_bar",
  "waterfall",
  "sankey",
  "target_bars",
  "dot_grid",
  "materiality_matrix",
  "sparkline",
  "scope_split",
  "category_bars",
  "gas_split",
  "site_bars",
  "monthly_stack",
  "base_year_waterfall",
  "intensity_line",
  "treemap",
] as const;
export const ChartKindSchema = z.enum(CHART_KINDS);
export type ChartKind = z.infer<typeof ChartKindSchema>;

export const ELEMENT_SOURCES = ["layout", "auto", "ai", "user"] as const;
export const ElementSourceSchema = z.enum(ELEMENT_SOURCES);
export type ElementSource = z.infer<typeof ElementSourceSchema>;

export const TEXT_STYLE_IDS = ["kicker", "title", "heading", "subheading", "body", "caption", "big_number", "quote", "footnote"] as const;
export const TextStyleIdSchema = z.enum(TEXT_STYLE_IDS);
export type TextStyleId = z.infer<typeof TextStyleIdSchema>;

export const MEASURES = ["value", "change_abs", "change_pct", "share", "progress", "target", "baseline"] as const;
export const MeasureSchema = z.enum(MEASURES);
export type Measure = z.infer<typeof MeasureSchema>;

/** 'current' | 'prior' | 'base' | a year. */
export const YEAR_REF_WORDS = ["current", "prior", "base"] as const;
export const YearRefSchema = z.union([z.enum(YEAR_REF_WORDS), z.number().int().min(1990).max(2100)]);
export type YearRef = z.infer<typeof YearRefSchema>;

/** Same values as Brand.default_look. */
export const LOOKS = ["classic", "light", "night"] as const;
export const LookSchema = z.enum(LOOKS);
export type Look = z.infer<typeof LookSchema>;

/** R12: the bundled OFL fonts. */
export const FONT_IDS = [
  "source-serif-4",
  "source-sans-3",
  "dm-serif-display",
  "ibm-plex-sans",
  "ibm-plex-serif",
  "archivo",
  "fraunces",
  "noto-sans",
] as const;
export const FontIdSchema = z.enum(FONT_IDS);
export type FontId = z.infer<typeof FontIdSchema>;

export const NUMBER_FORMATS = ["auto", "int", "1dp", "2dp", "pct0", "pct1", "compact", "indian"] as const;
export const NumberFormatSchema = z.enum(NUMBER_FORMATS);
export type NumberFormat = z.infer<typeof NumberFormatSchema>;

export const YEAR_TYPES = ["CY", "FY"] as const;
export const YearTypeSchema = z.enum(YEAR_TYPES);
export type YearType = z.infer<typeof YearTypeSchema>;

// ---------------------------------------------------------------------------
// Frameworks a doc reports against (meta.frameworks)
// ---------------------------------------------------------------------------

/** Sustainability kind: the KPI frameworks (src/kpi/contracts FRAMEWORK_CODES). */
export const SUSTAINABILITY_FRAMEWORKS = ["GRI", "BRSR", "ESRS"] as const;
/** GHG kind. */
export const GHG_FRAMEWORKS = ["GHGP", "ISO14064", "BRSR_P6", "ESRS_E1"] as const;
export const FRAMEWORK_CODES = [...SUSTAINABILITY_FRAMEWORKS, ...GHG_FRAMEWORKS] as const;
export const FrameworkCodeSchema = z.enum(FRAMEWORK_CODES);
export type FrameworkCode = z.infer<typeof FrameworkCodeSchema>;
export const FRAMEWORKS_BY_KIND: Record<ReportKind, readonly FrameworkCode[]> = {
  ghg: GHG_FRAMEWORKS,
  sustainability: SUSTAINABILITY_FRAMEWORKS,
};

// ---------------------------------------------------------------------------
// Downloads, jobs, approvals (DS §1)
// ---------------------------------------------------------------------------

export const DOWNLOAD_KINDS = ["pdf_screen", "pdf_print", "png_pages"] as const;
export const DownloadKindSchema = z.enum(DOWNLOAD_KINDS);
export type DownloadKind = z.infer<typeof DownloadKindSchema>;

export const JOB_KINDS = ["proof", "final", "thumbnail", "png", "print"] as const;
export const JobKindSchema = z.enum(JOB_KINDS);
export type JobKind = z.infer<typeof JobKindSchema>;

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export const JobStatusSchema = z.enum(JOB_STATUSES);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const APPROVAL_STATES = ["none", "requested", "approved", "changes_requested"] as const;
export const ApprovalStateSchema = z.enum(APPROVAL_STATES);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export const CHECK_SEVERITIES = ["error", "warning", "info"] as const;
export const CheckSeveritySchema = z.enum(CHECK_SEVERITIES);
export type CheckSeverity = z.infer<typeof CheckSeveritySchema>;

/** Preview and render modes (DS-1 §2; `present` has no job, DS-11). */
export const RENDER_MODES = ["sheet", "paged", "present", "print"] as const;
export const RenderModeSchema = z.enum(RENDER_MODES);
export type RenderMode = z.infer<typeof RenderModeSchema>;

// ---------------------------------------------------------------------------
// Roles (01-contracts §4): R = Admin, Manager, Superadmin; M = Manager, Superadmin.
// Users get 403 DS_ROLE.
// ---------------------------------------------------------------------------

export const STUDIO_EDITOR_ROLES = ["Admin", "Manager", "Superadmin"] as const;
export const STUDIO_MANAGER_ROLES = ["Manager", "Superadmin"] as const;
export const STUDIO_ROLE_CLASSES = ["R", "M"] as const;
export type StudioRoleClass = (typeof STUDIO_ROLE_CLASSES)[number];

// ---------------------------------------------------------------------------
// Style presets (DS §1, DS-3)
// ---------------------------------------------------------------------------

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #1A2B3C");

/** `palette`: [primary, accent, ink, surface, muted]. */
export const StylePresetSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  palette: z.tuple([HexColorSchema, HexColorSchema, HexColorSchema, HexColorSchema, HexColorSchema]),
  fonts: z.object({ heading: FontIdSchema, body: FontIdSchema }),
});
export type StylePreset = z.infer<typeof StylePresetSchema>;

/** Every enum list above, by exported name: the FE mirror check compares these (ci/studio-contracts.json). */
export const STUDIO_ENUMS = {
  REPORT_KINDS,
  PAGE_FORMATS,
  DOC_PURPOSES,
  REPORT_STATUSES,
  VERSION_KINDS,
  PAGE_KINDS,
  FLOW_TYPES,
  LAYOUT_KINDS,
  ELEMENT_TYPES,
  CHART_KINDS,
  ELEMENT_SOURCES,
  TEXT_STYLE_IDS,
  MEASURES,
  YEAR_REF_WORDS,
  LOOKS,
  FONT_IDS,
  NUMBER_FORMATS,
  YEAR_TYPES,
  SUSTAINABILITY_FRAMEWORKS,
  GHG_FRAMEWORKS,
  FRAMEWORK_CODES,
  DOWNLOAD_KINDS,
  JOB_KINDS,
  JOB_STATUSES,
  APPROVAL_STATES,
  CHECK_SEVERITIES,
  RENDER_MODES,
  STUDIO_EDITOR_ROLES,
  STUDIO_MANAGER_ROLES,
} as const;
