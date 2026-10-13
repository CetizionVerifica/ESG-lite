import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import { Company } from "./Company";
import { PcfStudy } from "./PcfStudy";
import { PcfInput } from "./PcfInput";
import { MaterialFactor } from "./MaterialFactor";
import { User } from "./User";

// Stored transitions; "expired" is derived from token_expires_at when nothing
// was received, so it is never written.
export type SupplierRequestStatus = "sent" | "opened" | "received" | "accepted" | "rejected";

// PCF phase 3 (C06): a request to a supplier for the footprint of one input
// line. The supplier answers through a tokenised link (no account): a PCF/EPD
// file, a PACT JSON, or typed values. The token is stored hashed, like OAuth
// tokens. On accept, the figure becomes a company MaterialFactor with licence
// 'supplier' and, while the study is a draft, the input's supplier figure.
@Entity()
export class SupplierRequest {
  @PrimaryGeneratedColumn()
  supplier_request_id!: number;

  @Index()
  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Index()
  @ManyToOne(() => PcfStudy, { onDelete: "CASCADE" })
  @JoinColumn({ name: "pcf_study_id" })
  study!: PcfStudy;

  // The line the figure is for; SET NULL when the builder replaces the lines.
  @ManyToOne(() => PcfInput, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "pcf_input_id" })
  input!: PcfInput | null;

  // Snapshot of the line at request time, so the row stays readable.
  @Column()
  material!: string;

  // kg, t, m2, kWh, tonne.km, unit: the unit the figure is wanted per.
  @Column({ type: "varchar", length: 20 })
  unit!: string;

  @Column({ type: "varchar", nullable: true })
  supplier_name!: string | null;

  @Column()
  supplier_email!: string;

  @Column({ type: "date", nullable: true })
  due_date!: string | null;

  // The manager's own words in the message, kept so a resend says the same.
  @Column({ type: "text", nullable: true })
  note!: string | null;

  // The exact email the manager approved, as sent (or sunk, see
  // services/supplierRequestMail.ts).
  @Column()
  subject!: string;

  @Column({ type: "text" })
  message!: string;

  @Index()
  @Column({ type: "varchar", length: 20, default: "sent" })
  status!: SupplierRequestStatus;

  // SHA-256 of the link token; the token itself is shown once, on create or resend.
  @Index({ unique: true })
  @Column({ type: "varchar", length: 64 })
  token_hash!: string;

  @Column({ type: "timestamp" })
  token_expires_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  sent_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  opened_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  received_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  decided_at!: Date | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "requested_by" })
  requested_by!: User | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "decided_by" })
  decided_by!: User | null;

  @Column({ type: "text", nullable: true })
  decision_comment!: string | null;

  // ---- what the supplier sent (typed values and/or a file) ----
  @Column({ type: "decimal", nullable: true })
  reply_value_kgco2e!: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  reply_unit!: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  reply_boundary!: string | null;

  @Column({ type: "varchar", nullable: true })
  reply_standard!: string | null;

  @Column({ type: "varchar", length: 5, nullable: true })
  reply_gwp_set!: string | null;

  @Column({ type: "date", nullable: true })
  reply_reference_start!: string | null;

  @Column({ type: "date", nullable: true })
  reply_reference_end!: string | null;

  @Column({ type: "date", nullable: true })
  reply_valid_from!: string | null;

  @Column({ type: "date", nullable: true })
  reply_valid_to!: string | null;

  @Column({ type: "varchar", nullable: true })
  reply_verifier!: string | null;

  @Column({ type: "varchar", nullable: true })
  reply_product_name!: string | null;

  @Column({ type: "text", nullable: true })
  reply_note!: string | null;

  @Column({ type: "varchar", nullable: true })
  reply_file_name!: string | null;

  @Column({ type: "varchar", nullable: true })
  reply_file_type!: string | null;

  @Column({ type: "int", nullable: true })
  reply_file_size!: number | null;

  // The uploaded declaration itself (≤ 10 MB); loaded only by the download route.
  @Column({ type: "bytea", nullable: true, select: false })
  reply_file!: Buffer | null;

  // ---- what the manager accepted ----
  @ManyToOne(() => MaterialFactor, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "material_factor_id" })
  material_factor!: MaterialFactor | null;

  @Column({ type: "decimal", nullable: true })
  accepted_value_kgco2e!: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  accepted_boundary!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
