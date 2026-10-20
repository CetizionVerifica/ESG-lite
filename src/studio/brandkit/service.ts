/**
 * DS-3 · brand kit read and write (01-contracts §4).
 *
 *   GET /studio/brand-kit     R → BrandKit: logos and colours from `brand`, the brand fonts and
 *                             voice, palettes (sort order) each with a contrast report
 *   PUT /studio/brand-kit     M → BrandKit: saves fonts, voice and/or palettes (the list replaces
 *                             the stored one; order = sort). Logos and brand colours stay
 *                             Superadmin-only through /brands.
 *   GET /studio/styles?kind=  R → StylePreset[] (styles.ts)
 *
 * Tenant: everything is keyed by the caller's company (requireDesignStudio).
 * A palette id that isn't the company's answers 404 DS_DOC_NOT_FOUND.
 * A company without a `brand` row reads the /brands defaults; the first PUT
 * creates the row with those defaults and the company name.
 * Every PUT writes an audit_log row (`brand_kit`, action `update`) with the
 * changed parts, in the same transaction.
 */
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import { BrandKitUpdateSchema, DsError, FONT_IDS, LOOKS, type BrandKit, type BrandKitUpdate, type FontId, type Look, type StylePreset } from "../contracts";
import { assertKind, type StudioCaller } from "../guard";
import { parse } from "../http";
import { normalizeHex, paletteContrast } from "./contrast";
import { buildStyles, type StyleSource } from "./styles";

type Row = Record<string, any>;

export const BRAND_KIT_AUDIT_ENTITY = "brand_kit";

/** /brands defaults (brand.controller loadBrandOrDefaults). */
const BRAND_DEFAULTS = { primary: "#1f2a44", accent: "#3b82f6", coverFrom: "#0d1526", coverTo: "#1f2a44" };

const asFont = (v: unknown): FontId | null => ((FONT_IDS as readonly unknown[]).includes(v) ? (v as FontId) : null);
const asLook = (v: unknown): Look => ((LOOKS as readonly unknown[]).includes(v) ? (v as Look) : "classic");
const hexOr = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback);

interface Loaded {
  company: Row;
  brand: Row | null;
  palettes: { id: number; name: string; colors: string[]; sort: number }[];
}

async function load(m: EntityManager, companyId: number): Promise<Loaded> {
  // to_jsonb reads company.brand_controls (DS-13) whether or not that column exists yet.
  const [company] = await m.query(`SELECT name, (to_jsonb(c) ->> 'brand_controls') = 'true' AS brand_controls FROM company c WHERE company_id = $1`, [companyId]);
  if (!company) throw new DsError("DS_DOC_NOT_FOUND");
  const [brand] = await m.query(
    `SELECT name, "primary", accent, cover_from, cover_to, logo_url, logo_on_dark_url, default_look, font_heading, font_body, voice, updated_at FROM brand WHERE company_id = $1`,
    [companyId],
  );
  const rows: Row[] = await m.query(`SELECT id, name, colors, sort FROM brand_palette WHERE company_id = $1 ORDER BY sort, id`, [companyId]);
  return { company, brand: brand ?? null, palettes: rows.map((r) => ({ id: Number(r.id), name: r.name, colors: r.colors as string[], sort: Number(r.sort) })) };
}

function toKit(caller: StudioCaller, { company, brand, palettes }: Loaded): BrandKit {
  return {
    name: brand?.name ?? company.name,
    logos: { primary: brand?.logo_url ?? null, onDark: brand?.logo_on_dark_url ?? null },
    colors: {
      primary: hexOr(brand?.primary, BRAND_DEFAULTS.primary),
      accent: hexOr(brand?.accent, BRAND_DEFAULTS.accent),
      coverFrom: hexOr(brand?.cover_from, BRAND_DEFAULTS.coverFrom),
      coverTo: hexOr(brand?.cover_to, BRAND_DEFAULTS.coverTo),
    },
    defaultLook: asLook(brand?.default_look),
    fonts: { heading: asFont(brand?.font_heading), body: asFont(brand?.font_body) },
    voice: brand?.voice ?? "",
    palettes: palettes.map((p) => ({ ...p, contrast: paletteContrast(p.colors) })),
    canEdit: caller.roleClass === "M",
    brandControls: company.brand_controls === true,
    updatedAt: brand?.updated_at ? new Date(brand.updated_at).toISOString() : null,
  };
}

