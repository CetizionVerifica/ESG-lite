/**
 * DS-12 · GHG completeness checks (01-contracts §6), pure. They read:
 *   - the facts of the period (facts.ts): pending entries, sites and months without data,
 *     Scope 3 categories with data, GWP sets, factor sources, biogenic CO₂, scope totals;
 *   - the report inputs (stored over prefill, DS-2);
 *   - the doc's structure: which bindings, charts and flow sections are printed;
 *   - the typed text (numbers and words) and the resolved series (TOTAL_MISMATCH).
 *
 * Severity: CHECK_RULES, with the ISO 14064-1 escalation when ISO14064 is in
 * meta.frameworks (types.ts `check`). INTENSITY_MISSING applies only with BRSR_P6 or
 * ESRS_E1 selected (D8). Messages name what the standard expects in plain words (05-ux S8).
 */
import { extractNumbers } from "../../reporting/studio/render/checks/number";
import { ghgCategory } from "../../scope3/contracts/ghgCategory";
import type { Check, GhgBinding, ReportInputKey } from "../contracts";
import { formatNumber, TONNES_UNIT } from "../sources/format";
import { exclusionFor } from "../sources/inputs";
import { monthText } from "../docs/readiness";
import { check, hasInput, type CheckInput, type GhgFacts } from "./types";
import { visibleCorpus, visibleElements, type BindingPlace } from "./walk";

const categoryName = (n: number) => `Scope 3 Category ${n}: ${ghgCategory(n)?.name ?? ""}`.trim();
/**
 * A tonnes figure in a message, with 3 decimals as every tCO₂e figure the page prints (#209
 * review: sources/format.ts, the `display` formatter). Rounded to whole tonnes, a mismatch
 * over the 0.5 t tolerance could read "add up to 12,480 t, not the total of 12,480 t".
 */
const tons = (n: number) => `${formatNumber(n, "auto", TONNES_UNIT)} t`;

/** Breakdowns whose parts add up to the binding's total (gas is tonnes of each gas; fuel is a subset). */
const PARTITIONS = new Set(["scope", "site", "month", "quarter", "scope3_category", "source_category"]);
const SCOPE_TOTAL_METRICS = new Set(["total", "scope1", "scope2_location", "scope3"]);

