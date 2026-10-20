/**
 * DS-10 contracts: `POST /studio/docs/:id/resize` and `GET /studio/docs/:id/source`
 * (the linked-source chip). The mapping itself is pure and shared with the FE:
 * src/studio/resize/engine.ts (mirror: ESG-lite_FE src/lib/studio/resize.ts).
 */
import { z } from "zod";
import { DocPurposeSchema, PageFormatSchema } from "./enums";

/** `POST /docs/:id/resize`. `ai` asks DS-9 for summaries (summarise_for_deck / _social); off = cut to fit. */
export const ResizeBodySchema = z
  .object({
    format: PageFormatSchema,
    purpose: DocPurposeSchema,
    pageIds: z.array(z.string().min(1).max(120)).min(1).max(500).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    ai: z.boolean().optional(),
    /** A Superadmin names the company (as every studio body). */
    company_id: z.union([z.number(), z.string()]).optional(),
  })
  .strict();
export type ResizeBody = z.infer<typeof ResizeBodySchema>;

/** 201 answer: the new design's id plus what the copy left out (the dialog's toast). */
export interface ResizeResponse {
  id: number;
  title: string;
  pageCount: number;
  dropped: number;
  truncated: number;
  summarised: number;
}

/** `GET /docs/:id/source`: `source` is null for a design that isn't a resized copy. */
export interface LinkedSource {
  docId: number;
  /** False when the source was deleted or the caller can no longer read it. */
  exists: boolean;
  title: string | null;
  /** The source rev and data hash the copy was made from. */
  rev: number;
  dataHash: string;
  currentRev: number | null;
  currentDataHash: string | null;
  /** The source's approved data moved since the copy was made ("Source data changed"). */
  dataChanged: boolean;
}
export interface LinkedSourceResponse {
  source: LinkedSource | null;
}
