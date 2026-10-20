/**
 * DS-4 · the Elements drawer (05-ux rail tab "Elements"; D17): shapes, lines
 * and arrows, frames (5 masks), photo grids (2, 3, 4, 6), icons (our own set
 * plus a Lucide subset), SDG badges 1–17, ESG graphics drawn by us as
 * editable groups, and data elements. Payloads sit at x = y = 0; the FE
 * places them (centre of the page, or the drop point) and gives them ids.
 * Colours come from the theme (no fill = the theme's primary), so an element
 * fits every look and brand. Data elements carry a GHG binding by default;
 * the FE swaps in a KPI binding for a sustainability doc.
 */
import type { ElementGroup, ElementGroupPayload, ElementPayload } from "../../contracts";
import { SDG } from "../../../reporting/studio/render/icons";
import { ghg, textDoc } from "./kit";
import { LUCIDE_THEMES } from "./lucide";

export interface ElementSeed {
  slug: string;
  group: ElementGroup;
  name: string;
  tags: string[];
  license: string;
  payload: ElementPayload;
}

type Json = Record<string, unknown>;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** One element at the origin. */
const el = (type: string, w: number, h: number, props: Json, extra: Json = {}): ElementPayload =>
  ({ id: "el", type, frame: { x: 0, y: 0, w: r2(w), h: r2(h), rotation: 0 }, z: 1, source: "user", props, ...extra }) as unknown as ElementPayload;

/** A child of a group, at (x, y) inside the group box. */
const child = (slot: string, type: string, [x, y, w, h]: number[], props: Json, z: number) =>
  ({ id: slot, type, frame: { x: r2(x), y: r2(y), w: r2(w), h: r2(h), rotation: 0 }, z, source: "user", props }) as unknown as ElementGroupPayload["elements"][number];

const group = (w: number, h: number, elements: ElementGroupPayload["elements"]): ElementGroupPayload => ({ type: "group", w, h, elements });

const OWN = "own";
const LUCIDE = "lucide-isc";
const SDG_LICENSE = "sdg-colours";

function shapes(): ElementSeed[] {
  const s = (slug: string, name: string, tags: string[], w: number, h: number, props: Json): ElementSeed => ({ slug: `shape-${slug}`, group: "shapes", name, tags: ["shape", ...tags], license: OWN, payload: el("shape", w, h, props) });
  return [
    s("rect", "Rectangle", ["box", "block"], 60, 40, { shape: "rect" }),
    s("square", "Square", ["box"], 40, 40, { shape: "rect" }),
    s("rounded", "Rounded rectangle", ["box", "card"], 60, 40, { shape: "rect", radius: 4 }),
    s("pill", "Pill", ["badge", "tag"], 50, 14, { shape: "rect", radius: 7 }),
    s("circle", "Circle", ["round", "dot"], 40, 40, { shape: "ellipse" }),
    s("ellipse", "Ellipse", ["oval", "round"], 60, 36, { shape: "ellipse" }),
    s("tint", "Tinted panel", ["background", "panel", "card"], 80, 50, { shape: "rect", radius: 3, opacity: 0.12 }),
    s("bar", "Accent bar", ["rule", "band"], 40, 2.5, { shape: "rect" }),
    s("band", "Full-width band", ["background", "band", "bleed"], 216, 40, { shape: "rect", bleed: true }),
    s("column", "Side column", ["sidebar", "band"], 50, 120, { shape: "rect" }),
  ];
}

function lines(): ElementSeed[] {
  const l = (slug: string, name: string, tags: string[], w: number, h: number, props: Json): ElementSeed => ({ slug: `line-${slug}`, group: "lines", name, tags: ["line", ...tags], license: OWN, payload: el("line", w, h, props) });
  const across = (w: number) => ({ x1: 0, y1: 1, x2: w, y2: 1 });
  return [
    { slug: "line-divider", group: "lines", name: "Divider", tags: ["line", "rule", "separator"], license: OWN, payload: el("divider", 120, 1, { style: "solid" }) },
    l("solid", "Line", ["straight"], 80, 2, { ...across(80), strokeWidth: 0.5, dash: "solid" }),
    l("thick", "Thick line", ["bold"], 80, 3, { x1: 0, y1: 1.5, x2: 80, y2: 1.5, strokeWidth: 1.5, dash: "solid" }),
    l("dashed", "Dashed line", ["dash"], 80, 2, { ...across(80), strokeWidth: 0.5, dash: "dashed" }),
    l("dotted", "Dotted line", ["dots"], 80, 2, { ...across(80), strokeWidth: 0.8, dash: "dotted" }),
    l("arrow", "Arrow", ["arrow", "pointer", "flow"], 60, 4, { x1: 0, y1: 2, x2: 60, y2: 2, strokeWidth: 0.8, dash: "solid", endArrow: true }),
    l("double-arrow", "Double arrow", ["arrow", "both ways"], 60, 4, { x1: 0, y1: 2, x2: 60, y2: 2, strokeWidth: 0.8, dash: "solid", startArrow: true, endArrow: true }),
    l("dashed-arrow", "Dashed arrow", ["arrow", "dash"], 60, 4, { x1: 0, y1: 2, x2: 60, y2: 2, strokeWidth: 0.8, dash: "dashed", endArrow: true }),
    l("vertical", "Vertical line", ["vertical", "rule"], 2, 60, { x1: 1, y1: 0, x2: 1, y2: 60, strokeWidth: 0.5, dash: "solid" }),
    l("diagonal-arrow", "Diagonal arrow", ["arrow", "up", "growth"], 40, 30, { x1: 0, y1: 30, x2: 40, y2: 0, strokeWidth: 0.8, dash: "solid", endArrow: true }),
  ];
}

