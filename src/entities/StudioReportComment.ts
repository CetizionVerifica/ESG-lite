import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * DS-13 · a comment on a design (01-contracts §3 `report_comment`: RS-10 +
 * mentions, task). Anchored to a page, optionally an element and a pin
 * (`x`, `y` in page mm). Threads by `parent_id` (one level: replies point at
 * the thread's first comment). A comment becomes a task with an assignee;
 * `task_done_at` ticks it. Resolving the thread's root hides its pin.
 * `deleted_at` keeps a removed comment out of every list (replies stay).
 */
@Entity("report_comment")
@Index("IDX_report_comment_doc", ["doc_id", "created_at"])
@Index("IDX_report_comment_task", ["task_assignee_id"])
export class StudioReportComment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "int" })
  doc_id!: number;

  @Column({ type: "varchar", length: 120 })
  page_id!: string;

  @Column({ type: "varchar", length: 120, nullable: true })
  element_id!: string | null;

  /** The pin, in page mm (null = on the element or the page). */
  @Column({ type: "real", nullable: true })
  x!: number | null;

  @Column({ type: "real", nullable: true })
  y!: number | null;

  @Column({ type: "int", nullable: true })
  parent_id!: number | null;

  @Column({ type: "text" })
  body!: string;

  @Column({ type: "int" })
  author_id!: number;

  /** Users notified by @mention (only people with access to the design). */
  @Column({ type: "int", array: true, default: () => "'{}'" })
  mentions!: number[];

  @Column({ type: "int", nullable: true })
  task_assignee_id!: number | null;

  @Column({ type: "timestamp", nullable: true })
  task_done_at!: Date | null;

  @Column({ type: "int", nullable: true })
  task_done_by!: number | null;

  @Column({ type: "int", nullable: true })
  resolved_by!: number | null;

  @Column({ type: "timestamp", nullable: true })
  resolved_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  deleted_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
