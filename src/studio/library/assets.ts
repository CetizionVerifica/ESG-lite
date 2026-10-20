/**
 * DS-4 · uploads for the Uploads drawer (01-contracts §4 `/assets`, RS-3
 * build 5): POST (multipart `file`, `folder?`, `alt?`), GET ?folder=,
 * PATCH (folder, alt), DELETE, GET /assets/:id/file, POST /assets/generate.
 *
 * Validation: the bytes decide the type, never the file name or the header.
 * JPG, PNG and WebP are re-encoded with sharp (orientation applied, EXIF and
 * every other metadata dropped); SVG is checked and refused when it holds
 * script, event handlers, foreignObject, entities or any reference outside
 * the file. Up to 10 MB (DS_ASSET_TOO_LARGE), else DS_ASSET_TYPE.
 * The same stored bytes in the same company return the existing asset.
 * Tenant: every query is keyed by the caller's company; another company's
 * asset id answers 404. Delete is refused while a draft uses the asset.
 */
import { createHash } from "crypto";
import sharp from "sharp";
import { AppDataSource } from "../../config/data-source";
import { generateImage, imageReady } from "../../reporting/imagery";
import { ASSET_MAX_BYTES, AssetGenerateSchema, AssetPatchSchema, AssetUploadFieldsSchema, AssetsQuerySchema, DsError, type AssetMime, type StudioAsset } from "../contracts";
import type { StudioCaller } from "../guard";
import { parse } from "../http";
import { assetKey, assetPublicUrl, putAsset, readLocalAsset, removeAsset, usingR2 } from "./storage";

type Row = Record<string, any>;

export interface UploadedFile {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An asset id that can't exist answers 404 before any query. */
export const assetId = (v: unknown): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new DsError("DS_DOC_NOT_FOUND");
  return v.toLowerCase();
};

// ---------------------------------------------------------------------------
// Type sniffing and cleaning
// ---------------------------------------------------------------------------

/** The image type from the first bytes; null for anything else. */
export function sniff(buf: Buffer): AssetMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  const head = buf.subarray(0, 4096).toString("utf8").replace(/^﻿/, "");
  const rest = head.replace(/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*/i, "");
  if (/^<svg[\s>]/i.test(rest) || /^<!DOCTYPE\s+svg/i.test(rest)) return "image/svg+xml";
  return null;
}

