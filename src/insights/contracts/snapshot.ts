/**
 * IN-0 · the contract values the FE mirror (ESG-lite_FE src/lib/insights/contracts.ts)
 * must carry, as one JSON object. scripts/insights-contracts-snapshot.cjs writes it to
 * ci/insights-contracts.json; the FE keeps a copy (src/lib/insights/contracts.snapshot.json)
 * and its vitest compares the mirror with it. ci/unit/in-0-contracts.test.cjs checks the
 * backend file is current.
 */
import { AVAILABILITIES, ATTENTION_KINDS, CARD_SEVERITIES, CARD_SEVERITY_RANK, CARD_SOURCES, COMPARES, DRIVERS, EVENT_KINDS, INSIGHTS_ROLES, KPI_PANELS, PANEL_IDS, PILLARS, TARGET_SOURCES, TARGET_STATUSES, TARGET_STATUS_ORDER, YEAR_TYPES, DECOUPLING_YEARS_DEFAULT, DECOUPLING_YEARS_MAX, STRIPES_MONTHS_MAX, EVENT_LABEL_MAX, MAX_CARDS } from "./enums";
import { IN_ERRORS } from "./errors";
import { PANEL_PATHS } from "./panels";
import { AI_TEXT_MAX, RULES, RULE_IDS } from "./rules";

export const contractsSnapshot = () => ({
  enums: {
    PANEL_IDS: [...PANEL_IDS],
    KPI_PANELS: [...KPI_PANELS],
    AVAILABILITIES: [...AVAILABILITIES],
    TARGET_STATUSES: [...TARGET_STATUSES],
    TARGET_STATUS_ORDER: [...TARGET_STATUS_ORDER],
    TARGET_SOURCES: [...TARGET_SOURCES],
    PILLARS: [...PILLARS],
    DRIVERS: [...DRIVERS],
    EVENT_KINDS: [...EVENT_KINDS],
    CARD_SEVERITIES: [...CARD_SEVERITIES],
    CARD_SEVERITY_RANK: [...CARD_SEVERITY_RANK],
    CARD_SOURCES: [...CARD_SOURCES],
    YEAR_TYPES: [...YEAR_TYPES],
    COMPARES: [...COMPARES],
    ATTENTION_KINDS: [...ATTENTION_KINDS],
    INSIGHTS_ROLES: [...INSIGHTS_ROLES],
  },
  limits: { DECOUPLING_YEARS_DEFAULT, DECOUPLING_YEARS_MAX, STRIPES_MONTHS_MAX, EVENT_LABEL_MAX, MAX_CARDS, AI_TEXT_MAX },
  panelPaths: { ...PANEL_PATHS },
  /** Non-panel endpoints under /insights (01-contracts §4). */
  otherPaths: ["/status", "/sites", "/events", "/events/:id", "/snapshot.pdf"],
  rules: Object.fromEntries(RULE_IDS.map((id) => [id, { severities: [...RULES[id].severities], params: [...RULES[id].params] }])),
  errors: Object.fromEntries(Object.entries(IN_ERRORS).map(([code, e]) => [code, e.status])),
});
