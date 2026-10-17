import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Which KPI answers which disclosure, and how well (KPI-2, docs/kpi/01-contracts.md §2).
 * `fit` exact | partial | derived; partial and derived carry a `note` shown in
 * exports. `display_unit` is the framework's unit (BRSR energy in GJ, ESRS in
 * MWh). One row per (disclosure, KPI). `edited_at` as on the other library rows.
 */
@Entity("kpi_disclosure_map")
@Index("UQ_kpi_disclosure_map_disclosure_kpi", ["disclosure_id", "kpi_definition_id"], { unique: true })
@Index("IDX_kpi_disclosure_map_kpi", ["kpi_definition_id"])
export class KpiDisclosureMap {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  disclosure_id!: number;

  @Column({ type: "int" })
  kpi_definition_id!: number;

  @Column({ type: "varchar", length: 10, default: "exact" })
  fit!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  breakdown_key!: string | null;

  @Column({ type: "varchar", length: 40, nullable: true })
  display_unit!: string | null;

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @Column({ type: "timestamp", nullable: true })
  edited_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;
}
