// Block library: renders each typed Report block to HTML. The set of blocks IS
// the design system — the LLM chooses blocks and fills them; it never authors
// layout. Chart blocks emit a sized placeholder and register an ECharts option
// that the browser renders before pagination.

import { buildChartOption } from "./charts";
import type { Block, Theme } from "./types";
import { makeRng, type Variety } from "./variety";

export interface RenderedBlocks {
  html: string;
  charts: unknown[];
}

const DEFAULT_VARIETY: Variety = {
  seed: 0,
  coverVariant: "gradient",
  coverBgSvg: null,
  heroImage: null,
  heroPanelSvg: "",
  docCoverMode: "split",
  kpiStyle: "row",
  sectionStyle: "plain",
};

const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Dynamic layout: instead of stacking every block full-width, group the linear
 * block list into seed-driven rows — a text block paired side-by-side with the
 * next visual (chart/image/table/kpis, alternating which side), two callouts
 * side-by-side, or a full-width row. Different seed → different placement, so no
 * two generations look the same. Structural blocks (cover/section/statBoard)
 * always stand alone.
 */
type Row =
  | { kind: "full"; block: Block }
  | { kind: "twoup"; a: Block; b: Block }
  | { kind: "pair"; left: Block; right: Block; textSide: "left" | "right"; variant: string };

const VISUAL = new Set(["chart", "image", "table", "kpiTiles"]);

function buildRows(blocks: Block[], rng: () => number): Row[] {
  const rows: Row[] = [];
  // Per-report pairing bias so different seeds feel structurally different: some
  // reports lean heavily side-by-side, others lean stacked/full-width.
  const pairBias = 0.35 + rng() * 0.5; // 0.35–0.85
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    const next = blocks[i + 1];
    if (b.type === "narrative" && next && VISUAL.has(next.type) && rng() < pairBias) {
      // Side chosen independently per pair from the seed → charts/images scatter
      // left and right differently every generation.
      const textSide = rng() < 0.5 ? "left" : "right";
      rows.push({ kind: "pair", left: b, right: next, textSide, variant: next.type });
      i += 2;
      continue;
    }
    if (b.type === "callout" && next && next.type === "callout") {
      rows.push({ kind: "twoup", a: b, b: next });
      i += 2;
      continue;
    }
    rows.push({ kind: "full", block: b });
    i += 1;
  }
  return rows;
}

export function renderBlocks(blocks: Block[], theme: Theme, variety: Variety = DEFAULT_VARIETY): RenderedBlocks {
  const charts: unknown[] = [];
  const rng = makeRng((variety.seed >>> 0) ^ 0x9e3779b9);
  const rows = buildRows(blocks, rng);
  const parts = rows.map((row) => {
    if (row.kind === "full") return renderBlock(row.block, theme, charts, variety);
    if (row.kind === "twoup") {
      return `<div class="lrow lrow--twoup">${renderBlock(row.a, theme, charts, variety)}${renderBlock(row.b, theme, charts, variety)}</div>`;
    }
    const left = renderBlock(row.left, theme, charts, variety);
    const right = renderBlock(row.right, theme, charts, variety);
    const cls = `lrow lrow--pair pair-${row.variant}` + (row.textSide === "right" ? " reverse" : "");
    return `<div class="${cls}"><div class="lcol lcol-text">${left}</div><div class="lcol lcol-visual">${right}</div></div>`;
  });
  return { html: parts.join("\n"), charts };
}

function renderBlock(block: Block, theme: Theme, charts: unknown[], variety: Variety): string {
  switch (block.type) {
    case "cover":
      return renderCover(block, theme, variety);
    case "section":
      return renderSection(block, variety);
    case "kpiTiles":
      return renderKpis(block, variety);
    case "narrative":
      return renderNarrative(block);
    case "chart":
      return renderChart(block, theme, charts);
    case "table":
      return renderTable(block);
    case "callout":
      return renderCallout(block);
    case "statBoard":
      return renderStatBoard(block);
    case "image":
      return renderImage(block);
  }
}

