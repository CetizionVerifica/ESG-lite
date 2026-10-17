import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * A document attached to a KPI value (KPI-4, docs/kpi/01-contracts.md §2), kept
 * in the same storage as emission documents. `public_id` is the stored file's
 * id (null for a link to a document stored elsewhere), so a removal can delete it.
 */
@Entity("kpi_value_evidence")
@Index("IDX_kpi_value_evidence_value", ["kpi_value_id"])
export class KpiValueEvidence {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  kpi_value_id!: number;

  @Column({ type: "text" })
  document_url!: string;

  @Column({ type: "varchar", length: 255 })
  document_name!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  public_id!: string | null;

  @Column({ type: "int", nullable: true })
  uploaded_by!: number | null;

  @Column({ type: "timestamp", default: () => "now()" })
  uploaded_at!: Date;
}
