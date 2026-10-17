import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * One KPI value for a site (or the company, `site_id` null) and a period
 * (KPI-4, docs/kpi/01-contracts.md §2). Stored as entered (`value_numeric`,
 * `unit`) and in the KPI's canonical unit (`value_canonical`). Status flow
 * draft → pending → approved | rejected; a contributor's edit of a rejected
 * value makes it a draft again.
 *
 * One value per (company, site, KPI, period_start, frequency):
 * `UQ_kpi_value_company_site_kpi_period` treats a null site as one value, so it
 * is an expression index made by migrate:kpi-values (`synchronize: false`).
 */
@Entity("kpi_value")
@Index("UQ_kpi_value_company_site_kpi_period", { synchronize: false })
@Index("IDX_kpi_value_company_kpi_period", ["company_id", "kpi_definition_id", "period_start"])
@Index("IDX_kpi_value_site_status", ["site_id", "status"])
export class KpiValue {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int", nullable: true })
  site_id!: number | null;

  @Column({ type: "int" })
  kpi_definition_id!: number;

  @Column({ type: "date" })
  period_start!: string;

  @Column({ type: "date" })
  period_end!: string;

  /** monthly | quarterly | annual */
  @Column({ type: "varchar", length: 10 })
  frequency!: string;

  /** CY | FY */
  @Column({ type: "varchar", length: 2, default: "CY" })
  year_type!: string;

  @Column("decimal", { precision: 24, scale: 6, nullable: true })
  value_numeric!: string | null;

  @Column({ type: "text", nullable: true })
  value_text!: string | null;

  @Column({ type: "varchar", length: 40, nullable: true })
  unit!: string | null;

  @Column("decimal", { precision: 24, scale: 6, nullable: true })
  value_canonical!: string | null;

  @Column({ type: "jsonb", nullable: true })
  breakdown!: Record<string, number> | null;

  /** manual | auto | formula */
  @Column({ type: "varchar", length: 10, default: "manual" })
  source!: string;

  /** draft | pending | approved | rejected */
  @Column({ type: "varchar", length: 10, default: "draft" })
  status!: string;

  @Column({ type: "boolean", default: false })
  is_estimate!: boolean;

  @Column({ type: "text", nullable: true })
  comment!: string | null;

  @Column({ type: "int", nullable: true })
  entered_by!: number | null;

  @Column({ type: "timestamp", nullable: true })
  submitted_at!: Date | null;

  @Column({ type: "int", nullable: true })
  reviewed_by!: number | null;

  @Column({ type: "timestamp", nullable: true })
  reviewed_at!: Date | null;

  @Column({ type: "text", nullable: true })
  review_comment!: string | null;

  /** KPI-8 review checks */
  @Column({ type: "jsonb", nullable: true })
  checks!: Record<string, unknown> | null;

  /** KPI-5: what an auto value was read from */
  @Column({ type: "jsonb", nullable: true })
  auto_snapshot!: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
