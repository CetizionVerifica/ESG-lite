import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/**
 * IN-9 · one AI wording call for a page's insight cards (docs/insights/01-contracts.md §5).
 * Ids, the rules worded, the model, tokens, cost and whether it worked; never any text.
 * Written by src/insights/ai/reword.ts only; read by ai/budget.ts (I14).
 */
@Entity("insight_ai_call")
@Index("IDX_insight_ai_call_company_created", ["company_id", "created_at"])
export class InsightAiCall {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int", nullable: true })
  company_id!: number | null;

  @Column({ type: "int", nullable: true })
  user_id!: number | null;

  /** The rule ids of the batch, comma-separated (cut to 40 characters). */
  @Column({ type: "varchar", length: 40, nullable: true })
  card_rule!: string | null;

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

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;
}
