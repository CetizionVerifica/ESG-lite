/**
 * IN-8 · the one-page PDF snapshot's HTML (I16): A4 landscape, hero strip, decoupling, ESG
 * readiness (KPI on), pathway, target wall and the top three cards, with a footer naming the
 * period, the sites and "Generated {date} from approved data". Self-contained: inline CSS and
 * SVG, paged.js inlined (the existing printer `htmlToPdf` waits for `window.__ready` and counts
 * `.pagedjs_page`). Every figure is an API value, only formatted here (no arithmetic on reported
 * figures; chart coordinates are drawing only). Every text from data is escaped.
 *
 *   snapshotHtml(input, {withScripts})  `withScripts: false` leaves paged.js out (unit tests)
 *   cardSentence(card)                  01-contracts §6 copy in plain words (the FE's cardCopy.ts
 *                                       holds the on-screen templates; these are the print copy)
 */
import { readFileSync } from "node:fs";
import type { Cards, Decoupling, EsgRing, InsightCard, Pathway, Summary, TargetWall } from "../contracts/panels";

export interface SnapshotInput {
  company: string;
  label: string;
  generated: string;
  summary: Summary | null;
  decoupling: Decoupling | null;
  ring: EsgRing | null;
  pathway: Pathway | null;
  wall: TargetWall | null;
  cards: Cards["cards"];
  pending: { emissions: number; kpi_values: number };
}

export const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** A number for print: grouped, at most `dp` decimals; "—" for null. */
export const fmt = (v: number | null | undefined, dp = 1): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-GB", { maximumFractionDigits: dp });

/** tCO₂e for print: grouped, 3 decimals like every tCO₂e figure (#209); "—" for null. */
export const fmtT = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** A change in words: "down 4.3 %" / "up 2 %" / "no change". */
export const change = (pct: number | null | undefined): string =>
  pct === null || pct === undefined ? "—" : pct === 0 ? "no change" : `${pct < 0 ? "down" : "up"} ${fmt(Math.abs(pct))} %`;

const STATUS_WORDS: Record<string, string> = { on_track: "On track", at_risk: "At risk", off_track: "Off track", reached: "Reached", no_data: "No data" };
export const statusWord = (s: string | null | undefined) => (s ? STATUS_WORDS[s] ?? s : "No target");

const p = (c: InsightCard, k: string) => esc(c.params[k]);

/** The print sentence of a card (01-contracts §6). */
export function cardSentence(c: InsightCard): string {
  switch (c.rule) {
    case "decoupling":
      return `Output is up ${p(c, "output_pct")}% since ${p(c, "base_year")} while emissions fell ${p(c, "emissions_pct")}%.`;
    case "largest_source":
      return `${p(c, "category")} is ${p(c, "share_pct")}% of your footprint.`;
    case "site_concentration":
      return `${p(c, "site")} is ${p(c, "share_pct")}% of Scope ${p(c, "scope")}.`;
    case "pathway_gap":
      return `Emissions are ${p(c, "gap_pct")}% above the ${p(c, "target_year")} pathway.`;
    case "pathway_on_track":
      return `You're ${p(c, "margin_pct")}% below your pathway this year.`;
    case "target_off_track":
      return `${p(c, "count")} targets are off track, including ${p(c, "first_name")}.`;
    case "renewables_jump":
      return `Renewable electricity rose from ${p(c, "from_pct")}% to ${p(c, "to_pct")}%.`;
    case "intensity_change":
      return `Intensity ${c.severity === "good" ? "fell" : "rose"} ${p(c, "change_pct")}% per ${p(c, "unit")}.`;
    case "biggest_mover":
      return `${p(c, "name")} changed ${p(c, "change_pct")}% on last year.`;
    case "coverage_gap":
      return `${p(c, "pillar")} data is ${p(c, "pct")}% complete: ${p(c, "missing")} values missing.`;
    case "pending_large":
      return `${p(c, "count")} entries waiting for approval could change these figures.`;
    default:
      return "";
  }
}

let pagedCache: string | null = null;
const pagedJs = () => {
  if (pagedCache !== null) return pagedCache;
  for (const f of ["node_modules/pagedjs/dist/paged.polyfill.min.js", "node_modules/pagedjs/dist/paged.polyfill.js"]) {
    try {
      pagedCache = readFileSync(f, "utf8");
      return pagedCache;
    } catch {
      /* next */
    }
  }
  throw new Error("paged.js not found");
};

