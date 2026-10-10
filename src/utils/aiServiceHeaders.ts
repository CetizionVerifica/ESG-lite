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
