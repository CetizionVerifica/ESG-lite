/**
 * S3-5 · USEEIO spend factors (D3): reads the US EPA "Supply Chain GHG
 * Emission Factors for US Commodities and Industries" CSV (built on USEEIO
 * v2, public domain) and stores each sector as a company-less library factor:
 * `factor_type = eeio_spend`, `dataset = USEEIO`, per USD at the file's price
 * base year (with margins, purchaser price). Sites get the sectors they need
 * through POST /scope3/spend/library/copy; the engine reads a site's own
 * factors only (resolve.ts), so library rows are never used directly.
 *
 * The file goes in data/scope3/useeio/ exactly as EPA publishes it, e.g.
 * SupplyChainGHGEmissionFactors_v1.3.0_NAICS_CO2e_USD2022.csv; migrate:scope3-spend
 * loads every CSV there on start. Values are never typed in by hand.
 */
import type { EntityManager } from "typeorm";

export interface UseeioFactor {
  code: string;
  name: string;
  value: string;
  base_year: number;
  version: string;
}

/** A small CSV reader: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const DECIMAL = /^\d{1,10}(\.\d+)?([eE][-+]?\d+)?$/;

/**
 * The sectors of one EPA file. The price year comes from the Unit column
 * ("kg CO2e/2022 USD, purchaser price") or the file name ("…_USD2022.csv");
 * the version from the file name ("v1.3.0"). Rows of single gases are skipped
 * (only the all-GHG CO₂e factor is stored).
 */
export function readUseeio(text: string, fileName: string): UseeioFactor[] {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) throw new Error("empty file");
  const col = (re: RegExp) => header.findIndex((h) => re.test(h.trim()));
  const code = col(/naics code|^code$|commodity code/i);
  const title = col(/naics title|^name$|commodity name|title/i);
  const value = col(/with margins/i);
  const unit = col(/^unit$/i);
  const ghg = col(/^ghg$/i);
  if (code < 0 || title < 0 || value < 0) throw new Error("not an EPA supply chain factor file (needs code, title and 'with margins' columns)");
  const version = /v(\d+\.\d+(?:\.\d+)?)/i.exec(fileName)?.[1] ?? "unknown";
  const fileYear = /USD[_-]?(\d{4})/i.exec(fileName)?.[1];
  const out: UseeioFactor[] = [];
  for (const r of body) {
    if (ghg >= 0 && r[ghg] && !/all ghg|co2e/i.test(r[ghg])) continue;
    const v = (r[value] ?? "").trim();
    if (!DECIMAL.test(v)) continue;
    const year = Number(/(\d{4})\s*USD/i.exec(unit >= 0 ? r[unit] ?? "" : "")?.[1] ?? fileYear);
    if (!Number.isInteger(year) || year < 1990) throw new Error("no price base year in the Unit column or the file name");
    const c = r[code].trim();
    out.push({ code: c, name: `${r[title].trim()} (NAICS ${c})`.slice(0, 255), value: Number(v).toFixed(8), base_year: year, version: `SEF v${version}` });
  }
  return out;
}

/** Adds the sectors not in the library yet (same name, year and version). Returns how many were added. */
export async function seedUseeio(manager: EntityManager, factors: UseeioFactor[], source: string): Promise<number> {
  // Already loaded (every start after the first): one count instead of a query per sector.
  const versions = [...new Set(factors.map((f) => f.version))];
  const [{ n }] = await manager.query(
    `SELECT count(*)::int AS n FROM emission_factors WHERE site_id IS NULL AND factor_type = 'eeio_spend' AND dataset_version = ANY($1::varchar[])`,
    [versions],
  );
  if (n >= factors.length) return 0;
  let added = 0;
  for (const f of factors) {
    const rows: unknown[] = await manager.query(
      `INSERT INTO emission_factors (site_id, category_id, year, factor_value, denominator_unit, source, emission_category_name, global_category_name,
                                     factor_type, geography, dataset, dataset_version, includes_wtt, price_base_year, price_currency)
       SELECT NULL, NULL, $1, $2, 'USD', $3, $4::varchar, $4::varchar, 'eeio_spend', 'US', 'USEEIO', $5::varchar, false, $1, 'USD'
        WHERE NOT EXISTS (SELECT 1 FROM emission_factors WHERE site_id IS NULL AND factor_type = 'eeio_spend'
                             AND emission_category_name = $4::varchar AND year = $1 AND dataset_version = $5::varchar)
       RETURNING emission_factor_id`,
      [f.base_year, f.value, source, f.name, f.version],
    );
    added += rows.length;
  }
  return added;
}
