import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/**
 * A company's KPI settings (KPI-3, docs/kpi/01-contracts.md §2). One row per
 * company, made by the first `PUT /kpi/setup`. `year_type` CY | FY is the year
 * every KPI period of the company follows; `due_day` is the day of the month
 * after a period ends on which its values are due (D16). Setup is finished
 * when `setup_completed_at` is set.
 */
@Entity("company_kpi_settings")
export class CompanyKpiSettings {
  @PrimaryColumn({ type: "int" })
  company_id!: number;

  /** CY | FY */
  @Column({ type: "varchar", length: 2, default: "CY" })
  year_type!: string;

  @Column({ type: "int" })
  first_year!: number;

  @Column({ type: "int", default: 15 })
  due_day!: number;

  @Column({ type: "timestamp", nullable: true })
  setup_completed_at!: Date | null;

  @Column({ type: "int", nullable: true })
  updated_by!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