export function ghgChecks(input: CheckInput): Check[] {
  const { doc, ix, inputs, resolved } = input;
  if (doc.kind !== "ghg") return [];
  const f: GhgFacts | undefined = input.ghg;
  const out: Check[] = [];
  const ghgB = ix.bindings.filter((b) => !b.hidden && b.binding.source === "ghg") as Array<BindingPlace & { binding: GhgBinding }>;
  const ghgT = ix.tokens.filter((t) => !t.hidden && t.token.attrs.binding.source === "ghg");
  const metricShown = (pred: (b: GhgBinding) => boolean) => ghgB.some((b) => pred(b.binding)) || ghgT.some((t) => pred(t.token.attrs.binding as GhgBinding));
  const firstAt = (pred: (b: GhgBinding) => boolean) => {
    const b = ghgB.find((x) => pred(x.binding));
    return b ? { pageId: b.pageId, elementId: b.elementId } : {};
  };
  const inputAt = (key: ReportInputKey) => {
    const b = ix.bindings.find((x) => !x.hidden && x.binding.source === "input" && x.binding.key === key);
    return b ? { pageId: b.pageId, elementId: b.elementId } : {};
  };
  const flows = doc.pages.filter((p) => p.kind === "flow" && !p.hidden);
  const corpus = visibleCorpus(doc, ix);

  // --- Data in the period -------------------------------------------------
  if (f) {
    const n = f.pending + f.rejected;
    if (n > 0) {
      const what = f.rejected && f.pending ? `Pending or rejected entries: ${n}` : f.rejected ? `Rejected entries not corrected: ${n}` : `Pending entries: ${n}`;
      out.push(check(doc, "GHG_PENDING_ENTRIES", `${what}. Approve them in Review before the final.`, { fix: "open_pending", details: { count: n, pending: f.pending, rejected: f.rejected, link: "/data/approvals" } }));
    }
    for (const s of f.sitesMissing) {
      out.push(check(doc, "GHG_SITES_MISSING", `${s.name} has no approved data for ${f.periodLabel}.`, { fix: "open_link", details: { siteId: s.id, link: `/data/ledger?site=${s.id}` } }));
    }
    for (const m of f.monthsMissing) {
      out.push(
        check(doc, "GHG_MONTHS_MISSING", `${m.siteName} has no approved data for ${m.months.length > 3 ? `${m.months.length} months` : m.months.map(monthText).join(", ")}.`, {
          fix: "open_link",
          details: { siteId: m.siteId, months: m.months, link: `/data/ledger?site=${m.siteId}` },
        }),
      );
    }
  }

  // --- Boundaries and period (GHG Protocol ch. 9) ------------------------
  if (!hasInput(inputs, "consolidation_approach")) {
    out.push(check(doc, "CONSOLIDATION_MISSING", "The consolidation approach isn't stated. Say whether the boundary follows equity share, financial control or operational control.", { ...inputAt("consolidation_approach"), fix: "open_inputs", details: { inputKey: "consolidation_approach" } }));
  }
  if (!hasInput(inputs, "reporting_period")) {
    out.push(check(doc, "PERIOD_MISSING", "The reporting period isn't stated. Add it in Report details.", { ...inputAt("reporting_period"), fix: "open_inputs", details: { inputKey: "reporting_period" } }));
  }

  // --- Base year ----------------------------------------------------------
  const isTrend = (b: GhgBinding) => b.compare === "base" || b.metric === "base_year_total" || (Array.isArray(b.years) ? b.years.length > 1 : b.years.last > 1);
  const showsTrend = metricShown(isTrend);
  if (showsTrend && !hasInput(inputs, "base_year")) {
    out.push(check(doc, "BASE_YEAR_MISSING", "This report shows a trend or a change since the base year, but no base year is set. Add the base year and why it was chosen.", { ...firstAt(isTrend), fix: "open_inputs", details: { inputKey: "base_year" } }));
  }
  if (hasInput(inputs, "base_year") && (!hasInput(inputs, "recalculation_policy") || !hasInput(inputs, "significance_threshold_pct"))) {
    const missing = [!hasInput(inputs, "recalculation_policy") && "recalculation policy", !hasInput(inputs, "significance_threshold_pct") && "significance threshold"].filter(Boolean).join(" and ");
    out.push(check(doc, "RECALC_POLICY_MISSING", `The base year has no ${missing}. Say when the base year is recalculated.`, { ...inputAt("recalculation_policy"), fix: "open_inputs", details: { inputKey: !hasInput(inputs, "recalculation_policy") ? "recalculation_policy" : "significance_threshold_pct" } }));
  }

  // --- Scope 2 market-based (D7) -----------------------------------------
  const market = (b: GhgBinding) => b.metric === "scope2_market";
  out.push(
    check(doc, "SCOPE2_MARKET_MISSING", metricShown(market) ? "Market-based Scope 2 isn't recorded, so it shows as Not reported. Describe any contractual instruments in Report details." : "Market-based Scope 2 isn't recorded and the report doesn't say so. Add the market-based row, which shows Not reported with the reason.", {
      ...firstAt(market),
      fix: metricShown(market) ? "open_inputs" : "add_market_note",
      details: metricShown(market) ? { inputKey: "scope2_instruments" } : {},
    }),
  );

  // --- Gases --------------------------------------------------------------
  const perGas = (b: GhgBinding) => b.breakdown === "gas" || b.metric === "gas_co2" || b.metric === "gas_ch4" || b.metric === "gas_n2o";
  const gasNote = /\bgas(es)?\b[^\n]{0,120}\b(not applicable|n\/a)\b|\b(not applicable|n\/a)\b[^\n]{0,120}\bgas(es)?\b/.test(corpus);
  if (!metricShown(perGas) && !gasNote) {
    out.push(check(doc, "GAS_BREAKDOWN_MISSING", "Emissions aren't shown by gas (CO₂, CH₄, N₂O). Add a per-gas chart, or say why it doesn't apply.", { fix: "add_gas_chart" }));
  }

  // --- Biogenic CO₂ ---------------------------------------------------------
  const biogenicLabelled = visibleElements(doc).filter(({ element: e }) => {
    const b = (e.props as { binding?: GhgBinding }).binding;
    if (!b || b.source !== "ghg" || !SCOPE_TOTAL_METRICS.has(b.metric)) return false;
    const p = e.props as Record<string, unknown>;
    const words = [p.title, p.subtitle, p.caption, p.label].filter((x) => typeof x === "string").join(" ").toLowerCase();
    return /biogenic/.test(words) && /\b(incl|including|includes|plus|with)\b/.test(words) && !/\b(excl|excluding|excludes|without|separately)\b/.test(words);
  });
  for (const { pageId, element } of biogenicLabelled) {
    out.push(check(doc, "BIOGENIC_IN_SCOPE", "This figure is labelled as including biogenic CO₂. Scope totals exclude it: report biogenic CO₂ separately.", { pageId, elementId: element.id }));
  }
  if (f?.totals && f.biogenicT && f.biogenicT > 0) {
    // A typed number equal to a scope total plus biogenic CO₂ (and not the total itself).
    const sums = [f.totals.total, f.totals.scope1, f.totals.scope2, f.totals.scope3].filter((t) => t > 0).map((t) => t + (f.biogenicT as number));
    for (const t of ix.texts) {
      if (t.hidden) continue;
      for (const para of t.paragraphs)
        for (const c of extractNumbers(para)) {
          if (c.family !== "t") continue;
          const near = (x: number) => Math.abs(Math.round(x / c.step) * c.step - c.value) <= c.step * 1e-6;
          if (sums.some(near) && ![f.totals.total, f.totals.scope1, f.totals.scope2, f.totals.scope3].some(near)) {
            out.push(check(doc, "BIOGENIC_IN_SCOPE", `"${c.text}" is a scope total with biogenic CO₂ added. Report biogenic CO₂ separately.`, { pageId: t.pageId, ...(t.elementId ? { elementId: t.elementId } : {}), details: { typed: c.text } }));
          }
        }
    }
  }
  if (f?.biogenicT && f.biogenicT > 0 && !metricShown((b) => b.metric === "biogenic_co2")) {
    out.push(check(doc, "BIOGENIC_NOT_SHOWN", `Your approved data has ${tons(f.biogenicT)} of biogenic CO₂, but the report doesn't show it. Report it separately from the scopes.`, { fix: "add_biogenic", details: { tonnes: f.biogenicT } }));
  }

  // --- Scope 3 categories (Scope 3 Standard ch. 11) ----------------------
  const scope3Pages = ghgB.filter((b) => b.binding.metric === "scope3" || b.binding.metric === "scope3_category");
  const shownCategory = (n: number): boolean => {
    for (const p of flows) if (p.kind === "flow" && p.flowType === "scope3_categories" && (!p.options.categories?.length || p.options.categories.includes(n))) return true;
    for (const b of ghgB) {
      if (b.binding.metric === "scope3_category" && b.binding.scope3Category === n) return true;
      if (b.binding.breakdown === "scope3_category") {
        const r = resolved.values[b.idx];
        if (r?.series?.some((s) => s.values.some((v) => v.key.startsWith(`${n} ·`)))) return true;
      }
    }
    return ghgT.some((t) => (t.token.attrs.binding as GhgBinding).metric === "scope3_category" && (t.token.attrs.binding as GhgBinding).scope3Category === n);
  };
  const reported = new Set(f?.scope3Reported ?? []);
  // "Go to" the Scope 3 categories section, else the page with a category breakdown, else any Scope 3 figure.
  const s3Flow = flows.find((p) => p.kind === "flow" && p.flowType === "scope3_categories");
  const s3Page = s3Flow?.id ?? (scope3Pages.find((b) => b.binding.breakdown === "scope3_category" || b.binding.metric === "scope3_category") ?? scope3Pages[0])?.pageId;
  const s3At = s3Page ? { pageId: s3Page } : {};
  for (let n = 1; n <= 15; n++) {
    if (exclusionFor(inputs, n)) continue;
    if (reported.has(n) && shownCategory(n)) continue;
    const has = reported.has(n);
    out.push(
      check(doc, "SCOPE3_CATEGORY_UNADDRESSED", has ? `${categoryName(n)} has approved data but isn't shown in the report.` : `${categoryName(n)} isn't reported or excluded. Mark it as excluded with a reason, or add its data.`, {
        ...s3At,
        ...(has ? {} : { fix: "mark_excluded" as const }),
        details: { category: n, name: ghgCategory(n)?.name ?? null, hasData: has },
      }),
    );
  }
  for (const e of inputs.exclusions?.value ?? []) {
    if (!e.reason.trim()) {
      const m = /^\s*(?:category|cat\.?)\s*(\d{1,2})\b/i.exec(e.what);
      out.push(check(doc, "EXCLUSION_NO_REASON", `The exclusion "${e.what}" has no reason. Say why it's left out.`, { ...inputAt("exclusions"), fix: "mark_excluded", details: { what: e.what, ...(m ? { category: Number(m[1]) } : {}) } }));
    }
  }
  const showsScope3 = scope3Pages.length > 0 || flows.some((p) => p.kind === "flow" && p.flowType === "scope3_categories");
  const dqShown = metricShown((b) => b.metric === "dq_score" || b.metric === "primary_data_pct") || flows.some((p) => p.kind === "flow" && p.flowType === "scope3_categories" && p.options.showDq !== false);
  if (showsScope3 && !dqShown) {
    out.push(check(doc, "SCOPE3_DQ_MISSING", "Scope 3 is shown without its data quality or share of supplier-specific data. Add the data quality score or the primary-data share.", { ...s3At, fix: "open_link", details: { link: "/data/ledger" } }));
  }

  // --- Methodology: factor sources and GWP --------------------------------
  if (f?.factorSources.length) {
    const table = flows.some((p) => p.kind === "flow" && p.flowType === "ghg_factor_table");
    if (!table) {
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
      const missing = f.factorSources.filter((s) => !corpus.includes(norm(s.source)));
      if (missing.length) {
        const method = doc.pages.find((p) => !p.hidden && (/methodolog/i.test(p.name) || (p.kind === "flow" && p.flowType === "methodology")));
        const list = missing.map((s) => (s.version ? `${s.source} (${s.version})` : s.source));
        out.push(check(doc, "EF_SOURCE_MISSING", `The methodology doesn't name the emission factor sources your data uses: ${list.join(", ")}. Add the emission factors section, or name them.`, { ...(method ? { pageId: method.id } : {}), fix: "add_factor_table", details: { sources: list } }));
      }
    }
  }
  const gwp = inputs.gwp_set?.value;
  if ((f?.gwpSets.length ?? 0) > 1 || gwp === "MIXED") {
    const sets = f?.gwpSets.length ? f.gwpSets.join(", ") : "more than one";
    out.push(check(doc, "GWP_MIXED", `Your data uses more than one set of global warming potentials (${sets}). Say which set the totals use, and why.`, { ...inputAt("gwp_set"), fix: "open_inputs", details: { sets: f?.gwpSets ?? [], inputKey: "gwp_set" } }));
  }

  // --- ISO 14064-1 items ----------------------------------------------------
  if (!hasInput(inputs, "responsible_person")) {
    out.push(check(doc, "RESPONSIBLE_PERSON_MISSING", "No responsible person is named for this inventory.", { ...inputAt("responsible_person"), fix: "open_inputs", details: { inputKey: "responsible_person" } }));
  }
  if (!hasInput(inputs, "uncertainty_statement")) {
    out.push(check(doc, "UNCERTAINTY_MISSING", "There is no uncertainty statement.", { ...inputAt("uncertainty_statement"), fix: "open_inputs", details: { inputKey: "uncertainty_statement" } }));
  }
  if (!hasInput(inputs, "verification")) {
    out.push(check(doc, "VERIFICATION_STATEMENT_MISSING", 'The verification status isn\'t stated. "Not verified" counts.', { ...inputAt("verification"), fix: "open_inputs", details: { inputKey: "verification" } }));
  }

  // --- Intensity (BRSR P6, ESRS E1-6) --------------------------------------
  const brsr = doc.meta.frameworks.includes("BRSR_P6");
  const esrs = doc.meta.frameworks.includes("ESRS_E1");
  if (brsr || esrs) {
    const resolvedOk = (metric: string) => ghgB.some((b) => b.binding.metric === metric && !resolved.values[b.idx]?.unavailable) || ghgT.some((t) => (t.token.attrs.binding as GhgBinding).metric === metric && !resolved.tokens[t.idx]?.unavailable);
    const missing: string[] = [];
    if (!resolvedOk("intensity_revenue")) missing.push("intensity per unit of revenue");
    if (brsr && !hasInput(inputs, "revenue_ppp_rate")) missing.push("the PPP rate for revenue");
    if (brsr && !resolvedOk("intensity_output")) missing.push("intensity per unit of output");
    if (missing.length) {
      const fw = [brsr && "BRSR Principle 6", esrs && "ESRS E1-6"].filter(Boolean).join(" and ");
      out.push(check(doc, "INTENSITY_MISSING", `${fw} ${brsr && esrs ? "ask" : "asks"} for ${missing.join(", ")}, which the report doesn't show.`, { ...firstAt((b) => b.metric.startsWith("intensity_")), fix: "open_inputs", details: { missing, inputKey: "revenue" } }));
    }
  }

  // --- Totals that don't add up --------------------------------------------
  for (const b of ghgB) {
    if (!b.binding.breakdown || !PARTITIONS.has(b.binding.breakdown) || !SCOPE_TOTAL_METRICS.has(b.binding.metric)) continue;
    const r = resolved.values[b.idx];
    if (!r || r.unavailable || r.total === null || r.total === undefined || !r.series?.length) continue;
    const cur = r.series.find((s) => s.label === String(doc.meta.year)) ?? r.series[r.series.length - 1];
    const sum = cur.values.reduce((a, p) => a + (p.value ?? 0), 0);
    if (Math.abs(sum - r.total) > Math.max(0.5, Math.abs(r.total) * 1e-6)) {
      out.push(check(doc, "TOTAL_MISMATCH", `The parts here add up to ${tons(sum)}, not the total of ${tons(r.total)}.`, { pageId: b.pageId, elementId: b.elementId, details: { sum, total: r.total, breakdown: b.binding.breakdown } }));
    }
  }
  for (const { pageId, element: e } of visibleElements(doc)) {
    const table = e.type === "table" && !e.props.binding ? { columns: e.props.columns ?? [], rows: e.props.rows ?? [] } : (e.type === "table" || e.type === "chart") && e.props.binding?.source === "custom" ? e.props.binding : null;
    if (!table) continue;
    const totalRow = table.rows.findIndex((row) => typeof row[0] === "string" && /^\s*total\b/i.test(row[0]));
    if (totalRow < 0) continue;
    for (let c = 1; c < table.columns.length; c++) {
      const want = num(table.rows[totalRow][c]);
      if (want === null) continue;
      const parts = table.rows.filter((_, i) => i !== totalRow).map((row) => num(row[c]));
      if (parts.every((p) => p === null)) continue;
      const sum = parts.reduce<number>((a, p) => a + (p ?? 0), 0);
      if (Math.abs(sum - want) > Math.max(0.5, Math.abs(want) * 1e-6)) {
        out.push(check(doc, "TOTAL_MISMATCH", `In "${table.columns[c]}", the rows add up to ${sum.toLocaleString("en-US")}, not the typed total of ${want.toLocaleString("en-US")}.`, { pageId, elementId: e.id, details: { sum, total: want, column: c } }));
        break;
      }
    }
  }

  // --- Big changes with no words on the page --------------------------------
  const explains = /\b(increase|increased|decrease|decreased|rose|risen|fell|fallen|grew|growth|drop|dropped|declin\w*|reduc\w*|higher|lower|because|due to|driven|owing|change[sd]?)\b/i;
  const seen = new Set<string>();
  for (const b of ghgB) {
    if (b.binding.compare !== "prior") continue;
    const pct = resolved.values[b.idx]?.compare?.change_pct;
    if (pct === null || pct === undefined || Math.abs(pct) <= 20) continue;
    const key = `${b.pageId}|${b.binding.metric}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pageText = ix.texts.filter((t) => t.pageId === b.pageId && !t.hidden);
    const hasWords = pageText.some((t) => t.paragraphs.some((p) => explains.test(p)) || t.tokens.some((i) => /^change_/.test(ix.tokens[i]?.token.attrs.measure ?? "")));
    if (!hasWords) {
      out.push(check(doc, "YOY_UNEXPLAINED", `${label(b.binding)} changed by ${pct > 0 ? "+" : ""}${pct.toFixed(1)}% on the year before, and nothing on this page explains it.`, { pageId: b.pageId, elementId: b.elementId, details: { changePct: pct } }));
    }
  }
  return out;
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\s*-?[\d,]+(\.\d+)?\s*$/.test(v)) return Number(v.replace(/,/g, ""));
  return null;
};

const label = (b: GhgBinding) =>
  ({ total: "Total emissions", scope1: "Scope 1", scope2_location: "Scope 2 (location-based)", scope3: "Scope 3" } as Record<string, string>)[b.metric] ??
  (b.metric === "scope3_category" && b.scope3Category ? categoryName(b.scope3Category) : b.metric.replace(/_/g, " "));
