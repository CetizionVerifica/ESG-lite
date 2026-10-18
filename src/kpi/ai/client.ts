/**
 * KPI-12 · calls to python_AI_service `app/kpi` (as built in wt/kpi-ai 42d655b):
 *
 *   POST /v1/kpi/suggest-values    service key   {company_id, document_id, kpis, period_hint?, user_id?}
 *   POST /v1/kpi/suggest-mapping   service key   {name, question?, unit?, topic?, catalogue, company_id?}
 *   POST /v1/kpi/documents         the caller's own token (multipart `file`) → {document_id, document_name}
 *
 * Same base URL env and service-key header as the other AI calls
 * (`OCR_SERVICE_URL`, `utils/aiServiceHeaders`). Every call answers
 * `{ok, status, body}` or `{ok: false, status: 0}` when python can't be
 * reached or times out: the caller degrades, never throws. Logs carry the
 * route and status only, never document text or values.
 */
import { aiServiceHeaders, aiServiceTimeoutMs } from "../../utils/aiServiceHeaders";

export const AI_URL = () => process.env.OCR_SERVICE_URL || "http://localhost:8000";

/** Python reads the whole document and asks the model: up to 60 s, so the proxy waits longer than the 30 s default. */
export const kpiSuggestTimeoutMs = () => {
  const v = Number(process.env.KPI_AI_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : Math.max(75000, aiServiceTimeoutMs());
};

export interface AiAnswer {
  ok: boolean;
  /** HTTP status, or 0 when python couldn't be reached. */
  status: number;
  body: any;
}

async function send(route: string, init: RequestInit, timeoutMs: number, fetcher: typeof fetch): Promise<AiAnswer> {
  try {
    const res = await fetcher(`${AI_URL()}${route}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const type = res.headers.get("content-type") || "";
    const body = type.includes("application/json") ? await res.json().catch(() => null) : null;
    if (!res.ok) console.warn(`[kpi-ai] ${route} returned ${res.status}`);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.warn(`[kpi-ai] ${route} unavailable:`, (err as Error)?.name);
    return { ok: false, status: 0, body: null };
  }
}

export const postService = (route: string, payload: unknown, timeoutMs = kpiSuggestTimeoutMs(), fetcher: typeof fetch = fetch) =>
  send(route, { method: "POST", headers: aiServiceHeaders(), body: JSON.stringify(payload) }, timeoutMs, fetcher);

/** Forwards an upload to python's document store as the caller (their bearer token), so python records the uploader. */
export function uploadDocument(file: { buffer: Buffer; originalname: string; mimetype?: string }, authorization: string, fetcher: typeof fetch = fetch): Promise<AiAnswer> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || "application/octet-stream" }), file.originalname || "document");
  return send("/v1/kpi/documents", { method: "POST", headers: { Authorization: authorization }, body: form }, aiServiceTimeoutMs(), fetcher);
}
