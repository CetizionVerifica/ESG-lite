/**
 * DS-9 · sustainability prompts (the RS-8 text actions that need KPI context).
 * They get the design's KPIs resolved by DS-2 and the report details only.
 */
export const SUSTAINABILITY_TASKS = {
  leadership_draft:
    "Draft the leadership message in the first person plural ('we'), from REPORT DETAILS (leadership message notes) and FACTS: what changed this year, what the company is proud of, and what still needs work. End with the line '[Name, title — to be confirmed]'. It is a draft for the signatory to confirm.",
  about_report:
    "Write the 'About this report' text: the reporting period, the frameworks used, the boundary (sites), and that figures come from approved KPI values. Use {{input:KEY}} for report details.",
  add_target_context:
    "Add one or two sentences that put the figures in this text against their targets, using the target and progress tokens from FACTS. Keep every existing token.",
  missing_disclosures:
    "Compare REPORT DETAILS and FACTS with what the selected frameworks (GRI, BRSR, ESRS) expect a report to disclose (period, boundary, material topics, targets, verification). List each missing or weak disclosure as a finding with a plain fix. Name framework codes, never quote standard text.",
} as const;
