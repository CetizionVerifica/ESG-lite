/**
 * PE-2 · uploaded brand fonts (docs/design-studio/pro/PE-2.md, decision E3).
 *
 *   listBrandFonts(caller)            R  every family of the caller's company, with its files (no bytes)
 *   uploadBrandFont(caller, file, f)  M  one file per call; joins the family of the same name (case-blind)
 *   deleteBrandFont(caller, id)       M  the family and its files
 *   brandFontFile(caller, id, fileId) R  the bytes for the editor's FontFace
 *   renderFonts(companyId, refs)         the doc's `custom:<id>` fonts as data: URLs (server renders, PDF embedding)
 *
 * Validation: the bytes decide the format (FONT_MAGIC), never the name or the
 * header, plus a structural check of the sfnt table directory or the WOFF2
 * header, so a renamed file of another type is refused (415 DS_FONT_TYPE).
 * Over 5 MB → 413 DS_FONT_TOO_LARGE (multer stops reading first). The licence
 * tick is required (422 DS_FONT_LICENCE) and stored with who and when, per file.
 * Tenant: every query is keyed by the caller's company; another company's
 * font id answers 404. Fonts never go to the public asset bucket.
 */
import { createHash, randomUUID } from "crypto";
import type { EntityManager } from "typeorm";
import { AppDataSource } from "../../config/data-source";
import {
  BRAND_FONTS_MAX,
  DsError,
  FONT_MAGIC,
  FONT_MAX_BYTES,
  FontUploadFieldsSchema,
  type BrandFont,
  type BrandFontFile,
  type BrandFontsResponse,
  type FontFileFormat,
  type FontStyle,
} from "../contracts";
import type { StudioCaller } from "../guard";
import { parse, routeId } from "../http";
import type { RenderCustomFont } from "../../reporting/studio/render/types";

type Row = Record<string, any>;

export const BRAND_FONT_AUDIT_ENTITY = "brand_font";
export const FONT_MIME: Record<FontFileFormat, string> = { woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };

export interface UploadedFont {
  buffer: Buffer;
  originalname?: string;
  size?: number;
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

/** The font format from the first four bytes (FONT_MAGIC); null for anything else. */
export function fontFormat(buf: Buffer): FontFileFormat | null {
  if (buf.length < 12) return null;
  const head = buf.subarray(0, 4).toString("hex");
  for (const [format, magics] of Object.entries(FONT_MAGIC) as [FontFileFormat, readonly string[]][]) if (magics.includes(head)) return format;
  return null;
}

/** Why the bytes aren't a usable font of their format, or null. */
export function fontProblem(buf: Buffer, format: FontFileFormat): string | null {
  if (format === "woff2") {
    if (buf.length < 48) return "short WOFF2 header";
    if (buf.readUInt32BE(8) !== buf.length) return "WOFF2 length does not match the file";
    if (buf.readUInt16BE(12) < 1) return "WOFF2 without tables";
    return null;
  }
  const tables = buf.readUInt16BE(4);
  if (tables < 1 || tables > 200) return "table count out of range";
  if (buf.length < 12 + tables * 16) return "table directory runs past the file";
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16;
    const tag = buf.subarray(rec, rec + 4).toString("latin1");
    if (!/^[\x20-\x7e]{4}$/.test(tag)) return "unreadable table tag";
    const offset = buf.readUInt32BE(rec + 8);
    const length = buf.readUInt32BE(rec + 12);
    if (offset + length > buf.length) return `table ${tag.trim()} runs past the file`;
  }
  return null;
}

/** Validates an upload; returns its format. Throws DS_FONT_TOO_LARGE / DS_FONT_TYPE. */
export function checkFont(buf: Buffer): FontFileFormat {
  if (buf.length > FONT_MAX_BYTES) throw new DsError("DS_FONT_TOO_LARGE");
  const format = fontFormat(buf);
  if (!format) throw new DsError("DS_FONT_TYPE");
  const problem = fontProblem(buf, format);
  if (problem) throw new DsError("DS_FONT_TYPE", { reason: "UNREADABLE", what: problem });
  return format;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fileId = (v: unknown): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new DsError("DS_DOC_NOT_FOUND");
  return v.toLowerCase();
};

export const fontFileUrl = (fontId: number, id: string) => `/studio/brand-kit/fonts/${fontId}/files/${id}`;

