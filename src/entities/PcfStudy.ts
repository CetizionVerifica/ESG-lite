import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import { Company } from "./Company";
import { Product } from "./Product";
import { Site } from "./Site";
import { User } from "./User";
import { PcfInput } from "./PcfInput";
import { PcfAllocation } from "./PcfAllocation";

export type PcfStudyStatus = "draft" | "in_review" | "approved" | "published" | "superseded";
export type PcfAllocationKey = "mass" | "machine_hours" | "energy" | "economic" | "manual";

// PCF (E1): one footprint study of one product at its producing site for a
// reference period. Versioned: a new version copies the previous one and
// points to it through parent_version; published results are never
// recalculated in place. A PCF result is never a CBAM figure.
@Entity()
export class PcfStudy {
  @PrimaryGeneratedColumn()
  pcf_study_id!: number;

  @Index()
  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Index()
  @ManyToOne(() => Product, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product!: Product;

  // Producing plant whose approved Scope 1+2 is allocated to A3.
  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column({ type: "date" })
  reference_start!: string;

  @Column({ type: "date" })
  reference_end!: string;

  @Column({ type: "varchar", length: 2, default: "CY" })
  year_type!: "CY" | "FY";

  @Column({ type: "varchar", length: 20, default: "cradle_to_gate" })
  boundary!: "cradle_to_gate" | "cradle_to_grave";

  @Column({ type: "varchar", length: 20, default: "iso14067" })
  standard!: string;

  @Column({ type: "varchar", nullable: true })
  pcr_tag!: string | null;

  @Column({ type: "varchar", length: 20, default: "mass" })
  allocation_key!: PcfAllocationKey;

  // Lines below this % of the total are cut-off candidates (method note §2.9).
  @Column({ type: "decimal", default: 1 })
  cut_off_rule_pct!: string;

  @Column({ type: "int", default: 1 })
  version!: number;

  @ManyToOne(() => PcfStudy, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "parent_version_id" })
  parent_version!: PcfStudy | null;

  @Index()
  @Column({ type: "varchar", length: 20, default: "draft" })
  status!: PcfStudyStatus;

  // Set when an approved Emission or ProductionData row this study used changes.
  @Column({ default: false })
  stale!: boolean;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "created_by" })
  created_by!: User | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "reviewed_by" })
  reviewed_by!: User | null;

  @Column({ type: "timestamp", nullable: true })
  reviewed_at!: Date | null;

  @Column({ type: "text", nullable: true })
  review_comment!: string | null;

  @OneToMany(() => PcfInput, (i) => i.study)
  inputs!: PcfInput[];

  @OneToMany(() => PcfAllocation, (a) => a.study)
  allocations!: PcfAllocation[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
