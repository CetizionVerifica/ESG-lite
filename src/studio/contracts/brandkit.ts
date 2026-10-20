/**
 * DS-3 · brand kit and styles shapes (01-contracts §4 `GET/PUT /brand-kit`,
 * `GET /styles`). The FE mirror is `BrandKit`, `BrandKitUpdate` and
 * `PaletteContrast` in ESG-lite_FE src/lib/studio/contracts.ts.
 */
import { z } from "zod";
import { FontIdSchema, HexColorSchema, type FontId, type Look, type ReportKind } from "./enums";
import type { BrandFont } from "./pro"; // PRO-0

export const BRAND_VOICE_MAX = 3000;
export const PALETTE_MAX_COLORS = 10;
export const PALETTES_MAX = 20;
export const PALETTE_NAME_MAX = 60;

/** WCAG thresholds the FE theme engine uses (src/theme/buildTheme.ts AA_TEXT, AA_UI). */
export const AA_TEXT = 4.5;
export const AA_UI = 3;

/** One colour pair of a palette: its WCAG ratio and what it may be used for. */
export interface PaletteContrast {
  a: string;
  b: string;
  ratio: number;
  /** ≥ 4.5:1, readable as body text. */
  text: boolean;
  /** ≥ 3:1, enough for large headings and graphics. */
  graphic: boolean;
}

export interface BrandPaletteDto {
  id: number;
  name: string;
  colors: string[];
  sort: number;
  /** Every pair of the palette's colours (n·(n−1)/2). */
  contrast: PaletteContrast[];
}

/** `GET /studio/brand-kit` and the answer to `PUT`. */
export interface BrandKit {
  name: string;
  /** From `brand` (Superadmin edits them through /brands). */
  logos: { primary: string | null; onDark: string | null };
  /** The brand's colours from `brand` (read-only here; /brands edits them). */
  colors: { primary: string; accent: string; coverFrom: string; coverTo: string };
  defaultLook: Look;
  fonts: { heading: FontId | null; body: FontId | null };
  voice: string;
  palettes: BrandPaletteDto[];
  /** Manager or Superadmin: may PUT. */
  canEdit: boolean;
  /** `company.brand_controls` (DS-13): colour pickers show brand palettes only, fonts the brand pair only. */
  brandControls: boolean;
  updatedAt: string | null;
  /** PRO-0 (PE-2): uploaded brand fonts (GET /brand-kit/fonts has the same list); absent until PE-2 fills it. */
  customFonts?: BrandFont[];
}

export const PaletteInputSchema = z
  .object({
    id: z.number().int().positive().optional(),
    name: z.string().trim().min(1, "Name the palette").max(PALETTE_NAME_MAX),
    colors: z.array(HexColorSchema).min(1, "Add at least one colour").max(PALETTE_MAX_COLORS, `At most ${PALETTE_MAX_COLORS} colours`),
  })
  .strict();

/** `PUT /studio/brand-kit`: each part is optional; `palettes` replaces the whole list (order = sort). */
export const BrandKitUpdateSchema = z
  .object({
    fonts: z.object({ heading: FontIdSchema.nullable(), body: FontIdSchema.nullable() }).strict().optional(),
    voice: z.string().max(BRAND_VOICE_MAX, `At most ${BRAND_VOICE_MAX} characters`).optional(),
    palettes: z.array(PaletteInputSchema).max(PALETTES_MAX, `At most ${PALETTES_MAX} palettes`).optional(),
    /** A Superadmin names the company; ignored for everyone else. */
    company_id: z.unknown().optional(),
  })
  .strict();
export type BrandKitUpdate = z.infer<typeof BrandKitUpdateSchema>;

export const StylesQuerySchema = z.object({ kind: z.enum(["ghg", "sustainability"]) }).passthrough();
export type StylesQuery = { kind: ReportKind };