const FILE_COLS = `id, font_id, weight, style, format, bytes, created_at`;
const iso = (d: unknown) => new Date(d as string).toISOString();

function toFont(f: Row, files: Row[]): BrandFont {
  const own = files.filter((x) => Number(x.font_id) === Number(f.id)).sort((a, b) => a.weight - b.weight || String(a.style).localeCompare(String(b.style)));
  const list: BrandFontFile[] = own.map((x) => ({ assetId: x.id, weight: Number(x.weight), style: x.style as FontStyle, format: x.format as FontFileFormat, bytes: Number(x.bytes), url: fontFileUrl(Number(f.id), x.id) }));
  return {
    id: Number(f.id),
    ref: `custom:${f.id}`,
    family: f.family,
    weights: [...new Set(list.map((x) => x.weight))],
    styles: [...new Set(list.map((x) => x.style))],
    assetIds: list.map((x) => x.assetId),
    files: list,
    licenceConfirmedBy: Number(f.licence_confirmed_by ?? 0),
    licenceConfirmedAt: iso(f.licence_confirmed_at),
    createdAt: iso(f.created_at),
  };
}

const tableMissing = (err: unknown) => /relation "brand_font(_file)?" does not exist/.test(String((err as Error)?.message));

/** The company's fonts (oldest first). [] while the PE-2 tables don't exist yet. */
export async function fontsOf(companyId: number, m: EntityManager = AppDataSource.manager): Promise<BrandFont[]> {
  try {
    const fonts: Row[] = await m.query(`SELECT id, family, licence_confirmed_by, licence_confirmed_at, created_at FROM brand_font WHERE company_id = $1 ORDER BY created_at, id`, [companyId]);
    if (!fonts.length) return [];
    const files: Row[] = await m.query(`SELECT ${FILE_COLS} FROM brand_font_file WHERE company_id = $1 ORDER BY weight, style`, [companyId]);
    return fonts.map((f) => toFont(f, files));
  } catch (err) {
    if (tableMissing(err)) return [];
    throw err;
  }
}

export async function listBrandFonts(caller: StudioCaller): Promise<BrandFontsResponse> {
  return { fonts: await fontsOf(caller.companyId), canEdit: caller.roleClass === "M" };
}

const audit = (m: EntityManager, caller: StudioCaller, id: number, action: string, changed: Record<string, unknown>) =>
  m.query(`INSERT INTO audit_log (entity_type, entity_id, action, changed_fields, reason, changed_by) VALUES ($1, $2, $3, $4, NULL, $5)`, [BRAND_FONT_AUDIT_ENTITY, id, action, JSON.stringify(changed), caller.userId || null]);

