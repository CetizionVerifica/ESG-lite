import { Check, Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * A company's screening input for one Scope 3 category and year (S3-12,
 * docs/scope3/01-contracts.md §4): a rough spend, headcount, revenue or mass
 * figure, so a category with no emission rows can still be estimated on the
 * screening page. Estimates made from it are shown, never saved as emission
 * rows. Limits match `ScreeningInputSchema` (src/scope3/contracts/schemas.ts).
 */
@Entity("scope3_screening_input")
@Index("UQ_scope3_screening_input_company_year_n_basis", ["company_id", "year", "ghg_category", "basis"], { unique: true })
@Check("CHK_scope3_screening_input_n", `"ghg_category" >= 1 AND "ghg_category" <= 15`)
@Check("CHK_scope3_screening_input_amount", `"amount" >= 0`)
export class Scope3ScreeningInput {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  year!: number;

  @Column({ type: "smallint" })
  ghg_category!: number;

  /** spend | headcount | revenue | mass_sold | other (`SCREENING_BASES`). */
  @Column({ type: "varchar", length: 20 })
  basis!: string;

  /** In `currency` for spend and revenue; people for headcount; kg for mass_sold. */
  @Column("decimal", { precision: 20, scale: 4 })
  amount!: string;

  /** ISO 4217, for spend and revenue. */
  @Column({ type: "varchar", length: 3, nullable: true })
  currency!: string | null;

  /** EEIO sector code the spend estimate uses (S3-5 lookups). */
  @Column({ type: "varchar", length: 100, nullable: true })
  eeio_sector!: string | null;

  @Column({ type: "varchar", length: 2000, nullable: true })
  note!: string | null;

  @Column({ type: "int", nullable: true })
  updated_by!: number | null;

  @UpdateDateColumn()
  updated_at!: Date;
}
