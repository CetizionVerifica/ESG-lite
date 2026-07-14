// Cloudflare R2 storage (S3-compatible) for brand logos and other public assets.
// R2 speaks the S3 API, so we use @aws-sdk/client-s3 pointed at the R2 endpoint.
//
// Required env:
//   R2_ACCOUNT_ID          Cloudflare account id (builds the endpoint)
//   R2_ACCESS_KEY_ID       R2 API token access key
//   R2_SECRET_ACCESS_KEY   R2 API token secret
//   R2_BUCKET              bucket name
//   R2_PUBLIC_BASE_URL     public base URL for reads (r2.dev URL or custom
//                          domain), e.g. https://pub-xxxx.r2.dev  — no trailing slash
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  R2_PUBLIC_BASE_URL,
} = process.env;

export const r2Enabled = (): boolean =>
  Boolean(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_BASE_URL);

let client: S3Client | null = null;
function r2(): S3Client {
  if (!r2Enabled()) throw new Error("R2 is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL");
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

// Public URL for reads — the report renderer fetches this and inlines it.
export const r2PublicUrl = (key: string): string =>
  `${R2_PUBLIC_BASE_URL!.replace(/\/$/, "")}/${key}`;

// Dedicated folder for brand logos, kept separate from any other assets in the
// bucket. Configurable via R2_BRAND_PREFIX (default "brand-assets").
const BRAND_PREFIX = (process.env.R2_BRAND_PREFIX || "brand-assets").replace(/^\/+|\/+$/g, "");
export const brandLogoKey = (companyId: number, ext: string): string =>
  `${BRAND_PREFIX}/company_${companyId}.${ext}`;

// Upload bytes at `key` (overwrites) and return { url, key }.
export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<{ url: string; key: string }> {
  await r2().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  return { url: r2PublicUrl(key), key };
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