export async function uploadBrandFont(caller: StudioCaller, file: UploadedFont | undefined, fields: unknown): Promise<BrandFont> {
  if (caller.roleClass !== "M") throw new DsError("DS_ROLE");
  const f = parse(FontUploadFieldsSchema, fields ?? {});
  if (!file?.buffer?.length) throw new DsError("DS_VALIDATION", { issues: [{ path: "file", message: "Choose a font file to upload" }] });
  if (f.licenceConfirmed !== true) throw new DsError("DS_FONT_LICENCE");
  const format = checkFont(file.buffer);
  const family = f.family.trim();
  const key = family.toLowerCase();
  const sha256 = createHash("sha256").update(file.buffer).digest("hex");
  return AppDataSource.transaction(async (m) => {
    // One upload at a time per company, so the family limit and the unique face hold under races.
    await m.query(`SELECT pg_advisory_xact_lock(hashtext('brand_font'), $1)`, [caller.companyId]);
    let [font]: Row[] = await m.query(`SELECT id FROM brand_font WHERE company_id = $1 AND family_key = $2`, [caller.companyId, key]);
    if (!font) {
      const [{ n }]: Row[] = await m.query(`SELECT count(*)::int AS n FROM brand_font WHERE company_id = $1`, [caller.companyId]);
      if (n >= BRAND_FONTS_MAX) throw new DsError("DS_VALIDATION", { issues: [{ path: "family", message: `A brand kit can hold up to ${BRAND_FONTS_MAX} font families` }] });
      [font] = await m.query(`INSERT INTO brand_font (company_id, family, family_key, licence_confirmed_by, licence_confirmed_at, created_by) VALUES ($1, $2, $3, $4, now(), $4) RETURNING id`, [
        caller.companyId,
        family,
        key,
        caller.userId || null,
      ]);
    }
    const fontId = Number(font.id);
    const [dupe]: Row[] = await m.query(`SELECT 1 FROM brand_font_file WHERE font_id = $1 AND weight = $2 AND style = $3`, [fontId, f.weight, f.style]);
    if (dupe) throw new DsError("DS_FONT_EXISTS");
    const id = randomUUID();
    await m.query(
      `INSERT INTO brand_font_file (id, font_id, company_id, weight, style, format, bytes, sha256, data, licence_confirmed_by, licence_confirmed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [id, fontId, caller.companyId, f.weight, f.style, format, file.buffer.length, sha256, file.buffer, caller.userId || null],
    );
    // The file name and family are user text: the audit keeps ids, the face and the size only.
    await audit(m, caller, fontId, "create", { fileId: id, weight: f.weight, style: f.style, format, bytes: file.buffer.length, licenceConfirmed: true });
    const all = await fontsOf(caller.companyId, m);
    return all.find((x) => x.id === fontId) as BrandFont;
  });
}

export async function deleteBrandFont(caller: StudioCaller, idParam: unknown): Promise<void> {
  if (caller.roleClass !== "M") throw new DsError("DS_ROLE");
  const id = routeId(idParam);
  await AppDataSource.transaction(async (m) => {
    const [font]: Row[] = await m.query(`SELECT id FROM brand_font WHERE id = $1 AND company_id = $2`, [id, caller.companyId]).catch((err) => {
      if (tableMissing(err)) return [];
      throw err;
    });
    if (!font) throw new DsError("DS_DOC_NOT_FOUND");
    const files: Row[] = await m.query(`DELETE FROM brand_font_file WHERE font_id = $1 AND company_id = $2 RETURNING id`, [id, caller.companyId]);
    await m.query(`DELETE FROM brand_font WHERE id = $1 AND company_id = $2`, [id, caller.companyId]);
    await audit(m, caller, id, "delete", { files: (Array.isArray(files[0]) ? files[0] : files).length });
  });
}

export async function brandFontFile(caller: StudioCaller, idParam: unknown, fileParam: unknown): Promise<{ bytes: Buffer; mime: string }> {
  const id = routeId(idParam);
  const fid = fileId(fileParam);
  const rows: Row[] = await AppDataSource.query(`SELECT format, data FROM brand_font_file WHERE id = $1 AND font_id = $2 AND company_id = $3`, [fid, id, caller.companyId]).catch((err) => {
    if (tableMissing(err)) return [];
    throw err;
  });
  if (!rows[0]) throw new DsError("DS_DOC_NOT_FOUND");
  return { bytes: Buffer.from(rows[0].data), mime: FONT_MIME[rows[0].format as FontFileFormat] ?? "application/octet-stream" };
}

/**
 * The uploaded fonts a render uses, with their bytes as data: URLs (preview.html,
 * proof, print, PNG, final: no network, CSP `font-src data:`). Only `refs` of
 * the company are loaded; a ref that isn't (deleted, another company) is left
 * out and the renderer falls back to the style's font.
 */
export async function renderFonts(companyId: number, refs: string[]): Promise<RenderCustomFont[]> {
  const ids = [...new Set(refs.map((r) => /^custom:([1-9][0-9]{0,9})$/.exec(r)?.[1]).filter((x): x is string => !!x).map(Number))];
  if (!ids.length) return [];
  try {
    const fonts: Row[] = await AppDataSource.query(`SELECT id, family FROM brand_font WHERE company_id = $1 AND id = ANY($2::int[]) ORDER BY id`, [companyId, ids]);
    if (!fonts.length) return [];
    const files: Row[] = await AppDataSource.query(`SELECT font_id, weight, style, format, data FROM brand_font_file WHERE company_id = $1 AND font_id = ANY($2::int[]) ORDER BY font_id, weight, style`, [companyId, fonts.map((f) => Number(f.id))]);
    return fonts.map((f) => ({
      ref: `custom:${f.id}`,
      family: f.family,
      files: files
        .filter((x) => Number(x.font_id) === Number(f.id))
        .map((x) => ({ weight: Number(x.weight), style: x.style as FontStyle, format: x.format as FontFileFormat, url: `data:${FONT_MIME[x.format as FontFileFormat]};base64,${Buffer.from(x.data).toString("base64")}` })),
    }));
  } catch (err) {
    if (tableMissing(err)) return [];
    throw err;
  }
}
