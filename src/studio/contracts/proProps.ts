/**
 * PRO-0 · element props for Pro editing (docs/design-studio/pro/
 * 01-pro-editing-and-ai-templates.md, modules PE-1 and PE-2). schema.ts adds
 * them to the image, frame and text props; everything is optional, so every
 * doc saved before PRO-0 stays valid and renders exactly as before.
 *
 * Units are the editor's slider units (integers), not CSS: the shared renderer
 * (src/reporting/studio/render/) maps them to SVG/CSS filters the same way in
 * the editor, Page view, PNG and both PDFs. The mapping belongs to the module
 * that renders the effect (PE-1 images, PE-2 text) and is pinned by a DS golden.
 *
 * Transparency is NOT new: every element already has `opacity` (0..1, DS-6),
 * which the renderer applies to the element box in every mode. The Pro
 * toolbar shows it as 0..100 % and writes `opacity = percent / 100`.
 *
 * This file imports enums only (schema.ts imports it).
 */
import { z } from "zod";
import { FontIdSchema, HexColorSchema } from "./enums";

const Int = (min: number, max: number) => z.number().int().min(min).max(max);

// ---------------------------------------------------------------------------
// PE-1 · photo adjustments, filter presets, brand duotone, background removal
// ---------------------------------------------------------------------------

/** Filter presets (applied before `adjust`). `none` = no preset. */
export const IMAGE_FILTERS = ["none", "vivid", "mono", "warm", "cool", "fade"] as const;
export const ImageFilterSchema = z.enum(IMAGE_FILTERS);
export type ImageFilter = z.infer<typeof ImageFilterSchema>;

/** The adjustment sliders, in order. All but blur run -100..100 (0 = unchanged); blur 0..100. */
export const IMAGE_ADJUST_KEYS = ["brightness", "contrast", "saturation", "warmth", "blur"] as const;
export type ImageAdjustKey = (typeof IMAGE_ADJUST_KEYS)[number];
export const IMAGE_ADJUST_RANGE: Record<ImageAdjustKey, readonly [number, number]> = {
  brightness: [-100, 100],
  contrast: [-100, 100],
  saturation: [-100, 100],
  warmth: [-100, 100],
  blur: [0, 100],
};

/** Each key is optional and 0 when absent; an all-zero object renders like no object. */
export const ImageAdjustSchema = z
  .object({
    brightness: Int(-100, 100).optional(),
    contrast: Int(-100, 100).optional(),
    saturation: Int(-100, 100).optional(),
    warmth: Int(-100, 100).optional(),
    blur: Int(0, 100).optional(),
  })
  .strict();
export type ImageAdjust = z.infer<typeof ImageAdjustSchema>;

/** Duotone: shadows map to `dark`, highlights to `light` (the FE offers brand kit colours first). */
export const DuotoneSchema = z.object({ dark: HexColorSchema, light: HexColorSchema }).strict();
export type Duotone = z.infer<typeof DuotoneSchema>;

/**
 * Added to ImageProps and FrameProps.
 *  adjust          sliders (above)
 *  filter          preset; absent = 'none'
 *  duotone         null or absent = off; applied after filter and adjust
 *  originalAssetId set when `assetId` is a derived asset (background removed,
 *                  PE-1). "Restore original" puts it back in `assetId` and
 *                  removes the field. The derived asset records its source in
 *                  StudioAsset.derivedFrom; the original is never deleted by it.
 */
export const imageEditProps = {
  adjust: ImageAdjustSchema.optional(),
  filter: ImageFilterSchema.optional(),
  duotone: DuotoneSchema.nullable().optional(),
  originalAssetId: z.string().min(1).max(120).optional(),
};

// ---------------------------------------------------------------------------
// PE-2 · text effects and custom fonts
// ---------------------------------------------------------------------------

/** The Effects panel, in its order. Shadow and lift exclude each other (lift is a soft shadow preset). */
export const TEXT_EFFECTS = ["shadow", "lift", "outline", "highlight", "curve"] as const;
export type TextEffectKind = (typeof TEXT_EFFECTS)[number];

/**
 *  shadow     blur 0..100, offsetX/offsetY -100..100, colour, opacity 0..100
 *  lift       intensity 0..100
 *  outline    width 0..100 (slider; the renderer maps it to a stroke width), colour
 *  highlight  colour (behind each line of text), radius 0..100 (corner rounding)
 *  curve      radius -100..100: 0 = straight, > 0 arcs upward, < 0 downward
 */
export const TextEffectsSchema = z
  .object({
    shadow: z
      .object({ blur: Int(0, 100), offsetX: Int(-100, 100), offsetY: Int(-100, 100), colour: HexColorSchema, opacity: Int(0, 100) })
      .strict()
      .optional(),
    lift: z.object({ intensity: Int(0, 100) }).strict().optional(),
    outline: z.object({ width: Int(0, 100), colour: HexColorSchema }).strict().optional(),
    highlight: z.object({ colour: HexColorSchema, radius: Int(0, 100) }).strict().optional(),
    curve: z.object({ radius: Int(-100, 100) }).strict().optional(),
  })
  .strict()
  .refine((e) => !(e.shadow && e.lift), { message: "Use shadow or lift, not both", path: ["lift"] });
export type TextEffects = z.infer<typeof TextEffectsSchema>;

/** A custom (uploaded) brand font in a doc: `custom:<BrandFont.id>`. */
export const CUSTOM_FONT_PREFIX = "custom:";
export const CustomFontRefSchema = z.string().regex(/^custom:[1-9][0-9]{0,9}$/, "A custom font is custom:<id>");
export type CustomFontRef = `custom:${number}`;
/** A bundled font id (R12) or an uploaded brand font. */
export const FontRefSchema = z.union([FontIdSchema, CustomFontRefSchema]);
export type FontRef = z.infer<typeof FontRefSchema>;

/**
 * Added to TextProps.
 *  effects  all optional; absent = plain text
 *  font     overrides the text style's font for this box (bundled or `custom:<id>`).
 *           A custom font that was deleted from the brand kit falls back to the
 *           style's font (finals keep the PDF they were made with).
 */
export const textEditProps = {
  effects: TextEffectsSchema.optional(),
  font: FontRefSchema.optional(),
};
