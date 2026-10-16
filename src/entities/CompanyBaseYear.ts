import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * A company's frozen base year (S3-14, docs/scope3/01-contracts.md §4 and the
 * §10 follow-ups). One row per company and scope; only 'Scope 3' is written
 * today. `snapshot` holds the frozen per-category tCO₂e, the version and
 * frozen_at, and the per-row fingerprints the nightly check compares against.
 */
@Entity("company_base_year")
@Index("UQ_company_base_year_company_scope", ["company_id", "scope"], { unique: true })
export class CompanyBaseYear {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "varchar", length: 20, default: "Scope 3" })
  scope!: string;

  @Column({ type: "int" })
  base_year!: number;

  /** CY | FY */
  @Column({ type: "varchar", length: 2, default: "CY" })
  year_type!: string;

  @Column("decimal", { precision: 5, scale: 2, default: 5 })
  significance_pct!: string;

  @Column({ type: "text", nullable: true })
  policy_note!: string | null;

  @Column({ type: "text", nullable: true })
  rationale!: string | null;

  @Column({ type: "jsonb", nullable: true })
  snapshot!: Record<string, unknown> | null;

  @Column({ type: "int", nullable: true })
  updated_by!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
