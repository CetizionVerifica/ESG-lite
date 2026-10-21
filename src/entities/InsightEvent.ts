import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * IN-4 · an Insights event: a dated label that explains a jump on the pathway
 * and decoupling charts (docs/insights/01-contracts.md §5). `site_id` null is a
 * company-level event. Written through src/insights/events/crud.ts only.
 */
@Entity("insight_event")
@Index("IDX_insight_event_company_date", ["company_id", "date"])
export class InsightEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int", nullable: true })
  site_id!: number | null;

  @Column({ type: "date" })
  date!: string;

  @Column({ type: "varchar", length: 60 })
  label!: string;

  @Column({ type: "varchar", length: 20 })
  kind!: string;

  @Column({ type: "int" })
  created_by!: number;

  @CreateDateColumn({ type: "timestamptz" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at!: Date;
}
