/**
 * DS-4 · sustainability designs (RS-3 Editorial, Night, Minimal) as
 * `report_template` rows of kind `sustainability`. Each design has the same
 * layout kinds (cover, contents, leadership, about, highlights, chapter
 * opener, four data pages, targets, materiality, people, quote, back cover)
 * drawn in its own arrangement; the look sets the colours and fonts, the
 * client's brand overrides them. Figures are KPI bindings on ESG headline
 * codes (src/kpi/esg/headlines.ts), resolved from APPROVED KPI values (DS-2);
 * a KPI the client doesn't track shows "Not reported".
 */
import type { FamilySeed, LayoutSeed, PageBuilder, TemplatePageSeed } from "./kit";
import { chip, columns, doc, kpi, page, para } from "./kit";

type Design = "editorial" | "night" | "minimal";
const F = "a4" as const;

const top = (p: PageBuilder, d: Design, kicker: string, heading: string) => {
  if (d === "minimal") {
    p.rule("toprule", [p.M, p.M, p.CW, 0.4]).kicker("kicker", [p.M, p.M + 4, p.CW, 6], kicker).heading("heading", [p.M, p.M + 12, p.CW, 14], heading);
  } else {
    p.kicker("kicker", [p.M, p.M, p.CW, 6], kicker).heading("heading", [p.M, p.M + 8, p.CW, 14], heading);
    if (d === "night") p.block("accent", [p.M, p.M + 24, 24, 1.5]);
  }
  return p;
};
const footer = (p: PageBuilder, d: Design, label: string) => (d === "minimal" ? p.pageNumber("pn", "center") : p.footer(label));

function cover(d: Design): LayoutSeed {
  const p = page("cover", "cover", "Cover", F);
  if (d === "editorial") {
    p.photo("hero", [-3, -3, 216, 170], "Cover image", "rect", true)
      .block("band", [p.M, 178, 40, 2.5])
      .kicker("kicker", [p.M, 186, p.CW, 6], "Sustainability report")
      .title("title", [p.M, 194, p.CW, 34], "{{company}}")
      .sub("period", [p.M, 232, p.CW, 10], "{{period}}");
  } else if (d === "night") {
    p.photo("hero", [105, -3, 108, 303], "Cover image", "rect", true)
      .kicker("kicker", [p.M, 120, 80, 6], "Sustainability report")
      .title("title", [p.M, 130, 80, 60], "{{company}}")
      .block("band", [p.M, 196, 24, 2])
      .sub("period", [p.M, 204, 80, 10], "{{period}}");
  } else {
    p.rule("rule", [p.M, 60, p.CW, 0.4])
      .kicker("kicker", [p.M, 66, p.CW, 6], "Sustainability report · {{period}}")
      .title("title", [p.M, 76, 150, 40], "{{company}}")
      .photo("mark", [132, 180, 60, 60], "A small image or your logo", "circle");
  }
  return p.caption("source", [p.M, 270, 120, 8], "Figures from approved KPI values.").build();
}

function contents(d: Design): LayoutSeed {
  const p = page("contents", "contents", "Contents", F);
  top(p, d, "Contents", "In this report");
  const chapters = ["About this report", "Highlights", "Environment", "Social", "Governance", "Data and indexes"];
  chapters.forEach((c, i) => {
    const y = 50 + i * 22;
    p.text(`n${i + 1}`, [p.M, y, 16, 12], d === "minimal" ? "subheading" : "big_number", String(i + 1).padStart(2, "0")).sub(`c${i + 1}`, [p.M + 22, y + 2, p.CW - 22, 10], c);
  });
  if (d !== "minimal") p.photo("photo", [p.M, 190, p.CW, 70], "A photo for the contents page", d === "night" ? "rect" : "rounded");
  return footer(p, d, "Contents").build();
}

