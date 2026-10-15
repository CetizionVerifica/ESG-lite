// Category taxonomy (S3-1). Other modules import from here, not from service.ts.
export { categoryNumberFor, isScope3, isScope3Sql } from "./service";
export { proposeGhgCategory, normaliseName } from "./propose";
export type { Proposal, ProposalBasis } from "./propose";
