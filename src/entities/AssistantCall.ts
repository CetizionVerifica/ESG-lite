import { Column, CreateDateColumn, Entity, Index } from "typeorm";
import { PrimaryGeneratedBigintColumn } from "./bigintId";

/**
 * AS-1 · one help assistant model call (docs/assistant/README.md). Who asked,
 * which articles were offered and used, the model, tokens, cost and whether it
 * worked; never the question or the answer. Written by src/assistant/chat.ts
 * only; read by src/assistant/budget.ts.
 */
@Entity("assistant_call")
@Index("IDX_assistant_call_company_created", ["company_id", "created_at"])
@Index("IDX_assistant_call_user_created", ["user_id", "created_at"])
export class AssistantCall {
  @PrimaryGeneratedBigintColumn()
  id!: number;

  /** Null for a Superadmin, who isn't in a client company. */
  @Column({ type: "int", nullable: true })
  company_id!: number | null;

  @Column({ type: "int", nullable: true })
  user_id!: number | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  role!: string | null;

  /** The app path the question was asked on, without its query. */
  @Column({ type: "varchar", length: 200, nullable: true })
  page_path!: string | null;

  /** The article ids offered to the model, comma-separated. */
  @Column({ type: "varchar", length: 300, nullable: true })
  article_ids!: string | null;

  /** The article ids the answer says it used, comma-separated. */
  @Column({ type: "varchar", length: 300, nullable: true })
  sources!: string | null;

  /** False when the articles didn't cover the question. */
  @Column({ type: "boolean", nullable: true })
  answered!: boolean | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  model!: string | null;

  @Column({ type: "int", nullable: true })
  tokens_in!: number | null;

  @Column({ type: "int", nullable: true })
  tokens_out!: number | null;

  @Column({ type: "numeric", precision: 8, scale: 4, nullable: true })
  cost_usd!: string | null;

  @Column({ type: "boolean", nullable: true })
  ok!: boolean | null;

  /** Why a call failed: timeout, http, network, empty, invalid_output. */
  @Column({ type: "varchar", length: 40, nullable: true })
  error_code!: string | null;

  @Column({ type: "int", nullable: true })
  prompt_version!: number | null;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;
}
