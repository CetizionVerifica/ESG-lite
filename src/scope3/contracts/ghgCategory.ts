/**
 * Scope 3 contracts (S3-0) §1: the GHG Protocol categories 1–15, their
 * calculation methods in specificity order, and the Scope and Cat 3
 * sub-activity enums. Copied from docs/scope3/01-contracts.md §1.
 *
 * Changing anything here is an S3-0 follow-up PR, merged before the module
 * that needs it. Every other module imports from here.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/** Every calculation method key in §1, plus `unknown` for rows saved before S3-3. */
export const METHOD_KEYS = [
  "supplier_specific",
  "hybrid",
  "average_data",
  "spend_based",
  "fuel_based",
  "distance_based",
  "site_specific",
  "waste_type_specific",
  "asset_specific",
  "lessor_specific",
  "lessee_specific",
  "direct_use",
  "indirect_use",
  "franchise_specific",
  "investment_specific",
  "project_specific",
  "unknown",
] as const;

export const MethodSchema = z.enum(METHOD_KEYS);
export type Method = z.infer<typeof MethodSchema>;

/**
 * Default plain label per method. §1 gives most of them; where §1 names a
 * method without a label (asset/lessor/lessee/franchise/investment/project
 * specific, indirect use) the label is the key in words. A category can
 * override a label (§1 rows 4, 6, 7, 9): see `methodLabel()`.
 */
export const METHOD_LABELS: Record<Method, string> = {
  supplier_specific: "Supplier's own figure",
  hybrid: "Supplier's energy and materials",
  average_data: "Average data",
  spend_based: "From the amount spent",
  fuel_based: "From fuel used",
  distance_based: "Distance travelled",
  site_specific: "Site-specific",
  waste_type_specific: "By waste type and treatment",
  asset_specific: "Asset-specific",
  lessor_specific: "Lessor-specific",
  lessee_specific: "Lessee-specific",
  direct_use: "Direct use (energy, fuel, gases)",
  indirect_use: "Indirect use",
  franchise_specific: "Franchise-specific",
  investment_specific: "Investment-specific",
  project_specific: "Project-specific",
  unknown: "Not recorded",
};

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const GHG_CATEGORY_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export type GhgCategoryNumber = (typeof GHG_CATEGORY_NUMBERS)[number];
export const GhgCategoryNumberSchema = z.number().int().min(1).max(15);

export const GHG_CATEGORY_KEYS = [
  "purchased_goods",
  "capital_goods",
  "fuel_energy",
  "upstream_transport",
  "waste",
  "business_travel",
  "employee_commuting",
  "upstream_leased",
  "downstream_transport",
  "processing",
  "use_of_sold",
  "end_of_life",
  "downstream_leased",
  "franchises",
  "investments",
] as const;
export const GhgCategoryKeySchema = z.enum(GHG_CATEGORY_KEYS);
export type GhgCategoryKey = z.infer<typeof GhgCategoryKeySchema>;

export type Direction = "upstream" | "downstream";

export interface MethodOption {
  key: Exclude<Method, "unknown">;
  /** The plain label for this method in this category. */
  label: string;
}

export interface GhgCategory {
  n: GhgCategoryNumber;
  key: GhgCategoryKey;
  /** The GHG Protocol name, exactly. */
  name: string;
  direction: Direction;
  /** Methods offered, most specific first (index 0). S3-12 screening and the DQ default use this rank. */
  methods: readonly MethodOption[];
}

const m = (key: MethodOption["key"], label?: string): MethodOption => ({ key, label: label ?? METHOD_LABELS[key] });

// Cat 1 and 2 share their methods (§1: "same as 1").
const GOODS_METHODS = [
  m("supplier_specific"),
  m("hybrid"),
  m("average_data", "Average for the material"),
  m("spend_based"),
] as const;

// Cat 4 and 9 share their methods (§1: "as 4").
const TRANSPORT_METHODS = [
  m("fuel_based"),
  m("distance_based", "Weight × distance"),
  m("spend_based"),
  m("site_specific", "Warehouse energy"),
  m("average_data"),
] as const;

