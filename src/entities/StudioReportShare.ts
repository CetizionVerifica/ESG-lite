import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-11 · a read-only view link (01-contracts §3 `report_share`, D15). It
 * points at a stored PDF only: a version with a PDF (a final) or a finished
 * proof job. The token is 32 random bytes shown once; only its sha256 is kept.
 * Expiry defaults to 14 days (max 90); a revoked or expired link answers 410.
 */
@Entity("report_share")
@Index("UQ_report_share_token_hash", ["token_hash"], { unique: true })
@Index("IDX_report_share_doc", ["doc_id"])
export class StudioReportShare {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  doc_id!: number;

  @Column({ type: "int", nullable: true })
  version_id!: number | null;

  /** A finished proof job (when the link is to a proof, not a version). */
  @Column({ type: "int", nullable: true })
  job_id!: number | null;

  /** sha256 hex of the token. */
  @Column({ type: "varchar", length: 64 })
  token_hash!: string;

  @Column({ type: "timestamp" })
  expires_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  revoked_at!: Date | null;

  @Column({ type: "int", nullable: true })
  revoked_by!: number | null;

  @Column({ type: "int", nullable: true })
  created_by!: number | null;

  @Column({ type: "int", default: 0 })
  views!: number;

  @Column({ type: "timestamp", nullable: true })
  last_viewed_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