function leadership(d: Design): LayoutSeed {
  const p = page("leadership", "leadership", "Leadership message", F);
  top(p, d, "Leadership message", "A message from our leadership");
  const portrait: [number, number, number, number] = d === "minimal" ? [p.M, 46, 40, 40] : [p.M, 46, 60, 76];
  p.photo("portrait", portrait, "Portrait of the author", d === "editorial" ? "arch" : d === "night" ? "rounded" : "circle");
  const x = d === "minimal" ? p.M + 50 : p.M + 70;
  p.quote("pull", [x, 46, p.W - p.M - x, 40], "A sentence from the message that sums it up.")
    .body(
      "message",
      [p.M, 130, p.CW, 110],
      doc(
        para("Write the leadership message here, or ask AI to draft it from Report details. Say what changed this year, what you are proud of and what still needs work."),
        para("Keep numbers in data chips, such as Scope 1 and 2 emissions of ", chip(kpi("GHG_SCOPE1_2")), "."),
      ),
      "justify",
    )
    .sub("signature", [p.M, 248, 100, 10], "Name, title");
  return footer(p, d, "Leadership message").build();
}

function about(d: Design): LayoutSeed {
  const p = page("about", "about", "About us", F);
  top(p, d, "About this report", "Who we are");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 8);
  p.body("about", [x1, 46, w, 100], "Describe the company: what it makes, where it operates and how many people it employs. This text comes from Report details when it is filled in.")
    .photo("photo", [x2, 46, w, 100], "A photo of a site or team", d === "editorial" ? "rect" : "rounded")
    .bigNumber("employees", [x1, 154, w, 30], kpi("EMPLOYEES_TOTAL"), "Employees")
    .tile("energy", [x2, 154, w, 30], kpi("ENERGY_TOTAL"), "Energy used", d === "minimal" ? "plain" : "card")
    .sub("scope_heading", [p.M, 196, p.CW, 8], "About this report")
    .body("scope", [p.M, 206, p.CW, 50], "The reporting period, the entities and sites covered, the frameworks used (see the indexes at the end) and who to contact with questions.");
  return footer(p, d, "About").build();
}

const HIGHLIGHTS = [
  ["ghg", "GHG_SCOPE1_2", "Scope 1 and 2 emissions"],
  ["energy", "ENERGY_TOTAL", "Energy used"],
  ["water", "WATER_WITHDRAWAL", "Water withdrawn"],
  ["waste", "WASTE_GENERATED", "Waste generated"],
  ["people", "EMPLOYEES_TOTAL", "Employees"],
  ["women", "WOMEN_IN_WORKFORCE", "Women in the workforce"],
] as const;

function highlights(d: Design): LayoutSeed {
  const p = page("highlights", "highlights", "Highlights", F);
  top(p, d, "Highlights", "The year in numbers");
  const cols = columns(p.M, p.CW, d === "editorial" ? 3 : 2, 6);
  const rowH = d === "editorial" ? 56 : 50;
  HIGHLIGHTS.forEach(([slot, code, label], i) => {
    const c = cols[i % cols.length];
    const y = 50 + Math.floor(i / cols.length) * (rowH + 6);
    if (d === "minimal") p.bigNumber(slot, [c[0], y, c[1], rowH], kpi(code, { compare: "prior" }), label, { showDelta: true });
    else p.tile(slot, [c[0], y, c[1], rowH], kpi(code, { compare: "prior" }), label, d === "night" ? "band" : "card", { showDelta: true, showSparkline: true });
  });
  p.caption("note", [p.M, 250, p.CW, 10], "Change against the previous year. KPIs the company doesn't track show as not reported.");
  return footer(p, d, "Highlights").build();
}

function chapterOpener(d: Design): LayoutSeed {
  const p = page("chapter", "chapter_opener", "Chapter opener", F);
  if (d === "editorial") {
    p.photo("photo", [-3, -3, 216, 160], "A photo for the chapter", "rect", true)
      .kicker("kicker", [p.M, 172, p.CW, 6], "Chapter")
      .title("title", [p.M, 180, p.CW, 30], "Chapter title")
      .body("text", [p.M, 214, 130, 40], "One or two sentences on what this chapter covers.");
  } else if (d === "night") {
    p.block("band", [p.M, 110, 30, 3])
      .kicker("kicker", [p.M, 120, p.CW, 6], "Chapter")
      .title("title", [p.M, 128, p.CW, 40], "Chapter title")
      .body("text", [p.M, 172, 120, 40], "One or two sentences on what this chapter covers.")
      .photo("photo", [120, 220, 72, 60], "A photo for the chapter", "blob");
  } else {
    p.text("number", [p.M, 70, 60, 30], "big_number", "01")
      .rule("rule", [p.M, 104, p.CW, 0.4])
      .kicker("kicker", [p.M, 110, p.CW, 6], "Chapter")
      .title("title", [p.M, 118, p.CW, 30], "Chapter title")
      .body("text", [p.M, 152, 120, 40], "One or two sentences on what this chapter covers.");
  }
  return p.build();
}

