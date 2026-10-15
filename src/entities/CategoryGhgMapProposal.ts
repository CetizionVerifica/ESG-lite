import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * A proposed GHG Protocol category number for one Scope 3 category a company
 * uses (S3-1 backfill, D1). The backfill writes the proposal and its
 * confidence; a Superadmin confirms it on the Boundary page, which writes
 * category.ghg_category.
 */
@Entity("category_ghg_map_proposal")
@Index("UQ_category_ghg_map_proposal_company_category", ["company_id", "category_id"], { unique: true })
@Check("CHK_category_ghg_map_proposal_n", `"ghg_category" IS NULL OR ("ghg_category" >= 1 AND "ghg_category" <= 15)`)
export class CategoryGhgMapProposal {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  category_id!: number;

  @Column({ type: "int" })
  company_id!: number;

  /** Proposed number; null when nothing matched. */
  @Column({ type: "smallint", nullable: true })
  ghg_category!: number | null;

  /** 0–100. */
  @Column({ type: "smallint", default: 0 })
  confidence!: number;

  /** Where the proposal came from: exact, legacy_map, keyword, none. */
  @Column({ type: "varchar", length: 20, default: "none" })
  basis!: string;

  @Column({ type: "int", nullable: true })
  confirmed_by!: number | null;

  @Column({ type: "timestamp", nullable: true })
  confirmed_at!: Date | null;

  @Column({ type: "timestamp", default: () => "now()" })
  created_at!: Date;
}
