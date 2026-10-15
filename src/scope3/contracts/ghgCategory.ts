/**
 * GHG Protocol Scope 3 categories (docs/scope3/01-contracts.md §1).
 *
 * STAND-IN written by S3-1 ahead of S3-0 (ESG-lite #134). S3-0 owns this file:
 * when S3-0 merges, take S3-0's version and keep only what S3-1 imports
 * (GHG_CATEGORIES, GhgCategoryNumber, isGhgCategoryNumber, ghgCategory).
 */
export type Direction = "upstream" | "downstream";

export type MethodKey =
  | "supplier_specific"
  | "hybrid"
  | "average_data"
  | "spend_based"
  | "fuel_based"
  | "distance_based"
  | "site_specific"
  | "waste_type_specific"
  | "asset_specific"
  | "lessor_specific"
  | "lessee_specific"
  | "direct_use"
  | "indirect_use"
  | "franchise_specific"
  | "investment_specific"
  | "project_specific";

export type GhgCategoryNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export interface GhgCategory {
  n: GhgCategoryNumber;
  key: string;
  /** Exact GHG Protocol name. */
  name: string;
  direction: Direction;
  /** Most specific first. */
  methods: readonly MethodKey[];
}

const GOODS: readonly MethodKey[] = ["supplier_specific", "hybrid", "average_data", "spend_based"];
const TRANSPORT: readonly MethodKey[] = ["fuel_based", "distance_based", "spend_based", "site_specific", "average_data"];

export const GHG_CATEGORIES: readonly GhgCategory[] = [
  { n: 1, key: "purchased_goods", name: "Purchased goods and services", direction: "upstream", methods: GOODS },
  { n: 2, key: "capital_goods", name: "Capital goods", direction: "upstream", methods: GOODS },
  { n: 3, key: "fuel_energy", name: "Fuel- and energy-related activities", direction: "upstream", methods: ["supplier_specific", "average_data"] },
  { n: 4, key: "upstream_transport", name: "Upstream transportation and distribution", direction: "upstream", methods: TRANSPORT },
  { n: 5, key: "waste", name: "Waste generated in operations", direction: "upstream", methods: ["supplier_specific", "waste_type_specific", "average_data"] },
  { n: 6, key: "business_travel", name: "Business travel", direction: "upstream", methods: ["fuel_based", "distance_based", "spend_based"] },
  { n: 7, key: "employee_commuting", name: "Employee commuting", direction: "upstream", methods: ["fuel_based", "distance_based", "average_data"] },
  { n: 8, key: "upstream_leased", name: "Upstream leased assets", direction: "upstream", methods: ["asset_specific", "lessor_specific", "average_data"] },
  { n: 9, key: "downstream_transport", name: "Downstream transportation and distribution", direction: "downstream", methods: TRANSPORT },
  { n: 10, key: "processing", name: "Processing of sold products", direction: "downstream", methods: ["site_specific", "average_data"] },
  { n: 11, key: "use_of_sold", name: "Use of sold products", direction: "downstream", methods: ["direct_use", "indirect_use"] },
  { n: 12, key: "end_of_life", name: "End-of-life treatment of sold products", direction: "downstream", methods: ["waste_type_specific", "average_data"] },
  { n: 13, key: "downstream_leased", name: "Downstream leased assets", direction: "downstream", methods: ["asset_specific", "lessee_specific", "average_data"] },
  { n: 14, key: "franchises", name: "Franchises", direction: "downstream", methods: ["franchise_specific", "average_data"] },
  { n: 15, key: "investments", name: "Investments", direction: "downstream", methods: ["investment_specific", "average_data", "project_specific"] },
];

export const isGhgCategoryNumber = (value: unknown): value is GhgCategoryNumber =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 15;

export const ghgCategory = (n: GhgCategoryNumber): GhgCategory => GHG_CATEGORIES[n - 1];
