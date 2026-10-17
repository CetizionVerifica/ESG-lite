import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * A framework version in the KPI library (KPI-2, docs/kpi/01-contracts.md §2):
 * GRI 2021+, BRSR 2023, ESRS 2023. Mappings belong to a version, and a client
 * picks the versions it reports on (D6). `edited_at` is set when a Superadmin
 * changes the row, so a re-seed never overwrites it. Made by migrate:kpi-library.
 */
@Entity("kpi_framework")
@Index("UQ_kpi_framework_code_version", ["code", "version"], { unique: true })
export class KpiFramework {
  @PrimaryGeneratedColumn()
  id!: number;

  /** GRI | BRSR | ESRS */
  @Column({ type: "varchar", length: 20 })
  code!: string;

  @Column({ type: "varchar", length: 40 })
  version!: string;

  @Column({ type: "varchar", length: 200 })
  name!: string;

  @Column({ type: "text" })
  source_url!: string;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({ type: "boolean", default: false })
  default_for_new!: boolean;

  @Column({ type: "timestamp", nullable: true })
  edited_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;
}
