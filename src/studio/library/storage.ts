/**
 * DS-4 · where uploaded studio images live. R2 when it is configured
 * (src/config/r2.ts: public bucket, so keys carry a random part), else the
 * local-uploads/ folder the app already uses for development
 * (LOCAL_FILE_STORAGE; served at /local-uploads, or LOCAL_UPLOAD_BASE_URL).
 * Keys never contain user text.
 */
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { deleteFromR2, r2Enabled, r2PublicUrl, uploadToR2 } from "../../config/r2";

const PREFIX = (process.env.R2_STUDIO_PREFIX || "studio-assets").replace(/^\/+|\/+$/g, "");
const LOCAL_ROOT = () => path.resolve(process.cwd(), "local-uploads");

const localBase = () => (process.env.LOCAL_UPLOAD_BASE_URL || `http://localhost:${process.env.PORT || 3000}/local-uploads`).replace(/\/+$/, "");

export const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/svg+xml": "svg" };

/** A fresh key for a company's asset. */
export const assetKey = (companyId: number, mime: string) => `${PREFIX}/company_${companyId}/${randomUUID()}.${EXT[mime] ?? "bin"}`;

/** The file under local-uploads for a key, refusing anything that escapes it. */
export function localPath(key: string): string | null {
  const segments = key.split("/").filter((s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== "." && s !== "..");
  if (!segments.length || segments.join("/") !== key) return null;
  const full = path.join(LOCAL_ROOT(), ...segments);
  const rel = path.relative(LOCAL_ROOT(), full);
  return rel.startsWith("..") || path.isAbsolute(rel) ? null : full;
}

export async function putAsset(key: string, bytes: Buffer, mime: string): Promise<void> {
  if (r2Enabled()) {
    await uploadToR2(bytes, key, mime);
    return;
  }
  const file = localPath(key);
  if (!file) throw new Error("bad asset key");
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, bytes);
}

export async function removeAsset(key: string): Promise<void> {
  if (r2Enabled()) return deleteFromR2(key);
  const file = localPath(key);
  if (file) await fs.promises.rm(file, { force: true });
}

/** Bytes of a stored asset (local storage only; R2 assets are read through their public URL). */
export async function readLocalAsset(key: string): Promise<Buffer | null> {
  const file = localPath(key);
  if (!file) return null;
  try {
    return await fs.promises.readFile(file);
  } catch {
    return null;
  }
}

/** The URL a page loads the asset from. */
export const assetPublicUrl = (key: string) => (r2Enabled() ? r2PublicUrl(key) : `${localBase()}/${key}`);
export const usingR2 = () => r2Enabled();
