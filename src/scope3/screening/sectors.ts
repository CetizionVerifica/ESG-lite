/**
 * S3-12 · "Suggest sector" for a screening spend line: asks python_AI_service
 * `POST /v1/scope3/eeio-sector` (contracts §5) for up to 3 USEEIO sectors of
 * the S3-5 library, and marks any below 80 % confidence for confirmation
 * (the spec: "ESG-lite asks for confirmation below 80"). The suggestion is
 * never saved by itself; the Admin picks a sector and saves the input.
 *
 * Only the line (description, supplier, amount, currency) and the sector
 * list are sent; logs carry counts and status codes only.
 */
import { AppDataSource } from "../../config/data-source";
import { EeioSectorResponseSchema, SECTOR_CONFIRM_BELOW, SectorSuggestionsBodySchema, type SectorSuggestionsResponse } from "../contracts/schemas";
import { BoundaryError } from "../boundary/errors";
import { aiServiceHeaders, aiServiceTimeoutMs } from "../../utils/aiServiceHeaders";
import { sectorCode } from "./estimate";

export { SECTOR_CONFIRM_BELOW };

const AI_URL = () => process.env.OCR_SERVICE_URL || "http://localhost:8000";

export type SectorSuggestion = SectorSuggestionsResponse["suggestions"][number];

/** The library sectors as `{code, name}` (one per code, newest price year). */
export async function librarySectors(): Promise<{ code: string; name: string }[]> {
  const rows: any[] = await AppDataSource.query(
    `SELECT DISTINCT ON (emission_category_name) emission_category_name AS name
       FROM emission_factors WHERE site_id IS NULL AND factor_type = 'eeio_spend'
      ORDER BY emission_category_name, price_base_year DESC NULLS LAST`,
  );
  const out = new Map<string, string>();
  for (const r of rows) {
    const code = sectorCode(r.name);
    if (code && !out.has(code)) out.set(code, r.name);
  }
  return [...out].map(([code, name]) => ({ code, name }));
}

export async function suggestSectors(raw: unknown, fetcher: typeof fetch = fetch): Promise<SectorSuggestionsResponse> {
  const parsed = SectorSuggestionsBodySchema.safeParse(raw ?? {});
  if (!parsed.success) throw new BoundaryError("SCOPE3_VALIDATION", { issues: parsed.error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: i.message })) });
  const sectors = await librarySectors();
  if (!sectors.length) return { available: false, suggestions: [], confirm_below: SECTOR_CONFIRM_BELOW };
  const names = new Map(sectors.map((s) => [s.code, s.name]));
  try {
    const res = await fetcher(`${AI_URL()}/v1/scope3/eeio-sector`, {
      method: "POST",
      headers: aiServiceHeaders(),
      body: JSON.stringify({ lines: [{ ...parsed.data, supplier: parsed.data.supplier ?? null }], sectors }),
      signal: AbortSignal.timeout(aiServiceTimeoutMs()),
    });
    if (!res.ok) {
      console.warn(`[scope3] eeio-sector returned ${res.status}`);
      return { available: false, suggestions: [], confirm_below: SECTOR_CONFIRM_BELOW };
    }
    const body = EeioSectorResponseSchema.safeParse(await res.json());
    if (!body.success) {
      console.warn("[scope3] eeio-sector response not in the contract shape");
      return { available: false, suggestions: [], confirm_below: SECTOR_CONFIRM_BELOW };
    }
    const suggestions = (body.data.lines[0]?.suggestions ?? [])
      .filter((s) => names.has(s.code))
      .slice(0, 3)
      .map((s) => ({ code: s.code, name: names.get(s.code)!, confidence: Math.round(s.confidence), needs_confirmation: s.confidence < SECTOR_CONFIRM_BELOW }));
    return { available: true, suggestions, confirm_below: SECTOR_CONFIRM_BELOW };
  } catch (err) {
    console.warn("[scope3] eeio-sector unavailable:", (err as Error)?.name);
    return { available: false, suggestions: [], confirm_below: SECTOR_CONFIRM_BELOW };
  }
}
