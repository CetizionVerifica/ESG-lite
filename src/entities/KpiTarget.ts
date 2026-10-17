import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * A target for one KPI, for the company (`site_id` null) or one site (KPI-9,
 * docs/kpi/01-contracts.md §2): from `baseline_value` in `baseline_year` to
 * `target_value` in `target_year`, in the KPI's canonical unit, with a
 * `direction` (reduce | increase | maintain). Admins write; everyone in the
 * company reads.
 *
 * One target per (company, KPI, site, target year): the unique index treats a
 * null site as one value, so it is an expression index made by
 * migrate:kpi-targets (`synchronize: false`).
 */
@Entity("kpi_target")
@Index("UQ_kpi_target_company_kpi_site_year", { synchronize: false })
@Index("IDX_kpi_target_company_kpi", ["company_id", "kpi_definition_id"])
export class KpiTarget {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  kpi_definition_id!: number;

  @Column({ type: "int", nullable: true })
  site_id!: number | null;

  @Column({ type: "int" })
  baseline_year!: number;

  @Column({ type: "numeric", precision: 24, scale: 6 })
  baseline_value!: string;

  @Column({ type: "int" })
  target_year!: number;

  @Column({ type: "numeric", precision: 24, scale: 6 })
  target_value!: string;

  /** reduce | increase | maintain */
  @Column({ type: "varchar", length: 10 })
  direction!: string;

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @Column({ type: "int", nullable: true })
  created_by!: number | null;

  @Column({ type: "int", nullable: true })
  updated_by!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
