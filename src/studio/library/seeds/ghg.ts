/**
 * DS-4 · GHG templates (D9): Inventory (GHG Protocol, A4), ISO 14064-1 (A4),
 * Board brief (16:9) and One-page summary (A4), each in the Classic, Light
 * and Night looks. Section order follows research.md §3. Every figure is a
 * GhgBinding (approved entries, DS-2) or an InputBinding (report details);
 * market-based Scope 2 is bound too and shows "Not reported" with its reason
 * (D7). Text is our own wording; framework names and codes only.
 */
import type { FamilySeed, LayoutSeed, PageBuilder, TemplatePageSeed } from "./kit";
import { bullets, chip, columns, doc, ghg, h, input, page, para } from "./kit";

const LOOKS = ["classic", "light", "night"] as const;
const ALL_CATEGORIES = Array.from({ length: 15 }, (_, i) => i + 1);

/** Kicker + heading at the top of a content page. */
const top = (p: PageBuilder, kicker: string, heading: string) => p.kicker("kicker", [p.M, p.M, p.CW, 6], kicker).heading("heading", [p.M, p.M + 8, p.CW, 14], heading);

// ---------------------------------------------------------------------------
// A4 layouts shared by the Inventory and ISO templates
// ---------------------------------------------------------------------------

function cover(): LayoutSeed {
  const p = page("cover", "cover", "Cover", "a4");
  return p
    .photo("hero", [-3, -3, 216, 150], "Cover image: one of your sites or a landscape", "rect", true)
    .block("band", [p.M, 156, 40, 2.5])
    .kicker("kicker", [p.M, 166, p.CW, 6], "Greenhouse gas inventory")
    .title("title", [p.M, 174, p.CW, 32], "{{company}}")
    .sub("period", [p.M, 208, p.CW, 10], "Scope 1, 2 and 3 emissions · {{period}}")
    .bigNumber("total", [p.M, 228, 84, 30], ghg("total", { compare: "prior" }), "tCO₂e, Scope 1, 2 and 3", { showDelta: true })
    // DS fix: tall enough for both standards ("GHG Protocol Corporate Standard and ISO 14064-1") at the tile's 22 pt.
    .tile("conformance", [110, 226, 82, 46], input("conformance"), "Prepared in line with", "plain")
    .caption("source", [p.M, 276, p.CW, 8], "All figures come from approved emission entries.")
    .build();
}

function compliance(): LayoutSeed {
  const p = page("compliance", "about", "Statement of compliance", "a4");
  top(p, "Statement of compliance", "How this inventory was prepared");
  p.body(
    "statement",
    [p.M, 46, p.CW, 40],
    doc(
      para("This report presents the greenhouse gas inventory of {{company}} for {{period}}. It follows the GHG Protocol Corporate Standard: Scope 1 and Scope 2 are reported in full and Scope 3 by category."),
      para("Scope 2 is reported location-based. Market-based figures are shown where contractual instruments are recorded."),
    ),
  );
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.tile("consolidation", [x1, 92, w, 26], input("consolidation_approach"), "Consolidation approach")
    .tile("period_input", [x2, 92, w, 26], input("reporting_period"), "Reporting period")
    .tile("conformance", [x1, 124, w, 26], input("conformance"), "Standards")
    .tile("responsible", [x2, 124, w, 26], input("responsible_person"), "Responsible person")
    .tile("gwp", [x1, 156, w, 26], input("gwp_set"), "Global warming potentials")
    .tile("verification", [x2, 156, w, 26], input("verification"), "Verification")
    .callout("biogenic", [p.M, 192, p.CW, 22], "Biogenic CO₂ is reported separately from the scope totals.", { icon: "info", tone: "accent" })
    .placeholder("signature", [p.M, 224, 84, 34], ["image", "text"], "Signature or approval of the responsible person");
  return p.footer("Statement of compliance").build();
}