function renderImage(b: Extract<Block, { type: "image" }>): string {
  if (!b.src) return ""; // only render once an image has been generated
  const cls = b.layout === "banner" ? "figure-banner" : "figure-full";
  return `<figure class="block figure ${cls}">
    <img src="${b.src}" alt="">
    ${b.caption ? `<figcaption>${esc(b.caption)}</figcaption>` : ""}
  </figure>`;
}

function renderCover(b: Extract<Block, { type: "cover" }>, theme: Theme, variety: Variety): string {
  if (b.style === "document") return renderDocCover(b, theme, variety);

  const meta = (b.meta ?? [])
    .map(
      (m) =>
        `<div class="cover-meta-item"><span class="cover-meta-label">${esc(
          m.label
        )}</span><span class="cover-meta-value">${esc(m.value)}</span></div>`
    )
    .join("");
  const bg = variety.heroImage
    ? `<img class="cover-bg-img" src="${variety.heroImage}" alt="">`
    : variety.coverBgSvg
    ? `<div class="cover-bg">${variety.coverBgSvg}</div>`
    : "";
  return `<section class="cover cover--${variety.coverVariant}">
  ${bg}
  <div class="cover-inner">
    <div class="cover-top">
      <div class="cover-logo">${theme.logoSvg ?? esc(theme.name)}</div>
    </div>
    <div class="cover-main">
      <h1 class="cover-title">${esc(b.title)}</h1>
      ${b.subtitle ? `<p class="cover-subtitle">${esc(b.subtitle)}</p>` : ""}
    </div>
    <div class="cover-meta">${meta}</div>
  </div>
</section>`;
}

/** Document-style cover: white, two-column — logo/title/cards left, hero right. */
function renderDocCover(b: Extract<Block, { type: "cover" }>, theme: Theme, variety: Variety): string {
  const cards = (b.infoCards ?? [])
    .map(
      (c) =>
        `<div class="info-card"><div class="info-card-label">${esc(c.label)}</div><div class="info-card-value">${esc(
          c.value
        )}</div></div>`
    )
    .join("");
  const logo = theme.logoSvg ?? esc(theme.name);
  const heroSrc = b.hero ?? variety.heroImage;
  const bg = heroSrc ? `<img src="${heroSrc}" alt="">` : variety.heroPanelSvg;
  const titleBlock =
    `<h1 class="doc-title">${esc(b.title)}</h1>` +
    (b.subtitle ? `<p class="doc-subtitle">${esc(b.subtitle)}</p>` : "") +
    (b.caption ? `<p class="doc-caption">${esc(b.caption)}</p>` : "");

  // Full-bleed hero cover: image fills the page, content overlaid (white logo/text read on the dark scrim).
  if (variety.docCoverMode === "fullbleed") {
    return `<section class="cover cover--hero">
  <div class="hero-bg">${bg}</div>
  <div class="hero-logo">${logo}</div>
  <div class="hero-inner">
    ${titleBlock}
    ${cards ? `<div class="doc-cards hero-cards">${cards}</div>` : ""}
  </div>
</section>`;
  }

  // Split cover: two columns — logo/title/cards left, hero right.
  const heroMedia = heroSrc
    ? `<img class="doc-hero-media" src="${heroSrc}" alt="">`
    : `<div class="doc-hero-media">${variety.heroPanelSvg}</div>`;
  return `<section class="cover cover--document">
  <div class="doc-left">
    <div class="doc-logo">${logo}</div>
    <div class="doc-head">${titleBlock}</div>
    ${cards ? `<div class="doc-cards">${cards}</div>` : ""}
  </div>
  <div class="doc-right"><div class="doc-hero">${heroMedia}</div></div>
</section>`;
}

