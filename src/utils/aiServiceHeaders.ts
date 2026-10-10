/**
 * Headers for server-to-server calls to python_AI_service. The AI service
 * accepts `X-Service-Key` (its AI_SERVICE_KEY) on the endpoints ESG-lite
 * calls without a user token: column-config inference and sea routes
 * (audit finding F-03).
 */
export function aiServiceHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env.AI_SERVICE_KEY;
  if (key) headers["X-Service-Key"] = key;
  return headers;
}

const envMs = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/**
 * Time limits for outbound calls, so a hung service cannot hold a request
 * open forever (audit finding F-14). LLM-backed AI service calls get longer
 * than route and geocode lookups.
 */
export const aiServiceTimeoutMs = () => envMs("AI_SERVICE_TIMEOUT_MS", 30000);
export const routeServiceTimeoutMs = () => envMs("ROUTE_SERVICE_TIMEOUT_MS", 15000);
