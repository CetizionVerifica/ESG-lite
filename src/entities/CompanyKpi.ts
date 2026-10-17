import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * A KPI the company chose to track, or left out with a reason (KPI-3). A
 * library KPI with no row isn't selected. `frequency` overrides the KPI's
 * default frequency for this company (null = the default). One row per
 * (company, KPI).
 */
@Entity("company_kpi")
@Index("UQ_company_kpi_company_kpi", ["company_id", "kpi_definition_id"], { unique: true })
export class CompanyKpi {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  kpi_definition_id!: number;

  @Column({ type: "boolean", default: true })
  selected!: boolean;

  /** monthly | quarterly | annual; null = the KPI's default_frequency */
  @Column({ type: "varchar", length: 10, nullable: true })
  frequency!: string | null;

  @Column({ type: "text", nullable: true })
  reason_excluded!: string | null;

  @Column({ type: "int", nullable: true })
  updated_by!: number | null;

  @UpdateDateColumn()
  updated_at!: Date;
}
