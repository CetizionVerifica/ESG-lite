import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-9 · one model call of the studio AI assistant (01-contracts §3
 * `report_ai_call`, as RS). Every call is logged, ok or not, with its tokens
 * and cost; the budget (D10) reads the doc's day and the company's month from
 * here. `doc_id` is null for a call made without a design (design from a brief
 * on the studio home). Never stores prompts, report text or user details.
 */
@Entity("report_ai_call")
@Index("IDX_report_ai_call_doc_created", ["doc_id", "created_at"])
@Index("IDX_report_ai_call_company_created", ["company_id", "created_at"])
export class StudioAiCall {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int", nullable: true })
  doc_id!: number | null;

  @Column({ type: "varchar", length: 40 })
  action!: string;

  @Column({ type: "varchar", length: 120 })
  model!: string;

  @Column({ type: "int", default: 0 })
  tokens_in!: number;

  @Column({ type: "int", default: 0 })
  tokens_out!: number;

  @Column({ type: "numeric", precision: 10, scale: 5, default: 0 })
  cost_usd!: string;

  @Column({ type: "boolean" })
  ok!: boolean;

  @Column({ type: "varchar", length: 40, nullable: true })
  error_code!: string | null;

  @Column({ type: "int", nullable: true })
  user_id!: number | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