/** §1, in category order. */
export const GHG_CATEGORIES: readonly GhgCategory[] = [
  { n: 1, key: "purchased_goods", name: "Purchased goods and services", direction: "upstream", methods: GOODS_METHODS },
  { n: 2, key: "capital_goods", name: "Capital goods", direction: "upstream", methods: GOODS_METHODS },
  {
    n: 3,
    key: "fuel_energy",
    name: "Fuel- and energy-related activities",
    direction: "upstream",
    methods: [m("supplier_specific"), m("average_data")],
  },
  { n: 4, key: "upstream_transport", name: "Upstream transportation and distribution", direction: "upstream", methods: TRANSPORT_METHODS },
  {
    n: 5,
    key: "waste",
    name: "Waste generated in operations",
    direction: "upstream",
    methods: [m("supplier_specific"), m("waste_type_specific"), m("average_data")],
  },
  {
    n: 6,
    key: "business_travel",
    name: "Business travel",
    direction: "upstream",
    methods: [m("fuel_based"), m("distance_based", "Distance travelled"), m("spend_based")],
  },
  {
    n: 7,
    key: "employee_commuting",
    name: "Employee commuting",
    direction: "upstream",
    methods: [m("fuel_based"), m("distance_based"), m("average_data", "Headcount × national average")],
  },
  {
    n: 8,
    key: "upstream_leased",
    name: "Upstream leased assets",
    direction: "upstream",
    methods: [m("asset_specific"), m("lessor_specific"), m("average_data")],
  },
  { n: 9, key: "downstream_transport", name: "Downstream transportation and distribution", direction: "downstream", methods: TRANSPORT_METHODS },
  {
    n: 10,
    key: "processing",
    name: "Processing of sold products",
    direction: "downstream",
    methods: [m("site_specific"), m("average_data")],
  },
  {
    n: 11,
    key: "use_of_sold",
    name: "Use of sold products",
    direction: "downstream",
    // direct_use covers 11.1–11.3; indirect_use is optional.
    methods: [m("direct_use"), m("indirect_use")],
  },
  {
    n: 12,
    key: "end_of_life",
    name: "End-of-life treatment of sold products",
    direction: "downstream",
    methods: [m("waste_type_specific"), m("average_data")],
  },
  {
    n: 13,
    key: "downstream_leased",
    name: "Downstream leased assets",
    direction: "downstream",
    methods: [m("asset_specific"), m("lessee_specific"), m("average_data")],
  },
  {
    n: 14,
    key: "franchises",
    name: "Franchises",
    direction: "downstream",
    methods: [m("franchise_specific"), m("average_data")],
  },
  {
    n: 15,
    key: "investments",
    name: "Investments",
    direction: "downstream",
    methods: [m("investment_specific"), m("average_data"), m("project_specific")],
  },
];

/** The category with number `n`, or undefined. */
export const ghgCategory = (n: number): GhgCategory | undefined => GHG_CATEGORIES.find((c) => c.n === n);

/** "Category 1 · Purchased goods and services". */
export const categoryLabel = (n: number): string => {
  const c = ghgCategory(n);
  return c ? `Category ${c.n} · ${c.name}` : `Category ${n}`;
};

/** A method's plain label, in a category's wording when it has its own (e.g. Cat 7 average data). */
export const methodLabel = (key: Method, n?: number): string =>
  (n !== undefined ? ghgCategory(n)?.methods.find((o) => o.key === key)?.label : undefined) ?? METHOD_LABELS[key];

/** Whether a category offers a method (S3-3 `METHOD_NOT_ALLOWED`). */
export const methodAllowed = (n: number, key: Method): boolean => !!ghgCategory(n)?.methods.some((o) => o.key === key);

/** A method's specificity rank in a category (0 = most specific), or -1 when not offered. */
export const methodRank = (n: number, key: Method): number => ghgCategory(n)?.methods.findIndex((o) => o.key === key) ?? -1;

// ---------------------------------------------------------------------------
// Scope and Cat 3 sub-activities
// ---------------------------------------------------------------------------

/** `category.scope`: stored as today, validated (S3-4). null = a saving, such as renewables. */
export const SCOPES = ["Scope 1", "Scope 2", "Scope 3"] as const;
export const ScopeSchema = z.enum(SCOPES).nullable();
export type Scope = z.infer<typeof ScopeSchema>;

/** Cat 3 only. */
export const SCOPE3_SUBS = ["3a_upstream_fuels", "3b_upstream_electricity", "3c_td_losses", "3d_resold_energy"] as const;
export const Scope3SubSchema = z.enum(SCOPE3_SUBS);
export type Scope3Sub = z.infer<typeof Scope3SubSchema>;
