/**
 * DS-11 · the public view-link routes, mounted at /s in src/index.ts OUTSIDE
 * /studio auth (`app.use("/s", shareViewer)`; no session):
 *
 *   GET /s/:token        the viewer page (HTML); counts a view
 *   GET /s/:token/meta   PublicShareMeta (JSON, for the app's /s/:token page); counts a view
 *   GET /s/:token/file   the stored PDF bytes (inline; ?download=1 → attachment)
 *
 * Unknown token → 404; revoked, expired, deleted design or studio off → 410
 * DS_SHARE_EXPIRED (HTML on the page route, JSON on the others). Every
 * response is no-store and noindex. Rate-limited per client IP
 * (SHARE_RATE_LIMIT_MAX requests per minute, default 120). Viewers only ever
 * get the stored PDF: nothing here resolves or renders data.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { DsError, type PublicShareMeta } from "../contracts";
import { imageDataUrl } from "../jobs/inputs";
import { getOutput } from "../jobs/storage";
import { fileStem } from "../jobs/service";
import { countView, openShare } from "./service";
import { VIEWER_CSP, messageHtml, viewerHtml } from "./viewer";

const router = Router();

// ---------------------------------------------------------------------------
// Rate limit (per process, per client IP; TRUST_PROXY makes req.ip the client)
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;
const hits = new Map<string, { n: number; resetAt: number }>();
let sweeper: NodeJS.Timeout | null = null;

export function shareRateLimit(req: Request, res: Response, next: NextFunction) {
  const max = Number(process.env.SHARE_RATE_LIMIT_MAX) || 120;
  const now = Date.now();
  if (!sweeper) {
    sweeper = setInterval(() => {
      const t = Date.now();
      for (const [k, b] of hits) if (b.resetAt <= t) hits.delete(k);
    }, WINDOW_MS);
    sweeper.unref?.();
  }
  const key = String(req.ip ?? "unknown");
  let b = hits.get(key);
  if (!b || b.resetAt <= now) {
    b = { n: 0, resetAt: now + WINDOW_MS };
    hits.set(key, b);
  }
  b.n += 1;
  if (b.n > max) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((b.resetAt - now) / 1000))));
    res.setHeader("Cache-Control", "no-store");
    if (req.path.endsWith("/meta") || req.path.endsWith("/file")) return res.status(429).json({ message: "Too many requests. Wait a minute, then try again." });
    return res.status(429).type("html").send(messageHtml(429));
  }
  next();
}
/** Clears the counters (tests). */
export const resetShareRateLimit = () => hits.clear();

const common = (res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
};

const status = (err: unknown): 404 | 410 | 500 => (err instanceof DsError ? (err.code === "DS_SHARE_EXPIRED" ? 410 : 404) : 500);

const jsonError = (res: Response, err: unknown) => {
  if (err instanceof DsError) return res.status(status(err)).json(err.code === "DS_SHARE_EXPIRED" ? err.toBody() : new DsError("DS_DOC_NOT_FOUND").toBody());
  console.error("[studio] share link failed:", (err as Error)?.message);
  return res.status(500).json({ message: "Internal server error" });
};

/** Origins the app's /s/:token page runs on may frame the PDF. */
const frameAncestors = () => ["'self'", ...[process.env.FRONTEND_URL, process.env.CORS_ORIGIN].filter(Boolean).map((u) => String(u).replace(/\/+$/, ""))].join(" ");

router.use(shareRateLimit);

router.get("/:token", async (req, res) => {
  common(res);
  try {
    const share = await openShare(String(req.params.token));
    await countView(share);
    const logo = await imageDataUrl(share.logoUrl);
    res.setHeader("Content-Security-Policy", VIEWER_CSP);
    res.setHeader("X-Frame-Options", "DENY");
    res.type("html").send(viewerHtml(share, logo, `${req.baseUrl}/${encodeURIComponent(String(req.params.token))}/file`));
  } catch (err) {
    const s = status(err);
    if (s === 500) console.error("[studio] share page failed:", (err as Error)?.message);
    res.setHeader("Content-Security-Policy", VIEWER_CSP);
    res.status(s).type("html").send(messageHtml(s === 500 ? 404 : s));
  }
});

router.get("/:token/meta", async (req, res) => {
  common(res);
  try {
    const share = await openShare(String(req.params.token));
    await countView(share);
    const body: PublicShareMeta = {
      title: share.title,
      company: share.company,
      logoUrl: await imageDataUrl(share.logoUrl),
      label: share.label,
      expiresAt: share.expiresAt,
      pageCount: share.pageCount,
      fileUrl: `${req.baseUrl}/${encodeURIComponent(String(req.params.token))}/file`,
    };
    res.json(body);
  } catch (err) {
    jsonError(res, err);
  }
});

router.get("/:token/file", async (req, res) => {
  common(res);
  try {
    const share = await openShare(String(req.params.token));
    const bytes = await getOutput(share.fileKey);
    if (!bytes) throw new DsError("DS_SHARE_EXPIRED");
    const name = `${fileStem(share.company, share.kind, share.year)}-${share.label.replace(/[^\w]+/g, "-")}.pdf`.replace(/-+/g, "-");
    const download = String((req.query as Record<string, unknown>)?.download ?? "") === "1";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(bytes.length));
    res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${name.replace(/[^\w.-]/g, "_")}"`);
    res.setHeader("Content-Security-Policy", `frame-ancestors ${frameAncestors()}`);
    res.end(bytes);
  } catch (err) {
    jsonError(res, err);
  }
});

export default router;
