// Writes rich, board-facing narrative prose from the EXACT computed figures via
// OpenRouter. It only writes prose — never the numbers (those come from SQL and
// are passed in). Returns null on any failure so the report falls back to
// concise built-in text (accuracy-first, never blocks generation).
import { openRouterFetch, openRouterKey } from "../lib/openrouter";

export interface Narrative {
  summary: string[];
  siteNote: string;
  scopeNote: string;
  categoryNote: string;
  coverageNote: string;
  recommendations: string[];
}

export interface NarrativeInput {
  companyName: string;
  year: number;
  total: number;
  scope1: number;
  scope2: number;
  coverage: number;
  sites: { name: string; t: number }[];
  categories: { name: string; t: number }[];
  missingSites: string[];
  renewable: number;
  months: number;
}

function extractJson(text: string): any {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const a = cleaned.indexOf("{");
  const b = cleaned.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error("no json");
  return JSON.parse(cleaned.slice(a, b + 1));
}

export async function writeNarrative(d: NarrativeInput): Promise<Narrative | null> {
  const key = openRouterKey();
  if (!key) return null;
  const model = process.env.OPENROUTER_MODEL || "google/gemini-3-flash-preview";

  // Every figure is pre-rounded/formatted so the model can never echo raw
  // floats like "44545.924442624" into the report prose; 3 dp like the report's tables (#209).
  const nf = (n: number) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const prompt =
    `You are an ESG/GHG analyst writing a professional, board-facing Carbon Accounting Report for ` +
    `${d.companyName}, reporting year ${d.year}. Use ONLY the figures below — never invent or change a number; ` +
    `refer to them qualitatively where useful.\n\n` +
    `FIGURES (tCO2e):\n` +
    `- Total: ${nf(d.total)}\n- Scope 1: ${nf(d.scope1)}\n- Scope 2: ${nf(d.scope2)}\n` +
    `- Data coverage: ${d.coverage}% of sites reporting\n` +
    `- Sites: ${d.sites.map((s) => `${s.name}=${nf(s.t)}`).join(", ") || "none"}\n` +
    `- Categories/fuels: ${d.categories.map((c) => `${c.name}=${nf(c.t)}`).join(", ") || "none"}\n` +
    `- Sites with NO data entered: ${d.missingSites.join(", ") || "none"}\n` +
    `- Renewable-linked: ${d.renewable > 0 ? nf(d.renewable) : "none entered"}\n` +
    `- Months with data: ${d.months} of 12\n\n` +
    `Return STRICT JSON only, no markdown:\n` +
    `{"summary":["para1","para2","para3"],"siteNote":"...","scopeNote":"...","categoryNote":"...",` +
    `"coverageNote":"...","recommendations":["rec1","rec2","rec3","rec4"]}\n` +
    `summary = 3 concise executive-summary paragraphs. Each *Note = 1-2 sentences analysing that dimension. ` +
    `recommendations = 4 specific, actionable next steps. Professional, concise, no fabricated numbers. ` +
    `Write numbers exactly as given (thousands separators, tCO2e figures with three decimals).`;

  try {
    // DS-9: the request is sent by the shared helper (src/lib/openrouter.ts), byte-identical.
    const res = await openRouterFetch({ model, max_tokens: 2200, temperature: 0.7, messages: [{ role: "user", content: prompt }] }, { apiKey: key, title: "ESG-Lite GHG" });
    if (!res.ok) return null;
    const j: any = await res.json();
    const txt = j?.choices?.[0]?.message?.content;
    if (!txt) return null;
    const n = extractJson(txt);
    if (!Array.isArray(n.summary) || !n.summary.length) return null;
    return {
      summary: n.summary.map(String),
      siteNote: String(n.siteNote ?? ""),
      scopeNote: String(n.scopeNote ?? ""),
      categoryNote: String(n.categoryNote ?? ""),
      coverageNote: String(n.coverageNote ?? ""),
      recommendations: Array.isArray(n.recommendations) ? n.recommendations.map(String) : [],
    };
  } catch {
    return null;
  }
}
