import { Check, Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * A company's Scope 3 boundary (S3-1, docs/scope3/01-contracts.md §4): one row
 * per company and GHG Protocol category 1–15, saying whether the category is
 * included, excluded, not relevant or still being screened, and why. The only
 * source of included/excluded status and reasons for reports.
 */
@Entity("company_scope3_category")
@Index("UQ_company_scope3_category_company_n", ["company_id", "ghg_category"], { unique: true })
@Check("CHK_company_scope3_category_n", `"ghg_category" >= 1 AND "ghg_category" <= 15`)
export class CompanyScope3Category {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "smallint" })
  ghg_category!: number;

  /** included | excluded | not_relevant | screening */
  @Column({ type: "varchar", length: 20, default: "screening" })
  status!: string;

  /** Required unless included. */
  @Column({ type: "text", nullable: true })
  reason!: string | null;

  @Column({ type: "text", nullable: true })
  method_note!: string | null;

  /** Scope 3 Standard Table 6.1 relevance criteria ticks. */
  @Column({ type: "jsonb", nullable: true })
  relevance!: Record<string, boolean> | null;

  /** User id of the last change; null for rows the migration seeded. */
  @Column({ type: "int", nullable: true })
  updated_by!: number | null;

  @Column({ type: "timestamp", default: () => "now()" })
  updated_at!: Date;
}