/** Three index lines (output, emissions, intensity) as an inline SVG; drawing coordinates only. */
function decouplingSvg(d: Decoupling): string {
  const W = 420;
  const H = 150;
  const pad = 24;
  const all = d.series.flatMap((s) => s.index.filter((v): v is number => v !== null));
  if (!all.length) return "";
  const lo = Math.min(...all, 100);
  const hi = Math.max(...all, 100);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (d.years.length > 1 ? (i * (W - 2 * pad)) / (d.years.length - 1) : 0);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const styles: Record<string, string> = { output: "stroke:#2f5d8a;", emissions: "stroke:#3c8d5a;", intensity: "stroke:#8a8a8a;stroke-dasharray:4 3;" };
  const lines = d.series
    .map((s) => {
      const pts = s.index.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
      return `<polyline fill="none" style="${styles[s.key] ?? "stroke:#444;"}stroke-width:2" points="${pts.join(" ")}"/>`;
    })
    .join("");
  const base = `<line x1="${pad}" x2="${W - pad}" y1="${y(100).toFixed(1)}" y2="${y(100).toFixed(1)}" style="stroke:#ccc;stroke-width:1"/>`;
  const labels = d.years.map((yr, i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="8" text-anchor="middle" fill="#666">${esc(yr)}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Output, emissions and intensity indexed to ${esc(d.base_year)}">${base}${lines}${labels}</svg>`;
}

export function snapshotHtml(input: SnapshotInput, opts: { withScripts?: boolean } = {}): string {
  const s = input.summary;
  const hero = s
    ? `<div class="hero">
  <div class="cell"><div class="k">Net emissions</div><div class="v">${fmtT(s.net.value)} <small>tCO₂e</small></div><div class="m">${esc(change(s.net.change_pct))} on last year · ${esc(s.pathway ? statusWord(s.pathway.status) : "No target")}</div></div>
  <div class="cell"><div class="k">Intensity</div><div class="v">${fmt(s.intensity.value, 3)} <small>tCO₂e per ${esc(s.intensity.unit)}</small></div><div class="m">${esc(change(s.intensity.change_pct))}${s.intensity.combined ? " · combined index" : ""}</div></div>
  <div class="cell"><div class="k">${s.readiness ? "ESG readiness" : "Renewable share"}</div><div class="v">${s.readiness ? `${fmt(s.readiness.pct, 0)} <small>% of KPIs approved</small>` : `${fmt(s.renewable_share_pct, 0)} <small>% of electricity</small>`}</div><div class="m">${
        s.readiness ? `E ${esc(fmt(s.readiness.by_pillar.environment, 0))} % · S ${esc(fmt(s.readiness.by_pillar.social, 0))} % · G ${esc(fmt(s.readiness.by_pillar.governance, 0))} %` : "&nbsp;"
      }</div></div>
  <div class="cell"><div class="k">Needs you</div><div class="v">${fmt(s.attention.total, 0)}</div><div class="m">${s.attention.items.map((i) => `${esc(i.kind.replace(/_/g, " "))} ${fmt(i.count, 0)}`).join(" · ") || "Nothing waiting"}</div></div>
</div>`
    : "";
  const d = input.decoupling;
  const dec = d
    ? `<section><h2>Growing without carbon</h2>${decouplingSvg(d)}<p class="m">Since ${esc(d.base_year)}: output ${esc(change(d.headline.output_change_pct))}, emissions ${esc(change(d.headline.emissions_change_pct))}, intensity ${esc(change(d.headline.intensity_change_pct))}.${d.combined_output ? " Output is a combined index of sites with different units." : ""}</p></section>`
    : `<section><h2>Growing without carbon</h2><p class="m">Needs approved emissions and production for two years.</p></section>`;
  const r = input.ring;
  const ring = r
    ? `<section><h2>ESG data readiness · ${fmt(r.pct, 0)} %</h2><table><tr><th>Pillar</th><th>KPIs</th><th>Approved</th><th>Coverage</th></tr>${r.pillars
        .map((x) => `<tr><td>${esc(x.label)}</td><td class="n">${fmt(x.kpis, 0)}</td><td class="n">${fmt(x.approved, 0)}</td><td class="n">${fmt(x.coverage_pct, 0)} %</td></tr>`)
        .join("")}</table></section>`
    : "";
  const pw = input.pathway;
  const path = pw
    ? `<section><h2>Pathway to ${esc(pw.target_year)} (${fmt(pw.annual_rate_pct, 1)} % a year)</h2><table><tr><th>Year</th><th>Pathway</th><th>Scope 1</th><th>Scope 2</th><th>Scope 3</th></tr>${pw.years
        .map((yr, i) => `<tr><td>${esc(yr)}</td><td class="n">${fmtT(pw.pathway[i])}</td><td class="n">${fmtT(pw.actual.s1[i])}</td><td class="n">${fmtT(pw.actual.s2[i])}</td><td class="n">${fmtT(pw.actual.s3[i])}</td></tr>`)
        .join("")}</table></section>`
    : `<section><h2>Pathway</h2><p class="m">Set a base year in Targets to see your pathway.</p></section>`;
  const w = input.wall;
  const wall = w && w.items.length
    ? `<section><h2>Targets</h2><table><tr><th>Target</th><th>Progress</th><th>Expected</th><th>Status</th></tr>${w.items
        .slice(0, 8)
        .map((it) => `<tr><td>${esc(it.name)}</td><td class="n">${fmt(it.progress_pct, 0)} %</td><td class="n">${fmt(it.expected_pct, 0)} %</td><td>${esc(statusWord(it.status))}</td></tr>`)
        .join("")}</table></section>`
    : `<section><h2>Targets</h2><p class="m">No targets set yet.</p></section>`;
  const cards = input.cards.length
    ? `<section class="cards">${input.cards.map((c) => `<div class="card ${esc(c.severity)}"><b>${esc(c.severity === "critical" ? "Critical" : c.severity === "attention" ? "Needs attention" : c.severity === "good" ? "Good news" : "Info")}</b> ${cardSentence(c)}</div>`).join("")}</section>`
    : "";
  const pending = input.pending.emissions + input.pending.kpi_values > 0 ? ` · ${fmt(input.pending.emissions, 0)} entries and ${fmt(input.pending.kpi_values, 0)} KPI values waiting for approval are not included` : "";
  const scripts =
    opts.withScripts === false
      ? ""
      : `<script>window.PagedConfig = { auto: false };</script><script>${pagedJs()}</script>
<script>(async function(){try{await window.PagedPolyfill.preview();}catch(e){window.__error=String(e&&e.stack||e);}window.__ready=true;})();</script>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(`Insights · ${input.company} · ${input.label}`)}</title>
<style>
@page { size: A4 landscape; margin: 10mm 12mm; }
* { box-sizing: border-box; }
body { font-family: "IBM Plex Sans", Arial, sans-serif; color: #1b1f2a; font-size: 8pt; margin: 0; }
.sheet { height: 186mm; overflow: hidden; display: flex; flex-direction: column; gap: 3mm; }
header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #ddd; padding-bottom: 2mm; }
header h1 { font-size: 14pt; margin: 0; } header .l { color: #555; }
.hero { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; }
.cell { border: 1px solid #e3e3e3; border-radius: 2mm; padding: 2mm 3mm; }
.k { color: #555; font-size: 7pt; text-transform: uppercase; letter-spacing: .03em; } .v { font-size: 15pt; font-weight: 600; } .v small { font-size: 7pt; font-weight: 400; color: #555; } .m { color: #555; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; flex: 1; min-height: 0; }
section { border: 1px solid #e3e3e3; border-radius: 2mm; padding: 2mm 3mm; overflow: hidden; }
h2 { font-size: 9pt; margin: 0 0 1mm; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: .4mm 1mm; border-bottom: 1px solid #f0f0f0; } td.n { text-align: right; font-variant-numeric: tabular-nums; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; border: 0; padding: 0; }
.card { border: 1px solid #e3e3e3; border-left: 3px solid #8a8a8a; border-radius: 2mm; padding: 2mm 3mm; }
.card.good { border-left-color: #3c8d5a; } .card.attention { border-left-color: #c58a00; } .card.critical { border-left-color: #b3261e; }
footer { color: #666; font-size: 7pt; border-top: 1px solid #ddd; padding-top: 1.5mm; }
</style></head>
<body><div class="sheet">
<header><h1>${esc(input.company)} · Insights</h1><span class="l">${esc(input.label)}</span></header>
${hero}
<div class="grid">${dec}${ring || path}${ring ? path : ""}${wall}</div>
${cards}
<footer>${esc(input.label)} · Generated ${esc(input.generated)} from approved data${esc(pending)}</footer>
</div>${scripts}</body></html>`;
}