function climate(d: Design): LayoutSeed {
  const p = page("climate", "data_page", "Climate", F);
  top(p, d, "Environment · climate", "Greenhouse gas emissions");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.chart("trend", [p.M, 46, p.CW, 100], "line", kpi("GHG_SCOPE1_2", { years: { last: 5 } }), "Scope 1 and 2 emissions, five years", { showValues: true })
    .bigNumber("total", [x1, 154, w, 30], kpi("GHG_SCOPE1_2", { compare: "prior" }), "Scope 1 and 2 emissions", { showDelta: true })
    .tile("scope3", [x2, 154, w, 30], kpi("GHG_SCOPE3", { compare: "prior" }), "Scope 3 emissions", d === "minimal" ? "plain" : "card", { showDelta: true })
    .body("text", [p.M, 192, p.CW, 60], doc(para("Scope 1 and 2 emissions were ", chip(kpi("GHG_SCOPE1_2")), ", a change of ", chip(kpi("GHG_SCOPE1_2", { compare: "prior" }), "change_pct"), " on the previous year. Explain what drove the change.")));
  return footer(p, d, "Climate").build();
}

function energyWater(d: Design): LayoutSeed {
  const p = page("energy_water", "data_page", "Energy and water", F);
  top(p, d, "Environment · resources", "Energy and water");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 8);
  p.chart("energy", [x1, 46, w, 80], "bar", kpi("ENERGY_TOTAL", { years: { last: 3 } }), "Energy used", { showValues: true, greyPrior: true })
    .chart("water", [x2, 46, w, 80], "bar", kpi("WATER_WITHDRAWAL", { years: { last: 3 } }), "Water withdrawn", { showValues: true, greyPrior: true })
    .progress("renewable", [x1, 134, w, 40], kpi("ENERGY_RENEWABLE_SHARE"), "Renewable share of energy", "bar")
    .tile("consumption", [x2, 134, w, 40], kpi("WATER_CONSUMPTION", { compare: "prior" }), "Water consumed", d === "minimal" ? "plain" : "card", { showDelta: true })
    .body("text", [p.M, 184, p.CW, 70], "Explain the main uses of energy and water, the sources, and what changed. Mention sites in water-stressed areas.");
  return footer(p, d, "Energy and water").build();
}

function waste(d: Design): LayoutSeed {
  const p = page("waste", "data_page", "Waste", F);
  top(p, d, "Environment · circularity", "Waste");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 8);
  p.chart("waste", [x1, 46, w, 110], "bar", kpi(["WASTE_GENERATED", "WASTE_HAZARDOUS"], { years: { last: 3 } }), "Waste generated and hazardous waste", { showValues: true })
    .body("text", [x2, 46, w, 110], "Describe how waste is reduced, reused, recycled or disposed of, and any targets.")
    .bigNumber("generated", [x1, 164, w, 30], kpi("WASTE_GENERATED", { compare: "prior" }), "Waste generated", { showDelta: true })
    .bigNumber("hazardous", [x2, 164, w, 30], kpi("WASTE_HAZARDOUS", { compare: "prior" }), "Hazardous waste", { showDelta: true })
    .photo("photo", [p.M, 202, p.CW, 56], "A photo of a waste or recycling initiative", d === "minimal" ? "rounded" : "rect");
  return footer(p, d, "Waste").build();
}

function safety(d: Design): LayoutSeed {
  const p = page("safety", "data_page", "Health, safety and training", F);
  top(p, d, "Social · our people", "Health, safety and training");
  const cols = columns(p.M, p.CW, 2, 6);
  (
    [
      ["ltifr", "LTIFR", "Lost-time injury frequency rate"],
      ["fatalities", "FATALITIES", "Fatalities"],
      ["training", "TRAINING_HOURS_AVG", "Training hours per employee"],
      ["turnover", "EMPLOYEE_TURNOVER_RATE", "Employee turnover"],
    ] as const
  ).forEach(([slot, code, label], i) => p.tile(slot, [cols[i % 2][0], 46 + Math.floor(i / 2) * 36, cols[i % 2][1], 30], kpi(code, { compare: "prior" }), label, d === "minimal" ? "plain" : "card", { showDelta: true }));
  p.body("text", [p.M, 122, p.CW, 60], "Describe the safety management system, the main risks and how people are trained.")
    .photo("photo", [p.M, 188, p.CW, 70], "A photo of people at work", d === "night" ? "rect" : "rounded");
  return footer(p, d, "Health and safety").build();
}