function renderStatBoard(b: Extract<Block, { type: "statBoard" }>): string {
  const kpis = b.kpis
    .map(
      (k) =>
        `<div class="stat-kpi"><div class="stat-kpi-value">${esc(k.value)}</div><div class="stat-kpi-label">${esc(
          k.label
        )}</div>${k.sub ? `<div class="stat-kpi-sub">${esc(k.sub)}</div>` : ""}</div>`
    )
    .join("");
  const tiles = (b.tiles ?? [])
    .map(
      (t) =>
        `<div class="stat-tile"><div class="stat-tile-label">${esc(t.label)}</div><div class="stat-tile-value">${esc(
          t.value
        )}</div></div>`
    )
    .join("");
  return `<div class="block statboard">
    ${b.badge ? `<div class="stat-badge">${esc(b.badge)}</div>` : ""}
    ${b.title ? `<h2 class="stat-title">${esc(b.title)}</h2>` : ""}
    <div class="stat-kpis">${kpis}</div>
    ${tiles ? `<div class="stat-tiles">${tiles}</div>` : ""}
  </div>`;
}

function renderSection(b: Extract<Block, { type: "section" }>, variety: Variety): string {
  return `<section class="section-head section-head--${variety.sectionStyle}">
    ${b.kicker ? `<div class="section-kicker">${esc(b.kicker)}</div>` : ""}
    <h2 class="section-title">${esc(b.title)}</h2>
    <div class="section-rule"></div>
  </section>`;
}

function renderKpis(b: Extract<Block, { type: "kpiTiles" }>, variety: Variety): string {
  const tiles = b.tiles
    .map(
      (t) => `<div class="kpi">
        <div class="kpi-label">${esc(t.label)}</div>
        <div class="kpi-value">${esc(t.value)}${
        t.unit ? `<span class="kpi-unit">${esc(t.unit)}</span>` : ""
      }</div>
        ${
          t.delta
            ? `<div class="kpi-delta ${t.positive ? "good" : "bad"}">${esc(t.delta)}</div>`
            : ""
        }
      </div>`
    )
    .join("");
  return `<div class="block kpi-block">
    ${b.title ? `<h3 class="block-title">${esc(b.title)}</h3>` : ""}
    <div class="kpi-grid kpi-grid--${variety.kpiStyle}">${tiles}</div>
  </div>`;
}

function renderNarrative(b: Extract<Block, { type: "narrative" }>): string {
  const title = b.title ? `<h3 class="block-title">${esc(b.title)}</h3>` : "";
  const paras = b.body.map((p) => `<p>${esc(p)}</p>`);
  // Two balanced columns (real grid — Paged.js-safe) to fill the wide square page.
  let body: string;
  if (paras.length >= 2) {
    const mid = Math.ceil(paras.length / 2);
    body = `<div class="narrative-grid"><div>${paras.slice(0, mid).join("")}</div><div>${paras.slice(mid).join("")}</div></div>`;
  } else {
    body = paras.join("");
  }
  return `<div class="block narrative">${title}${body}</div>`;
}

function renderChart(
  b: Extract<Block, { type: "chart" }>,
  theme: Theme,
  charts: unknown[]
): string {
  const idx = charts.length;
  charts.push(buildChartOption(b, theme));
  return `<figure class="block chart-block">
    ${b.title ? `<figcaption class="block-title">${esc(b.title)}</figcaption>` : ""}
    ${b.subtitle ? `<div class="block-subtitle">${esc(b.subtitle)}</div>` : ""}
    <div class="chart" id="chart-${idx}"></div>
    ${b.caption ? `<div class="chart-caption">${esc(b.caption)}</div>` : ""}
  </figure>`;
}

function renderTable(b: Extract<Block, { type: "table" }>): string {
  const align = b.align ?? [];
  const head = b.columns
    .map((c, i) => `<th style="text-align:${align[i] ?? "left"}">${esc(c)}</th>`)
    .join("");
  const body = b.rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => `<td style="text-align:${align[i] ?? "left"}">${esc(cell)}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<div class="block table-block">
    ${b.title ? `<h3 class="block-title">${esc(b.title)}</h3>` : ""}
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    ${b.caption ? `<div class="chart-caption">${esc(b.caption)}</div>` : ""}
  </div>`;
}

function renderCallout(b: Extract<Block, { type: "callout" }>): string {
  const variant = b.variant ?? "info";
  return `<div class="block callout callout-${variant}">
    <div class="callout-title">${esc(b.title)}</div>
    <div class="callout-body">${esc(b.body)}</div>
  </div>`;
}