function frames(): ElementSeed[] {
  const masks = [
    ["rect", "Square frame", ["photo", "image"]],
    ["rounded", "Rounded frame", ["photo", "image", "card"]],
    ["circle", "Circle frame", ["photo", "portrait", "round"]],
    ["arch", "Arch frame", ["photo", "portrait"]],
    ["blob", "Organic frame", ["photo", "blob", "shape"]],
  ] as const;
  return masks.map(([mask, name, tags]) => ({ slug: `frame-${mask}`, group: "frames" as const, name, tags: ["frame", "mask", ...tags], license: OWN, payload: el("frame", 60, mask === "circle" ? 60 : 70, { mask, fit: "cover", alt: "" }) }));
}

function grids(): ElementSeed[] {
  const g = (n: number, columns: number, w: number, h: number): ElementSeed => ({
    slug: `grid-${n}`,
    group: "grids",
    name: `Photo grid, ${n} photos`,
    tags: ["grid", "collage", "photos", `${n}`],
    license: OWN,
    payload: el("grid", w, h, { columns, gap: 2, cells: Array.from({ length: n }, () => ({ alt: "" })) }),
  });
  return [g(2, 2, 120, 60), g(3, 3, 150, 50), g(4, 2, 120, 90), g(6, 3, 150, 100)];
}

const OWN_ICON_TAGS: Record<string, string[]> = {
  leaf: ["nature", "esg", "environment"],
  bolt: ["energy", "electricity"],
  factory: ["industry", "operations"],
  truck: ["transport", "logistics"],
  drop: ["water"],
  recycle: ["waste", "circular"],
  users: ["people", "social"],
  globe: ["world", "climate"],
  check: ["done", "general"],
  alert: ["warning", "risk"],
  info: ["note", "general"],
  flame: ["fuel", "energy", "scope 1"],
  building: ["office", "industry"],
  chart: ["data", "chart"],
  target: ["target", "goal"],
  sun: ["solar", "energy", "climate"],
  wind: ["wind", "energy", "climate"],
  shield: ["governance", "safety"],
  quote: ["quote", "text"],
  arrow_right: ["arrow", "general"],
  dot: ["dot", "general"],
};

function icons(): ElementSeed[] {
  const own: ElementSeed[] = Object.entries(OWN_ICON_TAGS).map(([name, tags]) => ({
    slug: `icon-${name}`,
    group: "icons",
    name: name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
    tags: ["icon", "esgLite", ...tags],
    license: OWN,
    payload: el("icon", 14, 14, { name }),
  }));
  const seen = new Set<string>();
  const lucide: ElementSeed[] = [];
  for (const [theme, names] of Object.entries(LUCIDE_THEMES)) {
    for (const name of names) {
      if (seen.has(name)) continue;
      seen.add(name);
      lucide.push({
        slug: `icon-lucide-${name}`,
        group: "icons",
        name: name.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
        tags: ["icon", theme, ...(["nature", "climate", "energy", "governance", "people"].includes(theme) ? ["esg"] : [])],
        license: LUCIDE,
        payload: el("icon", 14, 14, { name: `lucide:${name}` }),
      });
    }
  }
  return [...own, ...lucide];
}

function sdgs(): ElementSeed[] {
  return SDG.map((g, i) => ({
    slug: `sdg-${i + 1}`,
    group: "sdg" as const,
    name: `SDG ${i + 1}: ${g.label}`,
    tags: ["sdg", "un", "goal", `goal ${i + 1}`, g.label.toLowerCase()],
    license: SDG_LICENSE,
    payload: el("sdg", 30, 30, { goal: i + 1, variant: "full" }),
  }));
}

