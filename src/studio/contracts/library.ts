/**
 * DS-4 · template and element library shapes (01-contracts §3 `report_template`,
 * `report_layout`, `report_element`, `report_asset`; §4 `/templates`,
 * `/layouts`, `/elements`, `/assets`). The FE mirror is `ReportTemplate`,
 * `ReportLayout`, `ElementTemplate` and `StudioAsset` in ESG-lite_FE
 * src/lib/studio/contracts.ts (DS-0 "mock shapes", confirmed here with the
 * fields marked DS-4).
 */
import { z } from "zod";
import { LAYOUT_KINDS, LOOKS, PAGE_FORMATS, REPORT_KINDS, type DocPurpose, type LayoutKind, type Look, type PageFormat, type ReportKind } from "./enums";
import type { Element, FreeformPage, ReportDoc } from "./schema";

/** The Elements drawer groups (05-ux rail tab "Elements"). */
export const ELEMENT_GROUPS = ["shapes", "lines", "frames", "grids", "icons", "sdg", "esg", "data"] as const;
export const ElementGroupSchema = z.enum(ELEMENT_GROUPS);
export type ElementGroup = z.infer<typeof ElementGroupSchema>;

/** Uploads: jpg, png, webp (re-encoded, EXIF stripped) and svg (sanitised), up to 10 MB. */
export const ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const ASSET_MIMES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"] as const;
export type AssetMime = (typeof ASSET_MIMES)[number];
export const ASSET_FOLDER_MAX = 60;

/** GET /templates and the list part of GET /templates/:id. */
export interface ReportTemplate {
  id: number;
  companyId: number | null;
  kind: ReportKind;
  purpose: DocPurpose;
  format: PageFormat;
  name: string;
  tags: string[];
  version: number;
  thumbnailUrl: string | null;
  pageCount: number;
  /** DS-4: `<family>-<look>`, stable across environments (doc.design.templateId). */
  slug: string;
  /** DS-4: the template the looks share (layouts belong to it). */
  family: string;
  /** DS-4: Classic, Light or Night (D9); null for company templates. */
  look: Look | null;
  /** DS-4: one line for the gallery card. */
  description: string;
}
export interface ReportTemplateDetail extends ReportTemplate {
  /** A full ReportDoc with placeholders ({{title}}, {{year}}, {{period}}, {{company}}) and bindings relative to the doc's year. */
  doc: ReportDoc;
}

/** GET /layouts: one page to add, or what applyTemplate maps pages onto. */
export interface ReportLayout {
  id: number;
  companyId: number | null;
  kind: ReportKind;
  format: PageFormat;
  pageKind: LayoutKind;
  name: string;
  thumbnailUrl: string | null;
  /** A FreeformPage whose id is the layout's role and whose element ids are `<role>.<slot>`. */
  page: FreeformPage;
  /** DS-4: `<family>/<role>`, the value of FreeformPage.layoutId. */
  slug: string;
  /** DS-4: the template family it belongs to. */
  family: string;
  /** DS-4: what the page is for (`scope1`, `exec_summary`, `cover`…); applyTemplate maps by it first. */
  role: string;
  sort: number;
}

/** An editable group (ESG graphics): elements share a groupId when inserted. Frames are relative to the group's box. */
export interface ElementGroupPayload {
  type: "group";
  w: number;
  h: number;
  elements: Element[];
}
export type ElementPayload = Element | ElementGroupPayload;

/** GET /elements. `payload` is an Element template at x = y = 0 (ids are replaced on insert). */
export interface ElementTemplate {
  id: number;
  companyId: number | null;
  group: ElementGroup;
  name: string;
  tags: string[];
  payload: ElementPayload;
  /** The licence id, listed in data/studio/LICENSES.md. */
  license: string;
}

/** POST/GET /assets (AssetRef + storage fields). */
export interface StudioAsset {
  id: string;
  kind: "image" | "logo" | "ai_image";
  w: number;
  h: number;
  alt: string;
  folder: string | null;
  /** Where the page loads it from: the R2 public URL, or /studio/assets/:id/file without R2. */
  url: string;
  bytes: number;
  mime: string;
  /** DS-4 */
  sha256: string;
  createdAt: string;
  /** PRO-0 (PE-1): set on a derived asset (background removed); the source asset is kept. */
  derivedFrom?: { assetId: string; op: "remove_background" } | null;
}

const csv = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const Q = z.preprocess(csv, z.string().max(100).optional());

export const TemplatesQuerySchema = z
  .object({
    kind: z.preprocess(csv, z.enum(REPORT_KINDS).optional()),
    format: z.preprocess(csv, z.enum(PAGE_FORMATS).optional()),
    look: z.preprocess(csv, z.enum(LOOKS).optional()),
    q: Q,
    tag: Q,
  })
  .passthrough();
export const LayoutsQuerySchema = z
  .object({
    kind: z.preprocess(csv, z.enum(REPORT_KINDS).optional()),
    format: z.preprocess(csv, z.enum(PAGE_FORMATS).optional()),
    pageKind: z.preprocess(csv, z.enum(LAYOUT_KINDS).optional()),
    /** A template family (`ghg-inventory`) or slug (`ghg-inventory-night`). */
    template: z.preprocess(csv, z.string().max(120).optional()),
    q: Q,
  })
  .passthrough();
export const ElementsQuerySchema = z
  .object({
    group: z.preprocess(csv, ElementGroupSchema.optional()),
    q: Q,
  })
  .passthrough();

const Folder = z
  .string()
  .trim()
  .max(ASSET_FOLDER_MAX)
  .regex(/^[^/\\<>]*$/, "A folder name can't contain / \\ < or >");
export const AssetsQuerySchema = z.object({ folder: z.preprocess(csv, Folder.optional()) }).passthrough();
/** Multipart fields next to `file`. */
export const AssetUploadFieldsSchema = z
  .object({
    folder: z.preprocess(csv, Folder.optional()),
    alt: z.preprocess(csv, z.string().max(500).optional()),
  })
  .passthrough();
/** PATCH /assets/:id: move to a folder (null = none) or change the alt text. */
export const AssetPatchSchema = z
  .object({
    folder: z.preprocess((v) => (v === "" ? null : v), Folder.nullable().optional()),
    alt: z.string().max(500).optional(),
    company_id: z.unknown().optional(),
  })
  .strict();
/** POST /assets/generate: AI cover art (RS R13), saved as kind `ai_image`. */
export const AssetGenerateSchema = z
  .object({
    prompt: z.string().trim().min(3, "Describe the image").max(1000),
    folder: z.preprocess(csv, Folder.optional()),
    company_id: z.unknown().optional(),
  })
  .strict();
