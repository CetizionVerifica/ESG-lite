/**
 * DS-9 · GHG prompts (01-contracts §8): they get resolved values and report
 * details only (contextBlock), never raw entries or factors.
 */
import { ghgCategory } from "../../../../scope3/contracts/ghgCategory";

export const GHG_TASKS = {
  ghg_exec_summary:
    "Write the executive summary of the GHG inventory: total emissions and the split by Scope 1, Scope 2 (location-based) and Scope 3 with their tokens, the change against the prior year, the largest sources, and biogenic CO₂ reported separately when FACTS has it. Say that market-based Scope 2 isn't reported when FACTS marks it not available. Two or three short paragraphs.",
  ghg_methodology_text:
    "Write the methodology text: the standard followed (from REPORT DETAILS conformance, else the GHG Protocol Corporate Standard), the consolidation approach, the reporting period, the GWP values used, that emissions are calculated from approved activity data multiplied by emission factors, and how Scope 3 categories were screened and excluded. Use {{input:KEY}} for report details. No figures beyond tokens.",
  exclusion_reason_draft:
    "Draft a short justification for each excluded or not-yet-reported Scope 3 category in FACTS or REPORT DETAILS exclusions, as a bulleted list: '- Category N: Name — reason'. Base reasons only on REPORT DETAILS and the company's industry; where the reason isn't known, write 'Reason to be confirmed' so a person fills it in. This is a draft a person must confirm.",
  missing_disclosures:
    "Compare the REPORT DETAILS and FACTS with what a GHG Protocol (and, when selected, ISO 14064-1, BRSR P6 or ESRS E1) inventory report must disclose: consolidation approach, reporting period, base year and recalculation policy, Scope 2 location- and market-based, every Scope 3 category reported or excluded with a reason, gases, biogenic CO₂ separately, GWP source, emission factor sources, verification status, responsible person (ISO), uncertainty (ISO), intensity (BRSR, ESRS). List each missing or weak disclosure as a finding with a plain fix.",
} as const;

export function scope3CategoryTask(n: number): string {
  const c = ghgCategory(n);
  return `Write the text for Scope 3 Category ${n}: ${c?.name ?? ""}. Say what the category covers for this company, its figure ({{data:scope3_category.${n}|current|value}}) and change when FACTS has them, and the data quality. If FACTS marks it not available or it is excluded in REPORT DETAILS, explain that instead, with the reason. One or two paragraphs.`;
}