function execSummary(): LayoutSeed {
  const p = page("exec_summary", "highlights", "Executive summary", "a4");
  top(p, "Executive summary", "Our emissions at a glance");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  const nums = [
    ["total", ghg("total", { compare: "prior" }), "tCO₂e in total", true],
    ["scope1", ghg("scope1"), "tCO₂e Scope 1", false],
    ["scope2", ghg("scope2_location"), "tCO₂e Scope 2 (location-based)", false],
    ["scope3", ghg("scope3"), "tCO₂e Scope 3", false],
  ] as const;
  nums.forEach(([slot, b, label, delta], i) => p.bigNumber(slot, [i % 2 ? x2 : x1, 46 + Math.floor(i / 2) * 28, w, 24], b, label, { showDelta: delta }));
  p.chart("split", [x1, 104, w, 72], "scope_split", ghg("total", { breakdown: "scope" }), "Emissions by scope", { showValues: true })
    .chart("waterfall", [x2, 104, w, 72], "base_year_waterfall", ghg("total", { years: { last: 2 }, compare: "base" }), "Change since the base year")
    .body(
      "summary",
      [p.M, 182, p.CW, 32],
      doc(
        para("Total emissions were ", chip(ghg("total")), " tCO₂e in {{period}}, a change of ", chip(ghg("total", { compare: "prior" }), "change_pct"), " on the year before."),
        para("Scope 1 was ", chip(ghg("scope1")), " tCO₂e, Scope 2 (location-based) ", chip(ghg("scope2_location")), " tCO₂e and Scope 3 ", chip(ghg("scope3")), " tCO₂e."),
      ),
    )
    .tile("intensity", [x1, 220, w, 24], ghg("intensity_revenue"), "Intensity per unit of revenue", "card", { showDelta: true })
    .tile("market", [x2, 220, w, 24], ghg("scope2_market"), "Scope 2 (market-based)")
    .callout("biogenic", [p.M, 250, p.CW, 14], doc(para("Biogenic CO₂: ", chip(ghg("biogenic_co2")), " tCO₂e, reported separately.")), { icon: "leaf", tone: "good" });
  return p.footer("Executive summary").build();
}

function boundary(): LayoutSeed {
  const p = page("boundary", "about", "Boundaries", "a4");
  top(p, "Boundaries", "What this inventory covers");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.tile("consolidation", [x1, 46, w, 24], input("consolidation_approach"), "Consolidation approach", "plain")
    .bigNumber("sites", [x2, 46, w, 24], ghg("sites_covered"), "Sites in this inventory")
    .body(
      "text",
      [x1, 76, w, 70],
      "The inventory covers every site within the consolidation approach above. The operational boundary takes in direct emissions (Scope 1), indirect emissions from purchased energy (Scope 2) and the Scope 3 categories on the Scope 3 pages.",
    )
    .photo("map", [x2, 76, w, 70], "Map of the sites in this inventory", "rounded")
    .sub("sites_heading", [p.M, 152, p.CW, 8], "Sites")
    .table("sites_table", [p.M, 162, p.CW, 60], { binding: ghg("total", { breakdown: "site" }), style: "zebra", totalRow: true })
    .sub("exclusions_heading", [p.M, 228, p.CW, 8], "Exclusions")
    .table("exclusions", [p.M, 238, p.CW, 34], { binding: input("exclusions"), style: "lined" });
  return p.footer("Boundaries").build();
}

function period(): LayoutSeed {
  const p = page("period", "about", "Period and base year", "a4");
  top(p, "Reporting period", "Period and base year");
  const cols = columns(p.M, p.CW, 3, 6);
  p.tile("period_input", [cols[0][0], 46, cols[0][1], 26], input("reporting_period"), "Reporting period")
    .tile("base_year", [cols[1][0], 46, cols[1][1], 26], input("base_year"), "Base year")
    .tile("threshold", [cols[2][0], 46, cols[2][1], 26], input("significance_threshold_pct"), "Significance threshold, %");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.bigNumber("base_total", [x1, 80, w, 30], ghg("base_year_total"), "tCO₂e in the base year")
    .body("text", [x2, 80, w, 30], "The base year is recalculated when a structural change, a change of method or an error moves it by more than the threshold.")
    .tile("policy", [p.M, 118, p.CW, 64], input("recalculation_policy"), "Recalculation policy", "plain")
    .chart("trend", [p.M, 190, p.CW, 76], "line", ghg("total", { years: { last: 5 } }), "Total emissions, last five years", { showValues: true });
  return p.footer("Period and base year").build();
}

function methodology(): LayoutSeed {
  const p = page("methodology", "data_page", "Methodology", "a4");
  top(p, "Methodology", "How we calculated our emissions");
  p.body(
    "text",
    [p.M, 46, p.CW, 40],
    doc(
      para("Each emission is activity data multiplied by an emission factor and converted to CO₂-equivalent with the global warming potentials below. Every figure comes from emission entries approved in ESGLite."),
      para("The factor sources and versions are listed in the annex."),
    ),
  );
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.tile("gwp", [x1, 92, w, 24], input("gwp_set"), "Global warming potentials")
    .tile("conformance", [x2, 92, w, 24], input("conformance"), "Standards")
    .sub("activity_heading", [p.M, 124, p.CW, 8], "Activity data")
    .body("activity", [p.M, 134, p.CW, 30], doc(bullets(["Fuel, process and refrigerant records for Scope 1"], ["Metered electricity, heat and steam for Scope 2"], ["Spend, distance and supplier data for Scope 3"])))
    .chart("gases", [x1, 170, w, 76], "gas_split", ghg("total", { breakdown: "gas" }), "Emissions by gas", { showValues: true })
    .callout("scope2_note", [x2, 170, w, 40], "Scope 2 uses the location-based method. Market-based figures need contractual instruments, which aren't recorded yet.", { icon: "alert", tone: "warn" });
  return p.footer("Methodology").build();
}

