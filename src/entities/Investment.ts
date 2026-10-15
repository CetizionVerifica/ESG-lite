import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * An equity, debt or project investment of a company (S3-11, Category 15,
 * docs/scope3/01-contracts.md §4 with the §10 revenue, currency and EEIO
 * sector fields). The register only: Category 15 emission rows are made from
 * it by POST /scope3/investments/plan and calculated by emissionWrite.
 */
@Entity("investment")
@Index("IDX_investment_company", ["company_id"])
@Check("CHK_investment_share_pct", `"share_pct" >= 0 AND "share_pct" <= 100`)
export class Investment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "varchar", length: 200 })
  investee!: string;

  /** equity | debt | project */
  @Column({ type: "varchar", length: 20, default: "equity" })
  type!: string;

  /** Share of equity (or of the project / loan), 0–100. */
  @Column("decimal", { precision: 7, scale: 4 })
  share_pct!: string;

  /** The investee's reported Scope 1+2 (investment-specific, 15.1). */
  @Column("decimal", { precision: 18, scale: 4, nullable: true })
  investee_scope12_tco2e!: string | null;

  @Column({ type: "int" })
  year!: number;

  @Column({ type: "varchar", length: 200, nullable: true })
  source!: string | null;

  /** Investee revenue, for the average-data method (15.2). */
  @Column("decimal", { precision: 20, scale: 2, nullable: true })
  revenue!: string | null;

  @Column({ type: "varchar", length: 3, nullable: true })
  currency!: string | null;

  /** EEIO sector: the name of the `eeio_spend` factor the average-data row uses. */
  @Column({ type: "varchar", length: 100, nullable: true })
  eeio_sector!: string | null;

  /** Revenue share per sector, `{sector: share}` summing to 1; overrides eeio_sector. */
  @Column({ type: "jsonb", nullable: true })
  sector_split!: Record<string, number> | null;

  @Column({ type: "int", nullable: true })
  created_by!: number | null;

  @Column({ type: "int", nullable: true })
  updated_by!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
