/**
 * DS-11 · where rendered outputs (PDFs, PNG zips, thumbnails) live. Private:
 * nothing here is ever served by URL, so a key can't leak a file.
 *
 *   R2 (src/config/r2.ts env set): the bucket is public for brand logos, so
 *     every key carries 16 random bytes and reads go through the S3 API
 *     (GetObject), never the public URL.
 *   Otherwise: `local-private/` under the working directory (not the
 *     `local-uploads/` folder the dev server publishes).
 *
 * Keys: `studio/<companyId>/<docId>/<n>-<kind>-<random>.<ext>`
 * (n = the final's version number, or `j<jobId>` for other jobs). Keys never
 * contain user text and never appear in a response.
 */
import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { r2Enabled } from "../../config/r2";

const PREFIX = (process.env.R2_STUDIO_OUTPUT_PREFIX || "studio").replace(/^\/+|\/+$/g, "");
const LOCAL_ROOT = () => path.resolve(process.cwd(), process.env.STUDIO_LOCAL_OUTPUT_DIR || "local-private");

export const outputKey = (companyId: number, docId: number, n: string | number, kind: string, ext: string): string =>
  `${PREFIX}/${Number(companyId)}/${Number(docId)}/${String(n).replace(/[^a-z0-9]/gi, "")}-${kind.replace(/[^a-z0-9_]/gi, "")}-${randomBytes(16).toString("hex")}.${ext.replace(/[^a-z0-9]/gi, "")}`;

const KEY_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/** The file under local-private for a key, refusing anything that escapes it. */
export function localOutputPath(key: string): string | null {
  if (!KEY_RE.test(key) || key.split("/").some((s) => s === "." || s === "..")) return null;
  const root = LOCAL_ROOT();
  const full = path.join(root, ...key.split("/"));
  const rel = path.relative(root, full);
  return rel.startsWith("..") || path.isAbsolute(rel) ? null : full;
}

let client: S3Client | null = null;
const s3 = (): S3Client => {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID as string, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string },
    });
  }
  return client;
};

export const outputStorage = (): "r2" | "local" => (r2Enabled() ? "r2" : "local");

export async function putOutput(key: string, bytes: Buffer, contentType: string): Promise<void> {
  if (r2Enabled()) {
    await s3().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: bytes, ContentType: contentType, CacheControl: "private, no-store" }));
    return;
  }
  const file = localOutputPath(key);
  if (!file) throw new Error("bad output key");
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, bytes);
}

/** The stored bytes, or null when the file is gone (an expired proof, a cleared folder). */
export async function getOutput(key: string): Promise<Buffer | null> {
  if (r2Enabled()) {
    try {
      const r = await s3().send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
      const body = r.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
      return body?.transformToByteArray ? Buffer.from(await body.transformToByteArray()) : null;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }
  const file = localOutputPath(key);
  if (!file) return null;
  try {
    return await fs.promises.readFile(file);
  } catch {
    return null;
  }
}

export async function removeOutput(key: string): Promise<void> {
  if (r2Enabled()) {
    await s3().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }));
    return;
  }
  const file = localOutputPath(key);
  if (file) await fs.promises.rm(file, { force: true });
}