function scope1(): LayoutSeed {
  const p = page("scope1", "data_page", "Scope 1", "a4");
  top(p, "Results · Scope 1", "Direct emissions");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.bigNumber("total", [x1, 46, w, 30], ghg("scope1", { compare: "prior" }), "tCO₂e Scope 1", { showDelta: true })
    .body("text", [x2, 46, w, 30], "Scope 1 covers fuel burned on site, company vehicles, process emissions and refrigerant leaks.")
    .chart("sources", [p.M, 84, p.CW, 80], "bar", ghg("scope1", { breakdown: "source_category" }), "Scope 1 by source", { horizontal: true, showValues: true })
    .chart("gases", [x1, 172, w, 76], "gas_split", ghg("scope1", { breakdown: "gas" }), "Scope 1 by gas", { showValues: true })
    .table("fuels", [x2, 172, w, 76], { binding: ghg("scope1", { breakdown: "fuel" }), style: "zebra", totalRow: true });
  return p.footer("Scope 1").build();
}

function scope2(): LayoutSeed {
  const p = page("scope2", "data_page", "Scope 2", "a4");
  top(p, "Results · Scope 2", "Purchased energy");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.bigNumber("location", [x1, 46, w, 30], ghg("scope2_location", { compare: "prior" }), "tCO₂e Scope 2 (location-based)", { showDelta: true })
    .tile("market", [x2, 46, w, 30], ghg("scope2_market"), "Scope 2 (market-based)")
    .chart("sites", [p.M, 84, p.CW, 80], "site_bars", ghg("scope2_location", { breakdown: "site" }), "Scope 2 (location-based) by site", { showValues: true })
    .chart("months", [p.M, 172, p.CW, 60], "monthly_stack", ghg("scope2_location", { breakdown: "month" }), "Scope 2 (location-based) by month")
    .tile("instruments", [p.M, 238, p.CW, 32], input("scope2_instruments"), "Contractual instruments", "plain");
  return p.footer("Scope 2").build();
}

function scope3(): LayoutSeed {
  const p = page("scope3", "data_page", "Scope 3", "a4");
  top(p, "Results · Scope 3", "Value-chain emissions");
  p.bigNumber("total", [p.M, 46, 84, 30], ghg("scope3", { compare: "prior" }), "tCO₂e Scope 3", { showDelta: true })
    .progress("primary", [108, 46, 40, 30], ghg("primary_data_pct"), "From supplier-specific data")
    .tile("dq", [152, 46, 40, 30], ghg("dq_score"), "Data quality (1 best, 5 worst)", "plain")
    .chart("categories", [p.M, 84, p.CW, 100], "category_bars", ghg("scope3", { breakdown: "scope3_category", top: 15 }), "Scope 3 by category", { horizontal: true, showValues: true })
    .table("table", [p.M, 192, p.CW, 78], { binding: ghg("scope3", { breakdown: "scope3_category" }), style: "zebra", totalRow: true });
  return p.footer("Scope 3").build();
}

function sites(): LayoutSeed {
  const p = page("sites", "data_page", "By site", "a4");
  top(p, "Results · by site", "Emissions by site");
  p.chart("bars", [p.M, 46, p.CW, 100], "site_bars", ghg("total", { breakdown: "site" }), "Total emissions by site", { stacked: true, showValues: true })
    .table("table", [p.M, 154, p.CW, 112], { binding: ghg("total", { breakdown: "site" }), style: "zebra", totalRow: true });
  return p.footer("By site").build();
}

function biogenic(): LayoutSeed {
  const p = page("biogenic", "data_page", "Biogenic CO₂ and removals", "a4");
  top(p, "Reported separately", "Biogenic CO₂ and removals");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.bigNumber("biogenic", [x1, 46, w, 30], ghg("biogenic_co2"), "tCO₂e biogenic CO₂")
    .body("text", [x2, 46, w, 60], "Biogenic CO₂ from burning biomass and biofuels is shown here, outside the scope totals. Removals and offsets, if any, are also shown separately and never netted off.")
    .callout("note", [x1, 84, w, 22], "Not included in Scope 1, 2 or 3.", { icon: "info", tone: "accent" })
    .placeholder("offsets", [p.M, 114, p.CW, 70], ["text", "table"], "Removals or offsets, shown separately (optional)");
  return p.footer("Biogenic CO₂").build();
}

