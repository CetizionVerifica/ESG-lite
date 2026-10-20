import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * Light materiality per ESRS topic (KPI-3, D13): material yes/no, with a reason
 * when not material. It filters the `if_material` ESRS datapoints. One row per
 * (company, topic).
 */
@Entity("company_material_topic")
@Index("UQ_company_material_topic_company_topic", ["company_id", "esrs_topic"], { unique: true })
export class CompanyMaterialTopic {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  /** E1 … G1 */
  @Column({ type: "varchar", length: 4 })
  esrs_topic!: string;

  @Column({ type: "boolean" })
  material!: boolean;

  @Column({ type: "text", nullable: true })
  reason!: string | null;

  @Column({ type: "int", nullable: true })
  decided_by!: number | null;

  @Column({ type: "timestamp", default: () => "now()" })
  decided_at!: Date;

  // DS-2 (RS-2 R9): scores 0–10 for the report's materiality matrix; null = not scored.
  // migrate:ds-2-materiality-scores adds them on existing databases.
  @Column({ type: "numeric", precision: 3, scale: 1, nullable: true })
  impact_score!: string | null;

  @Column({ type: "numeric", precision: 3, scale: 1, nullable: true })
  financial_score!: string | null;
}
