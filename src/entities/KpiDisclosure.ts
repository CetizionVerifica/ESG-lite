import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * A disclosure (datapoint) of a framework version (KPI-2, docs/kpi/01-contracts.md §2):
 * its code, our own short title (D7, no standard text), section, requirement
 * level and a link to the official source. `verified` is true when the code was
 * checked against that source. `edited_at` is set when a Superadmin changes the
 * row, so a re-seed never overwrites it.
 */
@Entity("kpi_disclosure")
@Index("UQ_kpi_disclosure_framework_code", ["framework_id", "code"], { unique: true })
export class KpiDisclosure {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  framework_id!: number;

  @Column({ type: "varchar", length: 40 })
  code!: string;

  @Column({ type: "varchar", length: 300 })
  title!: string;

  @Column({ type: "varchar", length: 120 })
  section!: string;

  /** required | if_material | voluntary | core */
  @Column({ type: "varchar", length: 20, default: "required" })
  requirement!: string;

  /** E1 … G1 for ESRS topical disclosures, else null */
  @Column({ type: "varchar", length: 4, nullable: true })
  esrs_topic!: string | null;

  @Column({ type: "text" })
  source_url!: string;

  @Column({ type: "int", default: 0 })
  sort_key!: number;

  @Column({ type: "boolean", default: false })
  verified!: boolean;

  @Column({ type: "timestamp", nullable: true })
  edited_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;
}