function intensity(): LayoutSeed {
  const p = page("intensity", "data_page", "Intensity", "a4");
  top(p, "Intensity", "Emissions intensity");
  const cols = columns(p.M, p.CW, 3, 6);
  p.tile("revenue", [cols[0][0], 46, cols[0][1], 32], ghg("intensity_revenue"), "Per unit of revenue", "card", { showDelta: true })
    .tile("output", [cols[1][0], 46, cols[1][1], 32], ghg("intensity_output"), "Per unit of output", "card", { showDelta: true })
    .tile("employee", [cols[2][0], 46, cols[2][1], 32], ghg("intensity_employee"), "Per employee", "card", { showDelta: true })
    .chart("trend", [p.M, 86, p.CW, 90], "intensity_line", ghg("intensity_revenue", { years: { last: 5 } }), "Intensity per unit of revenue over time")
    .tile("revenue_input", [cols[0][0], 184, cols[0][1], 24], input("revenue"), "Revenue", "plain")
    .tile("output_input", [cols[1][0], 184, cols[1][1], 24], input("output_units"), "Output", "plain")
    .tile("employees_input", [cols[2][0], 184, cols[2][1], 24], input("employees"), "Employees", "plain")
    .callout("note", [p.M, 216, p.CW, 20], "The denominators come from Report details. Change them there and every intensity updates.", { icon: "info" });
  return p.footer("Intensity").build();
}

function trend(): LayoutSeed {
  const p = page("trend", "targets", "Trend and targets", "a4");
  top(p, "Trend and targets", "Trend and targets");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.chart("waterfall", [x1, 46, w, 80], "base_year_waterfall", ghg("total", { years: { last: 2 }, compare: "base" }), "Change since the base year")
    .chart("line", [x2, 46, w, 80], "line", ghg("total", { years: { last: 5 } }), "Total emissions, five years")
    .tile("base_year", [x1, 132, w, 26], input("base_year"), "Base year")
    .bigNumber("base_total", [x2, 132, w, 26], ghg("base_year_total"), "tCO₂e in the base year")
    .sub("targets_heading", [p.M, 166, p.CW, 8], "Targets")
    .placeholder("targets", [p.M, 176, p.CW, 70], ["text", "chart"], "Your reduction targets: target year, base year and the reduction");
  return p.footer("Trend and targets").build();
}

function dataQuality(): LayoutSeed {
  const p = page("data_quality", "data_page", "Data quality", "a4");
  top(p, "Data quality", "Quality and uncertainty");
  const cols = columns(p.M, p.CW, 3, 6);
  p.progress("primary", [cols[0][0], 46, cols[0][1], 44], ghg("primary_data_pct"), "Supplier-specific data")
    .tile("dq", [cols[1][0], 46, cols[1][1], 44], ghg("dq_score"), "Data quality score (1 best, 5 worst)")
    .tile("months", [cols[2][0], 46, cols[2][1], 44], ghg("months_covered"), "Months with data")
    .bigNumber("sites", [p.M, 96, 84, 26], ghg("sites_covered"), "Sites with approved data")
    .body("text", [p.M, 128, p.CW, 30], "Each entry carries a data-quality score from 1 (measured, supplier-specific) to 5 (estimated). Only approved entries are counted.")
    .sub("uncertainty_heading", [p.M, 164, p.CW, 8], "Uncertainty")
    .tile("uncertainty", [p.M, 174, p.CW, 64], input("uncertainty_statement"), "Uncertainty statement", "plain");
  return p.footer("Data quality").build();
}

function initiatives(): LayoutSeed {
  const p = page("initiatives", "data_page", "Reduction initiatives", "a4");
  top(p, "Reduction initiatives", "How we reduce emissions");
  const cols = columns(p.M, p.CW, 3, 8);
  const items = [
    ["energy", "bolt", "Energy"],
    ["transport", "truck", "Transport"],
    ["materials", "recycle", "Materials and waste"],
  ] as const;
  items.forEach(([slot, icon, title], i) => {
    const [x, w] = cols[i];
    p.icon(`${slot}_icon`, [x, 46, 12, 12], icon)
      .sub(`${slot}_title`, [x, 62, w, 8], title)
      .body(`${slot}_text`, [x, 72, w, 50], "Describe the initiative, when it started and what it is expected to save.");
  });
  p.photo("photo", [p.M, 130, p.CW, 90], "A photo of an initiative", "rounded")
    .callout("note", [p.M, 228, p.CW, 26], "Initiatives show in the figures only through approved entries. Expected savings are estimates.", { icon: "info" });
  return p.footer("Reduction initiatives").build();
}

function assurance(): LayoutSeed {
  const p = page("assurance", "about", "Assurance", "a4");
  top(p, "Assurance", "Assurance statement");
  p.tile("verification", [p.M, 46, 84, 26], input("verification"), "Verification")
    .body("text", [p.M, 80, p.CW, 30], "This page holds the verifier's statement when the inventory was verified. When it wasn't, the status above says so.")
    .placeholder("statement", [p.M, 116, p.CW, 140], ["text", "image"], "The verification statement (add it from Uploads)");
  return p.footer("Assurance").build();
}

function annexOpener(): LayoutSeed {
  const p = page("annex", "chapter_opener", "Annexes", "a4");
  return p
    .block("band", [p.M, 120, 40, 3])
    .kicker("kicker", [p.M, 130, p.CW, 6], "Annexes")
    .title("title", [p.M, 138, p.CW, 30], "Factors, indexes and glossary")
    .body("text", [p.M, 172, 120, 30], "The emission factors behind the figures, where each disclosure sits in this report, and the terms we use.")
    .build();
}

