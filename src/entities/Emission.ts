import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Category } from "./Category";
import { Site } from "./Site";
import { User } from "./User";

export enum EmissionStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

@Entity()
export class Emission {
  @PrimaryGeneratedColumn()
  pk_id!: number;

  @Column("jsonb")
  activity_data: any;

  @Column("decimal")
  total_emission!: number;

  @Column()
  unit!: string;

  @Column({ type: "date" })
  date_of_reporting!: Date;

  @Column({ nullable: true })
  activity_data_unit!: string;

  @Column({
    type: "enum",
    enum: EmissionStatus,
    default: EmissionStatus.PENDING,
  })
  status!: EmissionStatus;

  @Column({ nullable: true })
  review_comment!: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "reviewed_by" })
  reviewed_by!: User;

  @Column({ type: "timestamp", nullable: true })
  reviewed_at!: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "created_by" })
  created_by!: User;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;

  @ManyToOne(() => Category, category => category.emissions, { onDelete: "CASCADE" })
  @JoinColumn({ name: "category_id" })
  category!: Category;

  @ManyToOne(() => Site, site => site.emissions, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  // 'monthly' (default, all pre-existing rows) or 'yearly'. A yearly row's
  // date_of_reporting is the period-end date (Dec 31 for CY, Mar 31 for FY)
  // and covers its whole year — reports must not treat it as one month.
  @Column({ type: "varchar", length: 10, default: "monthly" })
  reporting_period!: "monthly" | "yearly";

  // Only set on yearly rows: 'CY' (Jan-Dec) or 'FY' (Apr-Mar, Indian financial year).
  @Column({ type: "varchar", length: 2, nullable: true })
  year_type!: "CY" | "FY" | null;

  @Column({ nullable: true })
  fera_linked_id!: number;

  @Index()
  @Column({ nullable: true })
  upload_batch_id!: string;

  @Column({ type: "jsonb", nullable: true, default: {} })
  extra_data!: Record<string, any>;

  // Snapshot of the emission factor used at creation time
  // Ensures factor details are always available even if the factor is later deleted/renamed
  @Column({ type: "jsonb", nullable: true })
  emission_factor_snapshot!: {
    emission_factor_id: number;
    emission_category_name: string;
    global_category_name?: string;
    factor_value: number;
    denominator_unit: string;
    source: string;
    year: number;
  } | null;

  // S3-3 · how the row was calculated and how good its data is
  // (docs/scope3/01-contracts.md §3, migrate:scope3-row-quality).
  //
  // `method` is a `Method` key and `dq` a `Dq`, both from
  // src/scope3/contracts/ (S3-0). They are typed structurally until those
  // contracts land, and the types get imported in part 2 of this module.
  // Scope 1 and Scope 2 rows carry no method; legacy Scope 3 rows the backfill
  // could not place carry 'average_data'.
  @Column({ type: "varchar", length: 40, nullable: true })
  method!: string | null;

  @Column({ type: "jsonb", nullable: true })
  dq!: {
    technology: 1 | 2 | 3;
    geography: 1 | 2 | 3;
    time: 1 | 2 | 3;
    completeness: 1 | 2 | 3;
    reliability: 1 | 2 | 3;
    overall: 1 | 2 | 3;
    source: "auto" | "manual";
  } | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  data_type!: "primary" | "secondary" | null;

  // For example a distance the route helper worked out rather than one entered.
  @Column({ type: "boolean", default: false })
  is_estimate!: boolean;
}
