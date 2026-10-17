/**
 * S3-6 request bodies for /suppliers. The tables are 01-contracts.md §4; the
 * GWP set comes from the S3-0 factor contract. `company_id` (a Superadmin's)
 * is read by `companyForRequest` and stripped before these run.
 */
import { z } from "zod";
import { GwpSetSchema } from "../contracts/factor";
import { ALLOCATION_KEYS } from "./allocate";

/** The boundaries a figure may state, as C06 accepts them (`supplierRequest.controller.ts`). */
export const SUPPLIER_BOUNDARIES = ["cradle_to_gate", "cradle_to_grave", "gate_to_gate"] as const;
/** The only boundary the supplier-specific method expects (§4); anything else needs `confirm_boundary`. */
export const EXPECTED_BOUNDARY = "cradle_to_gate";

const name = z.string().trim().min(1).max(200);
const country = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .refine((s) => /^[A-Z]{2}$/.test(s), "country must be an ISO 3166 alpha-2 code");
const email = z.string().trim().max(200).email();
const year = z.number().int().min(1990).max(2100);
const unit = z.string().trim().min(1).max(20);

export const CreateSupplierSchema = z
  .object({
    name,
    country: country.nullable().optional(),
    email: email.nullable().optional(),
  })
  .strict();

export const UpdateSupplierSchema = z
  .object({
    name: name.optional(),
    country: country.nullable().optional(),
    email: email.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "Nothing to change.");

export const CreateSupplierFactorSchema = z
  .object({
    item: z.string().trim().min(1).max(200),
    unit,
    kgco2e_per_unit: z.number().finite().min(0).max(1e9),
    boundary: z.enum(SUPPLIER_BOUNDARIES).default(EXPECTED_BOUNDARY),
    reference_year: year,
    gwp_set: GwpSetSchema.nullable().optional(),
    evidence_document_id: z.number().int().positive().nullable().optional(),
    confirm_boundary: z.boolean().optional(),
  })
  .strict();

export const FacilityDataSchema = z
  .object({
    year,
    scope12_tco2e: z.number().finite().min(0).max(1e12),
    output_qty: z.number().finite().positive().max(1e15),
    output_unit: unit,
    allocation_key: z.enum(ALLOCATION_KEYS as unknown as ["mass", "economic"]).default("mass"),
  })
  .strict();

export const NameMatchDecisionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("similar_suppliers"),
      /** The supplier that stays. */
      keep_id: z.number().int().positive(),
      /** The other spelling: merged into keep_id on "link". */
      other_id: z.number().int().positive(),
      decision: z.enum(["link", "not_same"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("unlinked_name"),
      /** The name as rows give it in `extra_data.supplier_name`. */
      name,
      /** The supplier to link the rows to on "link". */
      supplier_id: z.number().int().positive().optional(),
      decision: z.enum(["link", "not_same"]),
    })
    .strict(),
]);

export type CreateSupplierBody = z.infer<typeof CreateSupplierSchema>;
export type UpdateSupplierBody = z.infer<typeof UpdateSupplierSchema>;
export type CreateSupplierFactorBody = z.infer<typeof CreateSupplierFactorSchema>;
export type FacilityDataBody = z.infer<typeof FacilityDataSchema>;
export type NameMatchDecision = z.infer<typeof NameMatchDecisionSchema>;