function backCover(): LayoutSeed {
  const p = page("back_cover", "back_cover", "Back cover", "a4");
  return p
    .title("company", [p.M, 120, p.CW, 20], "{{company}}")
    .caption("what", [p.M, 144, p.CW, 8], "Greenhouse gas inventory · {{period}}")
    .caption("source", [p.M, 154, p.CW, 8], "Prepared from approved emission entries in ESGLite.")
    .block("band", [-3, 200, 216, 100], { bleed: true })
    .build();
}

// ISO 14064-1 extras -----------------------------------------------------------

function isoConformance(): LayoutSeed {
  const p = page("conformance", "about", "Conformance", "a4");
  top(p, "Statement of conformance", "Conformance with ISO 14064-1");
  p.body("text", [p.M, 46, p.CW, 30], "{{company}} prepared this GHG inventory for {{period}} with reference to ISO 14064-1 and the GHG Protocol Corporate Standard.");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.tile("conformance", [x1, 82, w, 26], input("conformance"), "Standards")
    .tile("responsible", [x2, 82, w, 26], input("responsible_person"), "Responsible person")
    .tile("consolidation", [x1, 114, w, 26], input("consolidation_approach"), "Consolidation approach")
    .tile("gwp", [x2, 114, w, 26], input("gwp_set"), "Global warming potentials")
    .tile("period_input", [x1, 146, w, 26], input("reporting_period"), "Reporting period")
    .tile("verification", [x2, 146, w, 26], input("verification"), "Verification")
    .placeholder("signature", [p.M, 182, 84, 36], ["image", "text"], "Signature of the responsible person");
  return p.footer("Conformance").build();
}

function isoCategories(): LayoutSeed {
  const p = page("iso_categories", "data_page", "ISO 14064-1 categories", "a4");
  top(p, "ISO 14064-1", "Emissions by ISO category");
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.bigNumber("cat1", [x1, 46, w, 28], ghg("scope1"), "tCO₂e Category 1: direct emissions")
    .bigNumber("cat2", [x2, 46, w, 28], ghg("scope2_location"), "tCO₂e Category 2: imported energy")
    .table("mapping", [p.M, 82, p.CW, 70], {
      columns: ["ISO 14064-1 category", "Where it is reported"],
      rows: [
        ["1 · Direct emissions and removals", "Scope 1"],
        ["2 · Indirect emissions from imported energy", "Scope 2 (location-based)"],
        ["3 · Indirect emissions from transportation", "Scope 3 categories 4, 6, 7 and 9"],
        ["4 · Indirect emissions from products the organisation uses", "Scope 3 categories 1, 2, 3, 5 and 8"],
        ["5 · Indirect emissions from the use of the organisation's products", "Scope 3 categories 10, 11, 12 and 13"],
        ["6 · Other indirect emissions", "Scope 3 categories 14 and 15"],
      ],
      style: "lined",
    })
    .chart("scope3", [p.M, 160, p.CW, 100], "category_bars", ghg("scope3", { breakdown: "scope3_category", top: 15 }), "Categories 3 to 6 by Scope 3 category", { horizontal: true, showValues: true });
  return p.footer("ISO 14064-1 categories").build();
}

function isoUncertainty(): LayoutSeed {
  const p = page("uncertainty", "data_page", "Uncertainty", "a4");
  top(p, "Uncertainty", "Uncertainty assessment");
  p.tile("statement", [p.M, 46, p.CW, 70], input("uncertainty_statement"), "Uncertainty statement", "plain")
    .progress("primary", [p.M, 124, 54, 44], ghg("primary_data_pct"), "Supplier-specific data")
    .tile("dq", [78, 124, 54, 44], ghg("dq_score"), "Data quality score (1 best, 5 worst)")
    .tile("months", [138, 124, 54, 44], ghg("months_covered"), "Months with data")
    .placeholder("method", [p.M, 176, p.CW, 70], ["text", "table"], "How uncertainty was assessed: the sources of uncertainty and their ranges");
  return p.footer("Uncertainty").build();
}

function isoVerification(): LayoutSeed {
  const p = page("verification", "about", "Verification", "a4");
  top(p, "Verification", "Verification statement");
  p.tile("verification", [p.M, 46, 84, 26], input("verification"), "Verification")
    .body("text", [p.M, 80, p.CW, 24], "The verification body, the level of assurance and the statement itself.")
    .placeholder("statement", [p.M, 110, p.CW, 150], ["text", "image"], "The verification statement (add it from Uploads)");
  return p.footer("Verification").build();
}

const flow = (name: string, flowType: string, options: Record<string, unknown> = {}): TemplatePageSeed => ({ flow: { name, flowType, options } });

const INVENTORY_LAYOUTS = () => [cover(), compliance(), execSummary(), boundary(), period(), methodology(), scope1(), scope2(), scope3(), sites(), biogenic(), intensity(), trend(), dataQuality(), initiatives(), assurance(), annexOpener(), backCover()];

