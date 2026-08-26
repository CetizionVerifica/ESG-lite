import fs from "fs";
import path from "path";
import { Writable } from "stream";

/**
 * Local-disk stand-in for the Cloudinary SDK, used for local development so
 * document upload/download works without touching the shared media account.
 *
 * It implements only the surface document.controller.ts actually uses:
 *   - uploader.upload_stream(options, callback) -> Writable
 *   - uploader.destroy(publicId, options)       -> Promise
 *
 * Safety note: destroy() only ever unlinks a file under UPLOAD_ROOT. Rows
 * restored from the production dump carry cloudinary_public_id values that
 * have no local file, so destroy() finds nothing and no-ops. No request is
 * ever made to Cloudinary, so a local delete cannot remove a live asset.
 */

const UPLOAD_ROOT = path.resolve(process.cwd(), "local-uploads");

const publicBase = (): string => {
    const configured = process.env.LOCAL_UPLOAD_BASE_URL;
    if (configured) return configured.replace(/\/+$/, "");
    return `http://localhost:${process.env.PORT || 3000}/local-uploads`;
};

/** Resolve a public_id to an absolute path, refusing anything that escapes UPLOAD_ROOT. */
const resolveSafe = (publicId: string): string | null => {
    const segments = String(publicId || "")
        .split("/")
        .map((s) => s.replace(/[^a-zA-Z0-9._-]/g, "_"))
        .filter((s) => s && s !== "." && s !== "..");

    if (segments.length === 0) return null;

    const full = path.join(UPLOAD_ROOT, ...segments);
    const rel = path.relative(UPLOAD_ROOT, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return full;
};

interface UploadOptions {
    folder?: string;
    resource_type?: string;
    public_id?: string;
}

const upload_stream = (
    options: UploadOptions,
    callback: (error: any, result?: any) => void,
): Writable => {
    const publicId =
        options.public_id ||
        `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    const chunks: Buffer[] = [];

    return new Writable({
        write(chunk, _encoding, done) {
            chunks.push(Buffer.from(chunk));
            done();
        },
        final(done) {
            try {
                const dest = resolveSafe(publicId);
                if (!dest) {
                    const err = new Error(`Unsafe public_id: ${publicId}`);
                    callback(err);
                    return done();
                }

                fs.mkdirSync(path.dirname(dest), { recursive: true });
                const body = Buffer.concat(chunks);
                fs.writeFileSync(dest, body);

                const url = `${publicBase()}/${publicId}`;
                callback(null, {
                    public_id: publicId,
                    url,
                    secure_url: url,
                    resource_type: options.resource_type || "raw",
                    bytes: body.length,
                    format: path.extname(dest).replace(/^\./, ""),
                    created_at: new Date().toISOString(),
                    storage: "local-disk",
                });
                done();
            } catch (err) {
                callback(err);
                done();
            }
        },
    });
};

const destroy = async (
    publicId: string,
    _options?: { resource_type?: string },
): Promise<{ result: string }> => {
    const target = resolveSafe(publicId);

    // No local file => a production-dump row. Do nothing; never call Cloudinary.
    if (!target || !fs.existsSync(target)) {
        return { result: "not found" };
    }

    fs.unlinkSync(target);
    return { result: "ok" };
};

export const UPLOAD_ROOT_DIR = UPLOAD_ROOT;

export default {
    uploader: { upload_stream, destroy },
};
