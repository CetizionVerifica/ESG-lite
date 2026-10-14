import {
  Entity,
  PrimaryGeneratedColumn,
  PrimaryColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from "typeorm";
import { Company } from "./Company";
import { User } from "./User";

// Import plans (IM2, docs/mcp-import/backend/IM2-import-plans-api/CLAUDE.md).
// A plan is a stored, re-checkable set of rows sent by Claude (MCP), the Bulk
// upload page or the API; committing it writes one pending upload batch. The
// plan tables never hold a total that a client sent: every result row is what
// the EmissionWriter computed. Created by migrate:import-plans.

export type ImportPlanStatus = "draft" | "committed" | "cancelled" | "expired";
export type ImportPlanChannel = "mcp" | "bulk_upload" | "api";

@Entity({ name: "import_plan" })
export class ImportPlan {
  @PrimaryGeneratedColumn("uuid")
  plan_id!: string;

  @Index()
  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column()
  company_id!: number;

  @Index()
  // Kept when the user is deleted (SET NULL): the plan's source_name is the
  // audit trail for where a batch came from, and must outlive the account.
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "created_by" })
  creator!: User | null;

  @Column({ type: "integer", nullable: true })
  created_by!: number | null;

  @Column({ type: "varchar", length: 20 })
  channel!: ImportPlanChannel;

  @Column({ type: "varchar", length: 200 })
  source_name!: string;

  @Index()
  @Column({ type: "varchar", length: 20, default: "draft" })
  status!: ImportPlanStatus;

  @Column({ type: "integer", default: 1 })
  version!: number;

  @Column({ type: "jsonb", default: {} })
  counts!: any;

  @Column({ type: "jsonb", default: {} })
  totals!: any;

  @Column({ type: "jsonb", default: [] })
  issues_summary!: any;

  @Column({ type: "varchar", nullable: true })
  upload_batch_id!: string | null;

  @Column({ type: "varchar", length: 200, nullable: true, unique: true })
  idempotency_key!: string | null;

  @Column({ type: "jsonb", nullable: true })
  committed!: { upload_batch_id: string; inserted: number; fera_inserted: number; committed_at: string } | null;

  // Smart import (XI0): the confirmed MappingProposal the rows were made
  // from, for bulk_upload plans; XI3 learns a mapping profile from it on
  // commit. NULL for plans from Claude or the API.
  @Column({ type: "jsonb", nullable: true })
  mapping!: any;

  @Column({ type: "timestamp" })
  expires_at!: Date;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}

@Entity({ name: "import_plan_row" })
@Unique(["plan_id", "row_ref"])
export class ImportPlanRow {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @ManyToOne(() => ImportPlan, { onDelete: "CASCADE" })
  @JoinColumn({ name: "plan_id" })
  plan!: ImportPlan;

  @Column({ type: "uuid" })
  plan_id!: string;

  @Column({ type: "varchar", length: 200 })
  row_ref!: string;

  @Column({ type: "integer" })
  position!: number;

  @Column({ type: "jsonb" })
  input!: any;

  @Column({ type: "varchar", length: 10, default: "issue" })
  state!: "ready" | "issue" | "skipped";

  @Column({ type: "jsonb", default: [] })
  issues!: any;

  @Column({ type: "jsonb", nullable: true })
  result!: any;
}

@Entity({ name: "import_plan_match" })
@Unique(["plan_id", "site_id", "category_id", "sheet_name"])
export class ImportPlanMatch {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @ManyToOne(() => ImportPlan, { onDelete: "CASCADE" })
  @JoinColumn({ name: "plan_id" })
  plan!: ImportPlan;

  @Column({ type: "uuid" })
  plan_id!: string;

  @Column({ type: "integer" })
  site_id!: number;

  @Column({ type: "integer" })
  category_id!: number;

  @Column({ type: "varchar", length: 300 })
  sheet_name!: string;

  @Column({ type: "varchar", length: 300 })
  factor_name!: string;
}