export function ghgInventory(): FamilySeed {
  return {
    template: {
      family: "ghg-inventory",
      version: 1,
      kind: "ghg",
      purpose: "report",
      format: "a4",
      name: "GHG Inventory",
      description: "A full GHG Protocol inventory: boundaries, methods, Scope 1, 2 and 3, sites, intensity, trend and annexes.",
      tags: ["ghg protocol", "inventory", "scope 1", "scope 2", "scope 3", "a4", "report"],
      looks: [...LOOKS],
      meta: { title: "{{company}} GHG inventory {{period}}", subtitle: "Scope 1, 2 and 3 emissions", frameworks: ["GHGP"] },
      pages: [
        { layout: "cover" },
        { layout: "compliance" },
        flow("Contents", "toc"),
        { layout: "exec_summary" },
        { layout: "boundary" },
        { layout: "period" },
        { layout: "methodology" },
        { layout: "scope1" },
        { layout: "scope2" },
        { layout: "scope3" },
        flow("Scope 3 categories", "scope3_categories", { columns: 1, categories: ALL_CATEGORIES, showDq: true, showMethod: true }),
        { layout: "sites" },
        { layout: "biogenic" },
        { layout: "intensity" },
        { layout: "trend" },
        { layout: "data_quality" },
        { layout: "initiatives" },
        { layout: "assurance" },
        { layout: "annex" },
        flow("Emission factors", "ghg_factor_table", { columns: 1 }),
        flow("GHG Protocol index", "ghgp_index"),
        flow("Glossary", "glossary"),
        { layout: "back_cover" },
      ],
    },
    layouts: INVENTORY_LAYOUTS(),
  };
}

export function ghgIso(): FamilySeed {
  return {
    template: {
      family: "ghg-iso14064",
      version: 1,
      kind: "ghg",
      purpose: "report",
      format: "a4",
      name: "ISO 14064-1 inventory",
      description: "The Inventory plus ISO 14064-1 categories 1 to 6, uncertainty, conformance and verification pages.",
      tags: ["iso 14064-1", "inventory", "uncertainty", "verification", "a4", "report"],
      looks: [...LOOKS],
      meta: { title: "{{company}} GHG inventory {{period}} (ISO 14064-1)", subtitle: "Emissions by ISO category and by scope", frameworks: ["GHGP", "ISO14064"] },
      pages: [
        { layout: "cover", text: { kicker: "GHG inventory · ISO 14064-1" } },
        { layout: "conformance" },
        flow("Contents", "toc"),
        { layout: "exec_summary" },
        { layout: "boundary" },
        { layout: "period" },
        { layout: "methodology" },
        { layout: "iso_categories" },
        { layout: "scope1" },
        { layout: "scope2" },
        { layout: "scope3" },
        flow("Scope 3 categories", "scope3_categories", { columns: 1, categories: ALL_CATEGORIES, showDq: true, showMethod: true }),
        { layout: "sites" },
        { layout: "biogenic" },
        { layout: "intensity" },
        { layout: "trend" },
        { layout: "uncertainty" },
        { layout: "data_quality" },
        { layout: "initiatives" },
        { layout: "verification" },
        { layout: "annex" },
        flow("Emission factors", "ghg_factor_table", { columns: 1 }),
        flow("ISO 14064-1 index", "iso_index"),
        flow("Glossary", "glossary"),
        { layout: "back_cover" },
      ],
    },
    layouts: [...INVENTORY_LAYOUTS(), isoConformance(), isoCategories(), isoUncertainty(), isoVerification()],
  };
}

// ---------------------------------------------------------------------------
// Board brief (16:9)
// ---------------------------------------------------------------------------

const S = "slide_16_9" as const;
// DS fix: the heading box is 21 mm (was 18): a slide heading's h2 is 1.5em of the 30 pt heading style, so 18 mm overflowed.
const slideTop = (p: PageBuilder, kicker: string, heading: string) => p.kicker("kicker", [p.M, p.M, p.CW, 8], kicker).heading("heading", [p.M, p.M + 10, p.CW, 21], heading);