/** ESG graphics: editable groups. Text labels are our own wording. */
function esg(): ElementSeed[] {
  const t = (slot: string, f: number[], style: string, s: string, z: number, align = "center") => child(slot, "text", f, { doc: textDoc(s), style, align }, z);

  // Scope 1/2/3 value-chain diagram: upstream (Scope 3), the company (Scope 1 and 2), downstream (Scope 3), with arrows.
  const scopeDiagram = group(170, 70, [
    child("up_bg", "shape", [0, 10, 46, 50], { shape: "rect", radius: 3, opacity: 0.15 }, 1),
    child("own_bg", "shape", [62, 0, 46, 70], { shape: "rect", radius: 3 }, 2),
    child("down_bg", "shape", [124, 10, 46, 50], { shape: "rect", radius: 3, opacity: 0.15 }, 3),
    t("up_kicker", [2, 16, 42, 6], "kicker", "Upstream", 4),
    t("up_text", [2, 26, 42, 26], "caption", "Scope 3: purchased goods, transport, travel, commuting", 5),
    t("own_kicker", [64, 10, 42, 6], "kicker", "Our operations", 6),
    t("own_text", [64, 22, 42, 40], "caption", "Scope 1: fuel, processes, refrigerants. Scope 2: purchased energy", 7),
    t("down_kicker", [126, 16, 42, 6], "kicker", "Downstream", 8),
    t("down_text", [126, 26, 42, 26], "caption", "Scope 3: transport, use and end of life of products", 9),
    child("arrow1", "line", [47, 33, 14, 4], { x1: 0, y1: 2, x2: 14, y2: 2, strokeWidth: 0.8, dash: "solid", endArrow: true }, 10),
    child("arrow2", "line", [109, 33, 14, 4], { x1: 0, y1: 2, x2: 14, y2: 2, strokeWidth: 0.8, dash: "solid", endArrow: true }, 11),
  ]);

  // Pillar trio: Environment, Social, Governance.
  const pillars = group(150, 50, [
    ...[
      ["e", "leaf", "Environment"],
      ["s", "users", "Social"],
      ["g", "shield", "Governance"],
    ].flatMap(([k, icon, label], i) => [
      child(`${k}_bg`, "shape", [i * 52, 0, 46, 50], { shape: "rect", radius: 3, opacity: 0.12 }, 1 + i * 3),
      child(`${k}_icon`, "icon", [i * 52 + 16, 8, 14, 14], { name: icon }, 2 + i * 3),
      t(`${k}_label`, [i * 52 + 2, 28, 42, 10], "subheading", label, 3 + i * 3),
    ]),
  ]);

  // Upstream / own operations / downstream strip with five steps.
  const steps = [
    ["supply", "factory", "Suppliers"],
    ["inbound", "truck", "Inbound transport"],
    ["ops", "building", "Our sites"],
    ["outbound", "truck", "Distribution"],
    ["use", "users", "Use and end of life"],
  ];
  const strip = group(187, 44, [
    child("band", "shape", [0, 30, 187, 1.5], { shape: "rect" }, 1),
    ...steps.flatMap(([k, icon, label], i) => [
      child(`${k}_dot`, "shape", [i * 38 + 12, 25, 11, 11], { shape: "ellipse" }, 2 + i * 3),
      child(`${k}_icon`, "icon", [i * 38 + 11, 4, 13, 13], { name: icon }, 3 + i * 3),
      t(`${k}_label`, [i * 38, 37, 35, 7], "caption", label, 4 + i * 3),
    ]),
    t("up_tag", [0, 18, 60, 5], "kicker", "Upstream", 30, "left"),
    t("down_tag", [127, 18, 60, 5], "kicker", "Downstream", 31, "right"),
  ]);

  // Scope 3 wheel: categories 1–15 around a centre.
  const R = 48;
  const C = 60;
  const wheel = group(120, 120, [
    child("centre", "shape", [C - 20, C - 20, 40, 40], { shape: "ellipse" }, 1),
    t("centre_label", [C - 18, C - 5, 36, 10], "subheading", "Scope 3", 2),
    ...Array.from({ length: 15 }, (_, i) => {
      const a = (i / 15) * 2 * Math.PI - Math.PI / 2;
      const x = C + R * Math.cos(a) - 6;
      const y = C + R * Math.sin(a) - 6;
      return [child(`c${i + 1}`, "shape", [x, y, 12, 12], { shape: "ellipse", opacity: i < 8 ? 0.35 : 0.7 }, 3 + i * 2), t(`n${i + 1}`, [x, y + 3, 12, 6], "caption", String(i + 1), 4 + i * 2)];
    }).flat(),
    t("legend", [0, 112, 120, 8], "footnote", "Categories 1–8 upstream, 9–15 downstream", 40),
  ]);

  // Scope circles: Scope 1, 2 and 3 as three circles.
  const scopeCircles = group(152, 56, [
    ...[
      ["s1", "Scope 1", "Direct"],
      ["s2", "Scope 2", "Purchased energy"],
      ["s3", "Scope 3", "Value chain"],
    ].flatMap(([k, a, b], i) => [
      child(`${k}_circle`, "shape", [i * 52 + 6, 0, 36, 36], { shape: "ellipse", opacity: 0.2 + i * 0.25 }, 1 + i * 3),
      t(`${k}_label`, [i * 52, 13, 48, 8], "subheading", a, 2 + i * 3),
      t(`${k}_text`, [i * 52, 40, 48, 8], "caption", b, 3 + i * 3),
    ]),
  ]);

  const g = (slug: string, name: string, tags: string[], payload: ElementGroupPayload): ElementSeed => ({ slug: `esg-${slug}`, group: "esg", name, tags: ["esg", "graphic", "diagram", ...tags], license: OWN, payload });
  return [
    g("scope-diagram", "Scope 1, 2 and 3 value chain", ["scope", "value chain", "ghg"], scopeDiagram),
    g("scope-circles", "Scope circles", ["scope", "ghg"], scopeCircles),
    g("pillars", "Environment, social, governance", ["pillars", "e s g"], pillars),
    g("value-chain-strip", "Upstream to downstream strip", ["value chain", "upstream", "downstream"], strip),
    g("scope3-wheel", "Scope 3 categories wheel", ["scope 3", "categories", "15"], wheel),
  ];
}