function governance(d: Design): LayoutSeed {
  const p = page("governance", "data_page", "Governance", F);
  top(p, d, "Governance", "How we are governed");
  const cols = columns(p.M, p.CW, 3, 6);
  (
    [
      ["women_board", "WOMEN_ON_BOARD", "Women on the board"],
      ["independence", "BOARD_INDEPENDENCE", "Independent directors"],
      ["training", "ANTI_CORRUPTION_TRAINING_SHARE", "Trained on anti-corruption"],
    ] as const
  ).forEach(([slot, code, label], i) => p.progress(slot, [cols[i][0], 46, cols[i][1], 44], kpi(code), label));
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.tile("corruption", [x1, 98, w, 28], kpi("CORRUPTION_INCIDENTS"), "Confirmed corruption incidents", d === "minimal" ? "plain" : "card")
    .tile("complaints", [x2, 98, w, 28], kpi("COMPLAINTS_RECEIVED"), "Complaints received", d === "minimal" ? "plain" : "card")
    .body("text", [p.M, 134, p.CW, 110], "Describe the board, its committees and who oversees sustainability, the code of conduct and how concerns can be raised.");
  return footer(p, d, "Governance").build();
}

function targets(d: Design): LayoutSeed {
  const p = page("targets", "targets", "Targets", F);
  top(p, d, "Targets", "Our targets and progress");
  p.chart("targets", [p.M, 46, p.CW, 110], "target_bars", kpi(["GHG_SCOPE1_2", "ENERGY_RENEWABLE_SHARE", "WATER_WITHDRAWAL"], { compare: "target" }), "Progress against targets", { showTarget: true, showValues: true })
    .body("text", [p.M, 164, p.CW, 80], "Explain each target: the base year, the target year, what is in scope and how the company plans to get there.");
  return footer(p, d, "Targets").build();
}

function materiality(d: Design): LayoutSeed {
  const p = page("materiality", "materiality", "Materiality", F);
  top(p, d, "Materiality", "What matters most");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 8);
  p.placeholder("matrix", [x1, 46, w, w], ["chart", "image"], "The materiality matrix: impact and financial scores from KPI setup")
    .body("method", [x2, 46, w, 84], "How the material topics were chosen: who was asked, what was scored and how the threshold was set.")
    .sub("list_heading", [p.M, 140, p.CW, 8], "Material topics")
    .body("list", [p.M, 150, p.CW, 100], "List the material topics, each with a sentence on why it matters and where it is covered in this report.");
  return footer(p, d, "Materiality").build();
}

function people(d: Design): LayoutSeed {
  const p = page("people", "people", "People", F);
  top(p, d, "Social · our people", "Our people");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 8);
  p.photo("photo", [x1, 46, w, 110], "A photo of the team", d === "editorial" ? "arch" : d === "night" ? "rect" : "rounded")
    .bigNumber("employees", [x2, 46, w, 34], kpi("EMPLOYEES_TOTAL", { compare: "prior" }), "Employees", { showDelta: true })
    .progress("women", [x2, 86, w, 34], kpi("WOMEN_IN_WORKFORCE"), "Women in the workforce", "bar")
    .tile("turnover", [x2, 126, w, 30], kpi("EMPLOYEE_TURNOVER_RATE"), "Employee turnover", d === "minimal" ? "plain" : "card")
    .body("text", [p.M, 164, p.CW, 80], "Describe hiring, pay equity, development and wellbeing, with one or two stories from the year.");
  return footer(p, d, "People").build();
}

