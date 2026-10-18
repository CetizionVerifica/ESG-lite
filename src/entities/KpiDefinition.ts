import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * A KPI, defined once (KPI-2, docs/kpi/01-contracts.md §2): its plain-language
 * question, unit, aggregation, level, frequency and source. `company_id` null
 * is the global library (Superadmin); set, it is that company's own KPI (KPI-3).
 *
 * Codes are unique per owner: `UQ_kpi_definition_owner_code` on
 * (COALESCE(company_id, 0), code) is an expression index made by
 * migrate:kpi-library (TypeORM can't declare it; `synchronize: false` keeps the
 * schema check away from it). `edited_at` is set when a Superadmin changes the
 * row, so a re-seed never overwrites it.
 *
 * `pillar` (D19, wave E): the KPI's ESG pillar, added and backfilled from its
 * topic (TOPIC_PILLAR) by migrate:kpi-pillars; a Superadmin may override it on
 * a library KPI.
 */
@Entity("kpi_definition")
@Index("UQ_kpi_definition_owner_code", { synchronize: false })
@Index("IDX_kpi_definition_company", ["company_id"])
export class KpiDefinition {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar", length: 80 })
  code!: string;

  @Column({ type: "varchar", length: 200 })
  name!: string;

  @Column({ type: "text" })
  question!: string;

  @Column({ type: "text", nullable: true })
  help!: string | null;

  @Column({ type: "varchar", length: 30 })
  topic!: string;

  @Column({ type: "varchar", length: 20 })
  pillar!: string;

  @Column({ type: "varchar", length: 20 })
  value_type!: string;

  @Column({ type: "varchar", length: 20, default: "none" })
  unit_dimension!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  canonical_unit!: string | null;

  @Column({ type: "jsonb", default: () => "'[]'" })
  allowed_units!: string[];

  @Column({ type: "varchar", length: 20, default: "sum" })
  aggregation!: string;

  @Column({ type: "varchar", length: 10, default: "site" })
  level!: string;

  @Column({ type: "varchar", length: 10, default: "annual" })
  default_frequency!: string;

  @Column({ type: "varchar", length: 10, default: "manual" })
  source!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  auto_source!: string | null;

  @Column({ type: "text", nullable: true })
  formula!: string | null;

  @Column({ type: "jsonb", nullable: true })
  breakdowns!: Record<string, unknown> | null;

  @Column({ type: "int", default: 2 })
  decimals!: number;

  @Column({ type: "int", nullable: true })
  company_id!: number | null;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({ type: "timestamp", nullable: true })
  edited_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;
}
