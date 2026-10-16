/**
 * S3-10 request bodies.
 *
 * STAND-INS until ESG-lite #144 (S3-0 follow-ups) merges: `PutUseProfileBodySchema`
 * and `SoldProductsPlanBodySchema` are copied from that PR's
 * src/scope3/contracts/schemas.ts; when it lands, import them from contracts/
 * and keep the S3-10 extras below (an S3-0 follow-up should add them there):
 *   - `use_profile` (UseProfileExtraSchema): packaging per unit for Category 12,
 *     and how the product is used for the Category 11 plan;
 *   - the bulk sales body (`{sales: [...]}`, at most 5,000 rows, the CSV import).
 */
import { z } from "zod";
import { EolMixSchema, ProductSaleSchema, ProductScope3FieldsSchema } from "../contracts/schemas";

/** The end-of-life treatments a mix may name (Category 12, formula 12.1; methods as Category 5). */
export const EOL_TREATMENTS = ["landfill", "incineration", "recycling", "composting"] as const;
export type EolTreatment = (typeof EOL_TREATMENTS)[number];

/** How a product is used (Category 11): 11.1 energy, 11.2 fuel, 11.3 gas, 11.5 part of a customer's product. */
export const USE_TYPES = ["energy", "fuel", "gas", "intermediate"] as const;
export type UseType = (typeof USE_TYPES)[number];

export const UseProfileExtraSchema = z
  .object({
    /** Packaging thrown away with each unit (kg); Category 12. */
    packaging_kg_per_unit: z.number().min(0).max(1e6).nullable().optional(),
    use_type: z.enum(USE_TYPES).nullable().optional(),
    /** The factor choice for the use type: a grid country, a fuel or a gas (configs.ts USE_OPTIONS). */
    use_option: z.string().trim().min(1).max(100).nullable().optional(),
    /** 11.1: energy per use (kWh). */
    energy_per_use_kwh: z.number().positive().max(1e9).nullable().optional(),
    /** 11.3: gas in one product (kg) and the share released over its life (%, 100 when unknown, L5442-5452). */
    gas_per_product_kg: z.number().positive().max(1e6).nullable().optional(),
    gas_released_pct: z.number().positive().max(100).nullable().optional(),
    /** 11.5: our product's share of the customer's final product (%, physical allocation, L5581-5613). */
    final_product_share_pct: z.number().positive().max(100).nullable().optional(),
  })
  .strict();
export type UseProfileExtra = z.infer<typeof UseProfileExtraSchema>;

/** `PUT /scope3/products/:id/use-profile` (#144's PutUseProfileBodySchema) plus the S3-10 `use_profile`. */
export const PutUseProfileBodySchema = ProductScope3FieldsSchema.extend({
  eol_mix: EolMixSchema.nullable().optional(),
  use_profile: UseProfileExtraSchema.nullable().optional(),
}).strict();
export type PutUseProfileBody = z.infer<typeof PutUseProfileBodySchema>;

/** `POST /scope3/sold-products/plan` (#144's SoldProductsPlanBodySchema). */
export const SoldProductsPlanBodySchema = z
  .object({
    company_id: z.number().int().positive().optional(),
    site_id: z.number().int().positive(),
    year: z.number().int().min(2000).max(2100),
    year_type: z.enum(["CY", "FY"]),
    ghg_category: z.union([z.literal(10), z.literal(11), z.literal(12)]),
  })
  .strict();
export type SoldProductsPlanBody = z.infer<typeof SoldProductsPlanBodySchema>;

export const PRODUCT_SALES_MAX_ROWS = 5000;

/** One sale as sent: `period` may be a month ("2026-03") or a date (stored as the first of its month). */
export const SaleInputSchema = ProductSaleSchema.omit({ id: true, company_id: true, period: true })
  .extend({ period: z.string().trim().regex(/^\d{4}-\d{2}(-\d{2})?$/, "Use YYYY-MM or YYYY-MM-DD.") })
  .strict();
export type SaleInput = z.infer<typeof SaleInputSchema>;

export const PostSalesBodySchema = z
  .object({ company_id: z.number().int().positive().optional(), sales: z.array(SaleInputSchema).min(1).max(PRODUCT_SALES_MAX_ROWS) })
  .strict();

export const PutSaleBodySchema = SaleInputSchema.omit({ product_id: true }).partial().strict();
