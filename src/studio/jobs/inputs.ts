/**
 * DS-11 · everything a server-side render needs besides the doc, built the
 * way the editor builds it (ESG-lite_FE features/studio/editor/renderInputs.ts),
 * so Page view, Present, PNG and both PDFs equal the sheets:
 *
 *   - the numbers: DS-2 `resolveDocForRender` (every binding and chip, the doc's own
 *     year, sites and stored report inputs, and the rows of its factor table and
 *     Scope 3 categories sections) → the renderer's RenderData;
 *   - the brand side of the theme from the DS-3 brand kit;
 *   - every image the doc uses (company assets and the brand logos) as a
 *     data: URL, so the HTML needs no session, no network and no CSP hole.
 *
 * The resolved values come back too: a final stores them as its data snapshot.
 */
import { AppDataSource } from "../../config/data-source";
import { r2Enabled, r2PublicUrl } from "../../config/r2";
import { readLocalAsset } from "../library/storage";
import { getBrandKit } from "../brandkit/service";
import { resolveDocForRender, docBindings, collectTokens } from "../sources/doc";
import type { ResolveResponse } from "../sources/types";
import type { StudioCaller } from "../guard";
import type { ReportDoc } from "../contracts";
import { renderData } from "../../reporting/studio/render";
import type { RenderAssets, RenderBinding, RenderBrand, RenderData } from "../../reporting/studio/render/types";

type Row = Record<string, any>;

/** The asset ids the brand logos use in a doc (ESG-lite_FE lib/studio/brandOps.ts BRAND_LOGO_ASSETS). */
export const BRAND_LOGO_ASSETS = { primary: "brand:logo", onDark: "brand:logo-on-dark" } as const;

export interface RenderInputs {
  data: RenderData;
  brand: RenderBrand | null;
  assets: RenderAssets;
  resolved: ResolveResponse;
  companyName: string;
  /** The brand logo as a data: URL (viewer pages), when there is one. */
  logoDataUrl: string | null;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const cache = new Map<string, string | null>();
const CACHE_MAX = 64;

const remember = (k: string, v: string | null) => {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(k, v);
  return v;
};

const sniffMime = (b: Buffer): string | null => {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  const head = b.toString("utf8", 0, Math.min(b.length, 512)).trimStart();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return null;
};

const toDataUrl = (bytes: Buffer, mime?: string | null): string | null => {
  const m = mime && /^image\/(png|jpeg|webp|svg\+xml)$/.test(mime) ? mime : sniffMime(bytes);
  return m ? `data:${m};base64,${bytes.toString("base64")}` : null;
};

/** An http(s) image as a data: URL (null when it can't be read). Local dev URLs are read from disk. */
export async function imageDataUrl(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:image/")) return url;
  if (cache.has(url)) return cache.get(url) ?? null;
  const local = /\/local-uploads\/(.+)$/.exec(url);
  if (local) {
    const bytes = await readLocalAsset(decodeURIComponent(local[1]));
    if (bytes) return remember(url, toDataUrl(bytes));
  }
  if (!/^https?:\/\//i.test(url)) return remember(url, null);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" }).finally(() => clearTimeout(t));
    if (!res.ok) return remember(url, null);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return remember(url, null);
    return remember(url, toDataUrl(buf, res.headers.get("content-type")?.split(";")[0]));
  } catch {
    return null;
  }
}

/** The doc's company images as data: URLs, by asset id (tenant-checked: the company's own rows only). */
async function assetUrls(companyId: number, doc: ReportDoc): Promise<Record<string, string>> {
  const ids = [...new Set((doc.assets ?? []).map((a) => a.id).filter((id) => !id.startsWith("brand:")))];
  const urls: Record<string, string> = {};
  if (!ids.length) return urls;
  const rows: Row[] = await AppDataSource.query(`SELECT id, r2_key, mime FROM report_asset WHERE company_id = $1 AND id::text = ANY($2::text[])`, [companyId, ids]).catch(() => []);
  for (const r of rows) {
    let data: string | null = null;
    if (r2Enabled()) data = await imageDataUrl(r2PublicUrl(r.r2_key));
    else {
      const bytes = await readLocalAsset(r.r2_key);
      data = bytes ? toDataUrl(bytes, r.mime) : null;
    }
    if (data) urls[String(r.id)] = data;
  }
  return urls;
}

/** Resolves and loads everything for one render of `doc` (the caller's company; sites already checked). */
export async function renderInputs(caller: StudioCaller, doc: ReportDoc, opts: { docId?: number } = {}): Promise<RenderInputs> {
  const resolved = await resolveDocForRender(caller, doc, opts.docId ? { docId: opts.docId } : {});
  // The flow tables (factor table, Scope 3 categories) by section id, so Page view and the PDFs print their rows.
  const data = renderData(docBindings(doc) as unknown as RenderBinding[], collectTokens(doc) as never, resolved as never, { flow: resolved.flow, scope3: resolved.scope3 });
  const kit = await getBrandKit(caller);
  const urls = await assetUrls(caller.companyId, doc);
  const logo = await imageDataUrl(kit.logos.primary);
  const logoDark = await imageDataUrl(kit.logos.onDark);
  if (logo) urls[BRAND_LOGO_ASSETS.primary] = logo;
  if (logoDark) urls[BRAND_LOGO_ASSETS.onDark] = logoDark;
  const brand: RenderBrand = {
    primary: kit.colors.primary,
    accent: kit.colors.accent,
    look: kit.defaultLook,
    fontHeading: kit.fonts.heading,
    fontBody: kit.fonts.body,
    logoUrl: logo,
  };
  return { data, brand, assets: { urls }, resolved, companyName: kit.name, logoDataUrl: logo };
}

/** Clears the image cache (tests). */
export const clearImageCache = () => cache.forEach((_value, key) => cache.delete(key));
