import { Column, Entity, Index, PrimaryColumn } from "typeorm";

/**
 * A planned My KPIs template upload, kept between the two steps of
 * `POST /kpi/my/template` (plan, then commit by `plan_id`) for 24 h. In the
 * database rather than in process, so a restart or a second API instance
 * between the steps still finds it. Only the ready rows' items are kept; a
 * commit deletes the plan and runs every draft rule again.
 */
@Entity("kpi_template_plan")
@Index("IDX_kpi_template_plan_created_at", ["created_at"])
export class KpiTemplatePlan {
  @PrimaryColumn({ type: "uuid" })
  id!: string;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  user_id!: number;

  /** [{row, item}]: the template row number and the draft it saves */
  @Column({ type: "jsonb" })
  ready!: Array<{ row: number; item: Record<string, unknown> }>;

  @Column({ type: "timestamp", default: () => "now()" })
  created_at!: Date;
}