function data(): ElementSeed[] {
  const d = (slug: string, name: string, tags: string[], payload: ElementPayload): ElementSeed => ({ slug: `data-${slug}`, group: "data", name, tags: ["data", ...tags], license: OWN, payload });
  return [
    d("big-number", "Big number", ["number", "figure", "headline"], el("big_number", 70, 30, { binding: ghg("total", { compare: "prior" }), label: "tCO₂e", showDelta: true })),
    d("kpi-tile", "KPI tile", ["tile", "card", "kpi"], el("kpi_tile", 70, 30, { binding: ghg("total", { compare: "prior" }), label: "Total emissions", showDelta: true, showSparkline: false, variant: "card" })),
    d("progress-ring", "Progress ring", ["progress", "ring", "percentage"], el("progress", 40, 40, { binding: ghg("primary_data_pct"), variant: "ring", label: "Supplier-specific data" })),
    d("progress-bar", "Progress bar", ["progress", "bar", "percentage"], el("progress", 80, 20, { binding: ghg("primary_data_pct"), variant: "bar", label: "Supplier-specific data" })),
    d("callout", "Callout", ["note", "box", "highlight"], el("callout", 80, 24, { doc: textDoc("A short note that stands out."), icon: "info", tone: "accent" })),
    d("chart-split", "Chart: by scope", ["chart", "donut", "scope"], el("chart", 80, 70, { binding: ghg("total", { breakdown: "scope" }), kind: "scope_split", title: "Emissions by scope", options: { showValues: true } })),
    d("chart-bars", "Chart: bars", ["chart", "bar", "categories"], el("chart", 120, 80, { binding: ghg("scope3", { breakdown: "scope3_category", top: 8 }), kind: "category_bars", title: "Scope 3 by category", options: { horizontal: true, showValues: true } })),
    d("chart-line", "Chart: trend", ["chart", "line", "trend"], el("chart", 120, 70, { binding: ghg("total", { years: { last: 5 } }), kind: "line", title: "Five-year trend", options: { showValues: true } })),
    d("table", "Table", ["table", "rows", "sites"], el("table", 120, 60, { binding: ghg("total", { breakdown: "site" }), style: "zebra", totalRow: true })),
    d("text", "Text box", ["text", "paragraph"], el("text", 80, 20, { doc: textDoc("Add your text"), style: "body", align: "left" })),
    d("page-number", "Page number", ["page", "number", "footer"], el("page_number", 30, 6, { format: "n", align: "right" })),
    d("qr", "QR code", ["qr", "link", "url"], el("qr", 25, 25, { url: "https://example.com" })),
    d("placeholder", "Placeholder", ["placeholder", "slot"], el("placeholder", 80, 50, { accepts: ["image", "chart", "text"], hint: "Drop an image, chart or text here" })),
  ];
}

export function elementSeeds(): ElementSeed[] {
  return [...shapes(), ...lines(), ...frames(), ...grids(), ...icons(), ...sdgs(), ...esg(), ...data()];
}

/** Licence ids every element names; data/studio/LICENSES.md has a section for each. */
export const LICENSE_IDS = [OWN, LUCIDE, SDG_LICENSE] as const;
