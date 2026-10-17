import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * Who enters a KPI for a site, or for the company (`site_id` null), and who
 * reviews it (KPI-3). `reviewer_user_id` null = the site's managers. One row
 * per (company, KPI, site): the unique index treats a null site as one value,
 * so it is an expression index made by migrate:kpi-setup (`synchronize: false`).
 */
@Entity("kpi_assignment")
@Index("UQ_kpi_assignment_company_kpi_site", { synchronize: false })
@Index("IDX_kpi_assignment_company_owner", ["company_id", "owner_user_id"])
export class KpiAssignment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  kpi_definition_id!: number;

  @Column({ type: "int", nullable: true })
  site_id!: number | null;

  @Column({ type: "int" })
  owner_user_id!: number;

  @Column({ type: "int", nullable: true })
  reviewer_user_id!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
