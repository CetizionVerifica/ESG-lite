import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * DS-13 · the figures a design showed under one data hash (drift, RS-10 §5):
 * `values` maps an element id (or `<elementId>#<n>` for the n-th chip in a
 * text) to its display string. Written when drift or the checks resolve a
 * doc; read to show "before" values when the hash has moved. Pruned with
 * the doc's autosaves (kept 90 days).
 */
@Entity("report_data_baseline")
@Index("UQ_report_data_baseline_doc_hash", ["doc_id", "data_hash"], { unique: true })
export class StudioDataBaseline {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  doc_id!: number;

  @Column({ type: "varchar", length: 80 })
  data_hash!: string;

  @Column({ type: "jsonb", default: () => "'{}'" })
  values!: Record<string, string>;

  @CreateDateColumn()
  created_at!: Date;
}