/** Why an SVG is refused, or null when it is safe to serve. */
export function svgProblem(svg: string): string | null {
  const rules: [RegExp, string][] = [
    [/<!ENTITY/i, "entity"],
    [/<!DOCTYPE/i, "doctype"],
    [/<\s*script/i, "script"],
    [/<\s*foreignObject/i, "foreignObject"],
    [/<\s*(iframe|embed|object|audio|video|use\b[^>]*href\s*=\s*["']\s*(?!#))/i, "embedded content"],
    [/\son[a-z]+\s*=/i, "event attribute"],
    [/javascript\s*:/i, "javascript url"],
    [/@import/i, "stylesheet import"],
    [/(?:xlink:)?href\s*=\s*["']\s*(?!#|data:image\/(?:png|jpe?g|webp|gif);)/i, "external reference"],
    [/url\(\s*["']?\s*(?!#|data:image\/(?:png|jpe?g|webp|gif);)/i, "external reference"],
  ];
  for (const [re, what] of rules) if (re.test(svg)) return what;
  return null;
}

const svgSize = (svg: string): { w: number; h: number } => {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const num = (name: string) => {
    const m = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?\\s*["']`, "i").exec(tag);
    return m ? Math.round(Number(m[1])) : 0;
  };
  let w = num("width");
  let h = num("height");
  const vb = /\sviewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i.exec(tag);
  if ((!w || !h) && vb) {
    w = w || Math.round(Number(vb[1]));
    h = h || Math.round(Number(vb[2]));
  }
  return { w: Math.min(Math.max(w || 512, 1), 20000), h: Math.min(Math.max(h || 512, 1), 20000) };
};

export interface CleanImage {
  bytes: Buffer;
  mime: AssetMime;
  w: number;
  h: number;
}

/** Validates and cleans an upload (pure apart from sharp). Throws DS_ASSET_TOO_LARGE / DS_ASSET_TYPE. */
export async function cleanImage(input: Buffer): Promise<CleanImage> {
  if (input.length > ASSET_MAX_BYTES) throw new DsError("DS_ASSET_TOO_LARGE");
  if (!input.length) throw new DsError("DS_ASSET_TYPE");
  const mime = sniff(input);
  if (!mime) throw new DsError("DS_ASSET_TYPE");
  if (mime === "image/svg+xml") {
    const svg = input.toString("utf8");
    const problem = svgProblem(svg);
    if (problem) throw new DsError("DS_ASSET_TYPE", { reason: "SVG_UNSAFE", what: problem });
    return { bytes: input, mime, ...svgSize(svg) };
  }
  try {
    let img = sharp(input, { failOn: "error", limitInputPixels: 100_000_000 }).rotate();
    img = mime === "image/jpeg" ? img.jpeg({ quality: 90 }) : mime === "image/png" ? img.png() : img.webp({ quality: 90 });
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    if (data.length > ASSET_MAX_BYTES) throw new DsError("DS_ASSET_TOO_LARGE");
    return { bytes: data, mime, w: info.width, h: info.height };
  } catch (err) {
    if (err instanceof DsError) throw err;
    throw new DsError("DS_ASSET_TYPE", { reason: "UNREADABLE" });
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const toAsset = (r: Row): StudioAsset => ({
  id: r.id,
  kind: r.kind,
  w: Number(r.w),
  h: Number(r.h),
  alt: r.alt ?? "",
  folder: r.folder ?? null,
  url: assetPublicUrl(r.r2_key),
  bytes: Number(r.bytes),
  mime: r.mime,
  sha256: r.sha256,
  createdAt: new Date(r.created_at).toISOString(),
});

const COLS = `id, kind, w, h, alt, folder, r2_key, bytes, mime, sha256, created_at`;

async function store(caller: StudioCaller, clean: CleanImage, opts: { kind: "image" | "ai_image"; folder: string | null; alt: string }): Promise<{ asset: StudioAsset; created: boolean }> {
  const sha256 = createHash("sha256").update(clean.bytes).digest("hex");
  const [existing]: Row[] = await AppDataSource.query(`SELECT ${COLS} FROM report_asset WHERE company_id = $1 AND sha256 = $2 ORDER BY created_at LIMIT 1`, [caller.companyId, sha256]);
  if (existing) return { asset: toAsset(existing), created: false };
  const key = assetKey(caller.companyId, clean.mime);
  await putAsset(key, clean.bytes, clean.mime);
  try {
    const [row]: Row[] = await AppDataSource.query(
      `INSERT INTO report_asset (company_id, kind, r2_key, mime, bytes, w, h, alt, sha256, folder, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${COLS}`,
      [caller.companyId, opts.kind, key, clean.mime, clean.bytes.length, clean.w, clean.h, opts.alt, sha256, opts.folder, caller.userId || null],
    );
    return { asset: toAsset(row), created: true };
  } catch (err) {
    await removeAsset(key).catch(() => undefined);
    throw err;
  }
}

/** `created` is false when the company already had these bytes (the existing asset comes back). */
export async function uploadAsset(caller: StudioCaller, file: UploadedFile | undefined, fields: unknown): Promise<{ asset: StudioAsset; created: boolean }> {
  const f = parse(AssetUploadFieldsSchema, fields ?? {});
  if (!file?.buffer) throw new DsError("DS_VALIDATION", { issues: [{ path: "file", message: "Choose an image to upload" }] });
  const clean = await cleanImage(file.buffer);
  return store(caller, clean, { kind: "image", folder: f.folder || null, alt: f.alt ?? "" });
}

export async function listAssets(caller: StudioCaller, query: unknown): Promise<StudioAsset[]> {
  const q = parse(AssetsQuerySchema, query ?? {});
  const rows: Row[] = q.folder
    ? await AppDataSource.query(`SELECT ${COLS} FROM report_asset WHERE company_id = $1 AND folder = $2 ORDER BY created_at DESC, id`, [caller.companyId, q.folder])
    : await AppDataSource.query(`SELECT ${COLS} FROM report_asset WHERE company_id = $1 ORDER BY created_at DESC, id`, [caller.companyId]);
  return rows.map(toAsset);
}

async function ownAsset(caller: StudioCaller, id: unknown): Promise<Row> {
  const [row]: Row[] = await AppDataSource.query(`SELECT ${COLS} FROM report_asset WHERE id = $1 AND company_id = $2`, [assetId(id), caller.companyId]);
  if (!row) throw new DsError("DS_DOC_NOT_FOUND");
  return row;
}

export async function patchAsset(caller: StudioCaller, id: unknown, body: unknown): Promise<StudioAsset> {
  const b = parse(AssetPatchSchema, body ?? {});
  const row = await ownAsset(caller, id);
  const folder = b.folder === undefined ? row.folder : b.folder || null;
  const alt = b.alt === undefined ? row.alt : b.alt;
  // TypeORM answers an UPDATE … RETURNING with [rows, count].
  const [rows]: [Row[], number] = await AppDataSource.query(`UPDATE report_asset SET folder = $3, alt = $4, updated_at = now() WHERE id = $1 AND company_id = $2 RETURNING ${COLS}`, [row.id, caller.companyId, folder, alt]);
  return toAsset(rows[0]);
}

/** Draft docs (report_doc, DS-5) that reference the asset; [] while that table doesn't exist. */
async function draftsUsing(companyId: number, id: string): Promise<number[]> {
  const cols: Row[] = await AppDataSource.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'report_doc' AND table_schema = current_schema()`);
  const names = new Set(cols.map((c) => c.column_name));
  if (!names.has("draft") || !names.has("company_id")) return [];
  const live = names.has("deleted_at") ? " AND deleted_at IS NULL" : "";
  const rows: Row[] = await AppDataSource.query(`SELECT id FROM report_doc WHERE company_id = $1 AND strpos(draft::text, $2) > 0${live} ORDER BY id LIMIT 20`, [companyId, id]);
  return rows.map((r) => Number(r.id));
}

export async function deleteAsset(caller: StudioCaller, id: unknown): Promise<void> {
  const row = await ownAsset(caller, id);
  const docs = await draftsUsing(caller.companyId, row.id);
  if (docs.length) throw new DsError("DS_VALIDATION", { reason: "ASSET_IN_USE", docs }, "This image is used in a design. Remove it there first.");
  await AppDataSource.query(`DELETE FROM report_asset WHERE id = $1 AND company_id = $2`, [row.id, caller.companyId]);
  const [shared]: Row[] = await AppDataSource.query(`SELECT 1 FROM report_asset WHERE r2_key = $1 LIMIT 1`, [row.r2_key]);
  if (!shared) {
    try {
      await removeAsset(row.r2_key);
    } catch (err) {
      console.error(`[studio] asset ${row.id} file not removed from storage:`, (err as Error)?.message);
    }
  }
}

/** The bytes (local storage) or the public URL to redirect to (R2). */
export async function assetFile(caller: StudioCaller, id: unknown): Promise<{ redirect: string } | { bytes: Buffer; mime: string }> {
  const row = await ownAsset(caller, id);
  if (usingR2()) return { redirect: assetPublicUrl(row.r2_key) };
  const bytes = await readLocalAsset(row.r2_key);
  if (!bytes) throw new DsError("DS_DOC_NOT_FOUND");
  return { bytes, mime: row.mime };
}

/** AI cover art (RS R13): an image provider must be configured (src/reporting/imagery.ts). */
export async function generateAsset(caller: StudioCaller, body: unknown): Promise<StudioAsset> {
  const b = parse(AssetGenerateSchema, body ?? {});
  if (!imageReady()) throw new DsError("DS_AI_UNAVAILABLE");
  const prompt = `${b.prompt}\n\nAbstract, premium and professional. No text, no words, no letters, no logos, no charts, no human faces.`;
  const url = await generateImage(prompt);
  const m = url ? /^data:image\/(png|jpeg|webp);base64,(.+)$/i.exec(url) : null;
  if (!m) throw new DsError("DS_AI_UNAVAILABLE");
  const clean = await cleanImage(Buffer.from(m[2], "base64"));
  return (await store(caller, clean, { kind: "ai_image", folder: b.folder || "AI images", alt: b.prompt.slice(0, 500) })).asset;
}