function boardBrief(): LayoutSeed[] {
  const cover = page("cover", "cover", "Title slide", S);
  cover
    .photo("hero", [190, 0, 148.7, 190.5], "Cover image", "rect", true) // DS fix: full-bleed, so outside the safe margin by design
    .block("band", [cover.M, 60, 40, 3])
    .kicker("kicker", [cover.M, 70, 160, 8], "GHG emissions · board brief")
    .title("title", [cover.M, 80, 160, 44], "{{company}}")
    .sub("period", [cover.M, 128, 160, 12], "{{period}}")
    .caption("source", [cover.M, 166, 160, 8], "From approved emission entries.");

  const headline = page("headline", "highlights", "Headline numbers", S);
  slideTop(headline, "At a glance", "Our footprint this year");
  const hc = columns(headline.M, headline.CW, 2, 12);
  (
    [
      ["total", ghg("total", { compare: "prior" }), "tCO₂e in total", true],
      ["scope1", ghg("scope1", { compare: "prior" }), "tCO₂e Scope 1", true],
      ["scope2", ghg("scope2_location", { compare: "prior" }), "tCO₂e Scope 2 (location-based)", true],
      ["scope3", ghg("scope3", { compare: "prior" }), "tCO₂e Scope 3", true],
    ] as const
  ).forEach(([slot, b, label, d], i) => headline.bigNumber(slot, [hc[i % 2][0], 54 + Math.floor(i / 2) * 50, hc[i % 2][1], 44], b, label, { showDelta: d }));
  headline.caption("note", [headline.M, 158, headline.CW, 10], doc(para("Change on the year before: ", chip(ghg("total", { compare: "prior" }), "change_pct"), ".")));

  const scopes = page("scopes", "data_page", "Scopes", S);
  slideTop(scopes, "Where emissions come from", "Emissions by scope");
  scopes
    .chart("split", [scopes.M, 52, 150, 118], "scope_split", ghg("total", { breakdown: "scope" }), undefined, { showValues: true })
    .body(
      "text",
      [180, 60, 138, 80],
      doc(
        para("Scope 1: ", chip(ghg("scope1")), " tCO₂e"),
        para("Scope 2 (location-based): ", chip(ghg("scope2_location")), " tCO₂e"),
        para("Scope 3: ", chip(ghg("scope3")), " tCO₂e"),
      ),
    )
    .tile("market", [180, 144, 138, 26], ghg("scope2_market"), "Scope 2 (market-based)");

  const s3 = page("scope3", "data_page", "Scope 3", S);
  slideTop(s3, "Value chain", "Scope 3 by category");
  s3.chart("bars", [s3.M, 52, 200, 118], "category_bars", ghg("scope3", { breakdown: "scope3_category", top: 8 }), undefined, { horizontal: true, showValues: true })
    .tile("total", [230, 56, 88, 40], ghg("scope3", { compare: "prior" }), "tCO₂e Scope 3", "card", { showDelta: true })
    .progress("primary", [230, 104, 88, 60], ghg("primary_data_pct"), "From supplier-specific data", "bar");

  const sitesSlide = page("sites", "data_page", "Sites", S);
  slideTop(sitesSlide, "Operations", "Emissions by site");
  sitesSlide.chart("bars", [sitesSlide.M, 52, sitesSlide.CW, 118], "site_bars", ghg("total", { breakdown: "site" }), undefined, { stacked: true, showValues: true });

  const trendSlide = page("trend", "targets", "Trend", S);
  slideTop(trendSlide, "Progress", "Against the base year");
  const tc = columns(trendSlide.M, trendSlide.CW, 2, 10);
  trendSlide
    .chart("waterfall", [tc[0][0], 52, tc[0][1], 118], "base_year_waterfall", ghg("total", { years: { last: 2 }, compare: "base" }), "Change since the base year")
    .chart("line", [tc[1][0], 52, tc[1][1], 118], "line", ghg("total", { years: { last: 5 } }), "Five-year trend");

  const intens = page("intensity", "data_page", "Intensity", S);
  slideTop(intens, "Efficiency", "Emissions intensity");
  const ic = columns(intens.M, intens.CW, 3, 8);
  intens
    .tile("revenue", [ic[0][0], 52, ic[0][1], 36], ghg("intensity_revenue"), "Per unit of revenue", "card", { showDelta: true })
    .tile("output", [ic[1][0], 52, ic[1][1], 36], ghg("intensity_output"), "Per unit of output", "card", { showDelta: true })
    .tile("employee", [ic[2][0], 52, ic[2][1], 36], ghg("intensity_employee"), "Per employee", "card", { showDelta: true })
    .chart("line", [intens.M, 96, intens.CW, 74], "intensity_line", ghg("intensity_revenue", { years: { last: 5 } }), "Intensity per unit of revenue");

  const dq = page("data_quality", "data_page", "Data quality", S);
  slideTop(dq, "Confidence", "Data quality and gaps");
  const dc = columns(dq.M, dq.CW, 3, 8);
  dq.progress("primary", [dc[0][0], 56, dc[0][1], 60], ghg("primary_data_pct"), "Supplier-specific data")
    .tile("months", [dc[1][0], 56, dc[1][1], 60], ghg("months_covered"), "Months with data")
    .tile("sites", [dc[2][0], 56, dc[2][1], 60], ghg("sites_covered"), "Sites with approved data")
    .callout("gaps", [dq.M, 128, dq.CW, 34], "Gaps to close before the final report: list the missing sites, months or categories here.", { icon: "alert", tone: "warn" });

  const next = page("next_steps", "data_page", "Next steps", S);
  slideTop(next, "Decisions", "What we ask the board");
  const nc = columns(next.M, next.CW, 3, 10);
  ["Approve", "Invest", "Engage"].forEach((title, i) => {
    next
      .icon(`icon${i + 1}`, [nc[i][0], 56, 14, 14], ["check", "bolt", "users"][i])
      .sub(`title${i + 1}`, [nc[i][0], 76, nc[i][1], 10], title)
      .body(`text${i + 1}`, [nc[i][0], 90, nc[i][1], 70], "One decision or ask, in a sentence or two.");
  });

  const close = page("close", "back_cover", "Closing slide", S);
  close
    .block("band", [0, 0, 338.7, 6], { bleed: true }) // DS fix: edge to edge, like the hero
    .title("title", [close.M, 70, close.CW, 30], "Questions and discussion", "center")
    .caption("source", [close.M, 108, close.CW, 8], "{{company}} · GHG emissions {{period}}", "center");

  return [cover, headline, scopes, s3, sitesSlide, trendSlide, intens, dq, next, close].map((p) => p.build());
}

