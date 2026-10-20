import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * DS-5 · a stored version of a design (01-contracts §3 `report_doc_version`:
 * the RS columns, with `kind` `autosave` allowed). DS-5 writes the rows
 * (rev 1 after a build, autosaves every 10 minutes of editing, D16); DS-11
 * fills the PDF fields of proofs and finals; DS-13 lists and restores them.
 *
 * Retention (D16): autosaves older than 90 days and outside the newest 200 are
 * pruned; snapshots, review versions and finals are never pruned.
 */
@Entity("report_doc_version")
@Index("UQ_report_doc_version_doc_n", ["doc_id", "n"], { unique: true })
export class StudioReportDocVersion {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  doc_id!: number;

  @Column({ type: "int" })
  n!: number;

  /** snapshot | review | final | autosave (VersionKind). */
  @Column({ type: "varchar", length: 20 })
  kind!: string;

  /** The draft's rev the version was taken from. */
  @Column({ type: "int", nullable: true })
  rev!: number | null;

  @Column({ type: "jsonb" })
  doc!: Record<string, unknown>;

  /** Resolved values (finals only, RS R18). */
  @Column({ type: "jsonb", nullable: true })
  data_snapshot!: Record<string, unknown> | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  data_hash!: string | null;

  /** The template version the doc was built with. */
  @Column({ type: "int", nullable: true })
  design_version!: number | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  renderer_hash!: string | null;

  @Column({ type: "varchar", length: 300, nullable: true })
  pdf_r2_key!: string | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  pdf_sha256!: string | null;

  @Column({ type: "int", nullable: true })
  page_count!: number | null;

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @Column({ type: "int", nullable: true })
  created_by!: number | null;

  @CreateDateColumn()
  created_at!: Date;
}
