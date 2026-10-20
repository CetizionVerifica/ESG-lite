import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-13 · an approval request (01-contracts §3 `report_approval`, D14). One
 * Manager reviews; tied to the doc's `rev` (the request's, then the rev the
 * reviewer approved). `state`: requested → approved | changes_requested, or
 * `none` when the requester withdraws it or a newer request replaces it.
 * With `company.report_require_review` on, a final needs an approved request
 * for the rev being finalised.
 */
@Entity("report_approval")
@Index("IDX_report_approval_doc", ["doc_id", "created_at"])
export class StudioReportApproval {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  doc_id!: number;

  @Column({ type: "int" })
  rev!: number;

  @Column({ type: "int" })
  requested_by!: number;

  @Column({ type: "int" })
  reviewer_id!: number;

  @Column({ type: "date", nullable: true })
  due_at!: string | null;

  /** ApprovalState: none | requested | approved | changes_requested. */
  @Column({ type: "varchar", length: 20, default: "requested" })
  state!: string;

  /** The requester's note. */
  @Column({ type: "text", nullable: true })
  note!: string | null;

  /** The reviewer's note (required when changes are requested). */
  @Column({ type: "text", nullable: true })
  decision_note!: string | null;

  @Column({ type: "timestamp", nullable: true })
  decided_at!: Date | null;

  @Column({ type: "int", nullable: true })
  decided_by!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