export function ghgBoardBrief(): FamilySeed {
  const layouts = boardBrief();
  return {
    template: {
      family: "ghg-board-brief",
      version: 1,
      kind: "ghg",
      purpose: "deck",
      format: S,
      name: "Board brief",
      description: "Ten 16:9 slides for the board: headline numbers, scopes, Scope 3, sites, trend, intensity, data quality and asks.",
      tags: ["deck", "board", "slides", "16:9", "summary"],
      looks: [...LOOKS],
      meta: { title: "{{company}} GHG board brief {{period}}", frameworks: ["GHGP"] },
      pages: layouts.map((l) => ({ layout: l.role })),
    },
    layouts,
  };
}

// ---------------------------------------------------------------------------
// One-page summary (A4)
// ---------------------------------------------------------------------------

function summaryPage(): LayoutSeed {
  const p = page("summary", "highlights", "One-page summary", "a4");
  p.block("band", [-3, -3, 216, 9], { bleed: true })
    .kicker("kicker", [p.M, 16, p.CW, 6], "GHG emissions summary · {{period}}")
    .title("title", [p.M, 24, p.CW, 26], "{{company}}");
  const cols = columns(p.M, p.CW, 4, 5);
  (
    [
      ["total", ghg("total", { compare: "prior" }), "tCO₂e in total", true],
      ["scope1", ghg("scope1"), "tCO₂e Scope 1", false],
      ["scope2", ghg("scope2_location"), "tCO₂e Scope 2 (location-based)", false],
      ["scope3", ghg("scope3"), "tCO₂e Scope 3", false],
    ] as const
  ).forEach(([slot, b, label, d], i) => p.tile(slot, [cols[i][0], 56, cols[i][1], 30], b, label, "card", { showDelta: d }));
  const [[x1, w], [x2]] = columns(p.M, p.CW, 2, 6);
  p.chart("split", [x1, 94, w, 76], "scope_split", ghg("total", { breakdown: "scope" }), "Emissions by scope", { showValues: true })
    .chart("scope3_bars", [x2, 94, w, 76], "category_bars", ghg("scope3", { breakdown: "scope3_category", top: 6 }), "Top Scope 3 categories", { horizontal: true, showValues: true })
    .chart("sites", [x1, 178, w, 64], "site_bars", ghg("total", { breakdown: "site", top: 6 }), "By site", { showValues: true })
    .tile("intensity", [x2, 178, w, 28], ghg("intensity_revenue"), "Intensity per unit of revenue", "card", { showDelta: true })
    .tile("market", [x2, 210, w, 32], ghg("scope2_market"), "Scope 2 (market-based)")
    // DS fix: caption (8 pt), not footnote (7 pt): a "Not reported" chip prints at 0.92em, 6.4 pt in a footnote (FONT_TOO_SMALL).
    .text("notes", [p.M, 250, p.CW, 24], "caption", doc(h(4, "Basis"), para("Consolidation and methods: see the full inventory. Biogenic CO₂ (", chip(ghg("biogenic_co2")), " tCO₂e) is reported separately.")))
    .caption("source", [p.M, 276, p.CW, 6], "From approved emission entries in ESGLite.");
  return p.build();
}

export function ghgSummary(): FamilySeed {
  return {
    template: {
      family: "ghg-one-page",
      version: 1,
      kind: "ghg",
      purpose: "summary",
      format: "a4",
      name: "One-page summary",
      description: "The year on one A4 page: four headline numbers, scopes, top Scope 3 categories, sites and intensity.",
      tags: ["summary", "one page", "a4", "factsheet"],
      looks: [...LOOKS],
      meta: { title: "{{company}} GHG summary {{period}}", frameworks: ["GHGP"] },
      pages: [{ layout: "summary" }],
    },
    layouts: [summaryPage()],
  };
}

export const GHG_FAMILIES = () => [ghgInventory(), ghgIso(), ghgBoardBrief(), ghgSummary()];
