import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * A framework version a company reports on (KPI-3, docs/kpi/01-contracts.md §2).
 * One version per framework code: `framework_code` copies `kpi_framework.code`
 * so the database holds the rule (`UQ_company_framework_company_code`).
 */
@Entity("company_framework")
@Index("UQ_company_framework_company_code", ["company_id", "framework_code"], { unique: true })
export class CompanyFramework {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  framework_id!: number;

  /** GRI | BRSR | ESRS */
  @Column({ type: "varchar", length: 20 })
  framework_code!: string;

  @Column({ type: "timestamp", default: () => "now()" })
  enabled_at!: Date;

  @Column({ type: "int", nullable: true })
  enabled_by!: number | null;
}