export async function getBrandKit(caller: StudioCaller): Promise<BrandKit> {
  return toKit(caller, await load(AppDataSource.manager, caller.companyId));
}

/** The brand row exists (the /brands defaults and the company name), so fonts and voice have a home. */
async function ensureBrandRow(m: EntityManager, companyId: number, companyName: string) {
  await m.query(
    `INSERT INTO brand (company_id, name, "primary", accent, cover_from, cover_to) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (company_id) DO NOTHING`,
    [companyId, companyName, BRAND_DEFAULTS.primary, BRAND_DEFAULTS.accent, BRAND_DEFAULTS.coverFrom, BRAND_DEFAULTS.coverTo],
  );
}

export async function putBrandKit(caller: StudioCaller, body: unknown): Promise<BrandKit> {
  if (caller.roleClass !== "M") throw new DsError("DS_ROLE");
  const input: BrandKitUpdate = parse(BrandKitUpdateSchema, body ?? {});
  return AppDataSource.transaction(async (m) => {
    const before = await load(m, caller.companyId);
    const changed: Record<string, unknown> = {};

    if (input.fonts || input.voice !== undefined) {
      await ensureBrandRow(m, caller.companyId, before.company.name);
      if (input.fonts) {
        await m.query(`UPDATE brand SET font_heading = $2, font_body = $3, updated_at = now() WHERE company_id = $1`, [caller.companyId, input.fonts.heading, input.fonts.body]);
        changed.fonts = { old: { heading: before.brand?.font_heading ?? null, body: before.brand?.font_body ?? null }, new: input.fonts };
      }
      if (input.voice !== undefined) {
        await m.query(`UPDATE brand SET voice = $2, updated_at = now() WHERE company_id = $1`, [caller.companyId, input.voice]);
        changed.voice = { oldLength: (before.brand?.voice ?? "").length, newLength: input.voice.length };
      }
    }

    if (input.palettes) {
      const owned = new Set(before.palettes.map((p) => p.id));
      for (const p of input.palettes) if (p.id !== undefined && !owned.has(p.id)) throw new DsError("DS_DOC_NOT_FOUND");
      const keep = new Set(input.palettes.map((p) => p.id).filter((id): id is number => id !== undefined));
      const removed = before.palettes.filter((p) => !keep.has(p.id)).map((p) => p.id);
      if (removed.length) await m.query(`DELETE FROM brand_palette WHERE company_id = $1 AND id = ANY($2::int[])`, [caller.companyId, removed]);
      for (const [sort, p] of input.palettes.entries()) {
        const colors = JSON.stringify(p.colors.map(normalizeHex));
        if (p.id !== undefined) {
          await m.query(`UPDATE brand_palette SET name = $3, colors = $4::jsonb, sort = $5, updated_at = now() WHERE company_id = $1 AND id = $2`, [caller.companyId, p.id, p.name, colors, sort]);
        } else {
          await m.query(`INSERT INTO brand_palette (company_id, name, colors, sort) VALUES ($1, $2, $3::jsonb, $4)`, [caller.companyId, p.name, colors, sort]);
        }
      }
      changed.palettes = { old: before.palettes.length, new: input.palettes.length, removed };
    }

    if (Object.keys(changed).length) {
      await m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, 'update', $3, NULL, $4)`, [
        BRAND_KIT_AUDIT_ENTITY,
        caller.companyId,
        JSON.stringify(changed),
        caller.userId || null,
      ]);
    }
    return toKit(caller, await load(m, caller.companyId));
  });
}

export async function listStyles(caller: StudioCaller, query: Record<string, unknown>): Promise<StylePreset[]> {
  const kind = assertKind(caller, query.kind);
  const kit = await getBrandKit(caller);
  const src: StyleSource = { name: kit.name, colors: kit.colors, fonts: kit.fonts, palettes: kit.palettes };
  return buildStyles(src, kind);
}
