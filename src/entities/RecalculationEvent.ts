import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * A base-year recalculation (S3-14): proposed by the nightly check, then
 * approved (the base year is re-frozen as a new version) or dismissed (the
 * old snapshot stays). Never edits emission rows.
 */
@Entity("recalculation_event")
@Index("IDX_recalculation_event_company", ["company_id", "status"])
export class RecalculationEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  @Column({ type: "varchar", length: 20, default: "Scope 3" })
  scope!: string;

  /** methodology | data_quality | structural | error */
  @Column({ type: "varchar", length: 20 })
  reason!: string;

  /** proposed | approved | dismissed */
  @Column({ type: "varchar", length: 20, default: "proposed" })
  status!: string;

  @Column({ type: "jsonb", default: () => "'[]'" })
  affected_years!: number[];

  @Column("decimal", { precision: 18, scale: 4, default: 0 })
  delta_tco2e!: string;

  @Column({ type: "text", nullable: true })
  note!: string | null;

  @Column({ type: "jsonb", nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  after!: Record<string, unknown> | null;

  /** The listed changes behind the proposal and its signature. */
  @Column({ type: "jsonb", nullable: true })
  details!: Record<string, unknown> | null;

  @Column({ type: "int", nullable: true })
  approved_by!: number | null;

  @Column({ type: "timestamp", nullable: true })
  decided_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