function quote(d: Design): LayoutSeed {
  const p = page("quote", "quote", "Quote", F);
  if (d === "night") p.photo("photo", [-3, -3, 216, 165], "A photo above the quote", "rect", true);
  else if (d === "editorial") p.photo("photo", [p.M, 40, p.CW, 110], "A photo for the quote", "rect");
  const y = d === "night" ? 180 : d === "editorial" ? 170 : 110;
  p.icon("mark", [p.M, y, 14, 14], "quote")
    .quote("quote", [p.M, y + 18, p.CW, 50], "A quote from an employee, customer or partner about the work in this report.")
    .caption("who", [p.M, y + 72, p.CW, 8], "Name, role");
  return p.build();
}

function backCover(d: Design): LayoutSeed {
  const p = page("back_cover", "back_cover", "Back cover", F);
  if (d === "editorial") p.block("band", [-3, 220, 216, 80], { bleed: true });
  else if (d === "night") p.photo("photo", [-3, 200, 216, 100], "A closing photo", "rect", true);
  else p.rule("rule", [p.M, 230, p.CW, 0.4]);
  p.title("company", [p.M, 120, p.CW, 20], "{{company}}")
    .caption("what", [p.M, 144, p.CW, 8], "Sustainability report · {{period}}")
    .caption("contact", [p.M, 154, p.CW, 8], "Questions about this report: add a contact.");
  return p.build();
}

const flow = (name: string, flowType: string, options: Record<string, unknown> = {}): TemplatePageSeed => ({ flow: { name, flowType, options } });

const DESIGNS: Record<Design, { name: string; look: "classic" | "night" | "light"; description: string; tags: string[] }> = {
  editorial: {
    name: "Editorial",
    look: "classic",
    description: "Magazine-style annual report: large photos, serif headings and chapter openers.",
    tags: ["editorial", "annual report", "gri", "brsr", "esrs", "photos"],
  },
  night: {
    name: "Night",
    look: "night",
    description: "A dark design with bold numbers and full-height photos.",
    tags: ["night", "dark", "annual report", "gri", "brsr", "esrs"],
  },
  minimal: {
    name: "Minimal",
    look: "light",
    description: "Quiet and white: thin rules, big numbers, few photos.",
    tags: ["minimal", "light", "annual report", "gri", "brsr", "esrs"],
  },
};

function design(d: Design): FamilySeed {
  const layouts = [
    cover(d),
    contents(d),
    leadership(d),
    about(d),
    highlights(d),
    chapterOpener(d),
    climate(d),
    energyWater(d),
    waste(d),
    safety(d),
    governance(d),
    targets(d),
    materiality(d),
    people(d),
    quote(d),
    backCover(d),
  ];
  const meta = DESIGNS[d];
  const chapter = (n: number, title: string, text: string): TemplatePageSeed => ({
    layout: "chapter",
    name: title,
    text: { kicker: `Chapter ${n}`, title, text, ...(d === "minimal" ? { number: String(n).padStart(2, "0") } : {}) },
  });
  return {
    template: {
      family: `sustainability-${d}`,
      version: 1,
      kind: "sustainability",
      purpose: "report",
      format: F,
      name: meta.name,
      description: meta.description,
      tags: meta.tags,
      looks: [meta.look],
      meta: { title: "{{company}} sustainability report {{period}}", frameworks: ["GRI", "BRSR", "ESRS"] },
      pages: [
        { layout: "cover" },
        flow("Contents", "toc"),
        { layout: "leadership" },
        { layout: "about" },
        { layout: "highlights" },
        { layout: "materiality" },
        chapter(1, "Environment", "Climate, energy, water and waste."),
        { layout: "climate" },
        { layout: "energy_water" },
        { layout: "waste" },
        { layout: "targets" },
        chapter(2, "Social", "Our people, their health and safety, and training."),
        { layout: "people" },
        { layout: "safety" },
        { layout: "quote" },
        chapter(3, "Governance", "The board, ethics and how concerns are raised."),
        { layout: "governance" },
        flow("Performance data", "data_tables", { years: { last: 3 }, groupBy: "pillar" }),
        flow("Methodology", "methodology"),
        flow("GRI index", "gri_index"),
        flow("BRSR index", "brsr_index"),
        flow("ESRS index", "esrs_index"),
        flow("Glossary", "glossary"),
        { layout: "back_cover" },
      ],
    },
    layouts,
  };
}

export const SUSTAINABILITY_FAMILIES = () => (["editorial", "night", "minimal"] as Design[]).map(design);
