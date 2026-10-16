import { GhgCategoryNumber, GhgCategoryNumberSchema } from "../contracts/ghgCategory";

/** Whether a value is a GHG Protocol category number 1–15. */
export const isGhgCategoryNumber = (value: unknown): value is GhgCategoryNumber => GhgCategoryNumberSchema.safeParse(value).success;
