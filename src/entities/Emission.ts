import type { Scope3Sub } from "../scope3/contracts/ghgCategory";
import type { EmissionFx } from "../scope3/spend/types";
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
import type { Method } from "../scope3/contracts/ghgCategory";
import type { Dq, DataType } from "../scope3/contracts/dq";
import type { RowChecks } from "../scope3/contracts/checks";
import type { Gas } from "../scope3/contracts/factor";
import type { Proxy } from "../scope3/contracts/schemas";
import { Supplier } from "./Supplier";

export enum EmissionStatus {
  // S3-15 part 2: a contributor's saved, not yet submitted row (company.review_workflow_v2).
  // migrate:scope3-review-workflow adds the value to emission_status_enum.
  DRAFT = "draft",
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

// S3-15: indexes created by migrate:scope3-review-checks (NO_DUPLICATE lookups, FERA partners).
// Declared here so schema sync and schema-diff keep them instead of planning a DROP.
@Index("IDX_emission_site_category_date", ["site", "category", "date_of_reporting", "pk_id"])
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

  @Index("IDX_emission_fera_linked_id")
  @Column({ nullable: true })
  fera_linked_id!: number;

  // S3-7: the Category 3 sub-activity of a FERA twin (3a_upstream_fuels,
  // 3b_upstream_electricity, 3c_td_losses); null on every other row.
  // migrate:scope3-fera-sub adds it and backfills existing twins.
  @Column({ type: "varchar", length: 32, nullable: true })
  scope3_sub!: Scope3Sub | null;

  @Index()
  @Column({ nullable: true })
  upload_batch_id!: string;

  @Column({ type: "jsonb", nullable: true, default: {} })
  extra_data!: Record<string, any>;

  // S3-15 review checks of a pending row ({ready, held}), written only by
  // src/scope3/review/service.ts (raw UPDATE), never by entity saves, so a
  // save of a stale entity can't overwrite a fresher result.
  @Column({ type: "jsonb", nullable: true, insert: false, update: false })
  checks!: RowChecks | null;

  // S3-5 · the exchange rate a spend row used (migrate:scope3-spend):
  // `rate` converts 1 `currency` into the factor's currency `to`, on `as_of`.
  // Stored so the figure can be reproduced in any later year; null on rows
  // that weren't calculated from an amount spent.
  @Column({ type: "jsonb", nullable: true })
  fx!: EmissionFx | null;

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
  // S3-4: the total in kgCO₂e at 4 dp beside total_emission (tCO₂e, 2 dp), so
  // small rows keep their precision (D5). Written by emissionWrite on every
  // insert and edit; older rows backfilled as total_emission × 1000.
  @Column({ type: "numeric", precision: 18, scale: 4, nullable: true })
  total_kgco2e!: string | null;

  // S3-4 (contracts §4): kg of CO2, CH4 and N2O from the factor's gas parts,
  // and kg of biogenic CO₂, at 4 dp. Null when the factor has none (the
  // report shows "Not tracked"); older rows are never backfilled.
  @Column({ type: "jsonb", nullable: true })
  gas_kg!: Partial<Record<Gas, number>> | null;

  @Column({ type: "numeric", precision: 18, scale: 4, nullable: true })
  biogenic_kg!: string | null;

  // S3-12 (contracts §4): how an extrapolated or proxy row was made
  // ({basis, coverage_pct, from}); null on every measured row. Written only by
  // src/scope3/screening (extrapolate, the S3-9 survey backfill) and survey rows on commit.
  @Column({ type: "jsonb", nullable: true })
  proxy!: Proxy | null;
  // S3-6 · which supplier this row's goods came from, when it is known
  // (migrate:scope3-suppliers). Set on Cat 1 and Cat 2 rows entered with a
  // supplier; the supplier-specific and hybrid methods read the supplier's
  // own figures through it.
  @ManyToOne(() => Supplier, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "supplier_id" })
  supplier!: Supplier | null;

  // S3-3 · how the row was calculated and how good its data is
  // (docs/scope3/01-contracts.md §3, migrate:scope3-row-quality). The types
  // come from the S3-0 contracts, never redefined here (00-plan §2.2).
  // Scope 1 and Scope 2 rows carry no method; legacy Scope 3 rows the backfill
  // could not place carry 'average_data'.
  @Column({ type: "varchar", length: 40, nullable: true })
  method!: Method | null;

  @Column({ type: "jsonb", nullable: true })
  dq!: Dq | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  data_type!: DataType | null;

  // For example a distance the route helper worked out rather than one entered.
  @Column({ type: "boolean", default: false })
  is_estimate!: boolean;

  // SE-4 · the version of the data-entry form the row was last calculated with
  // (column_config.version); null on rows saved before SE-4 and on twins.
  @Column({ type: "int", nullable: true })
  form_version!: number | null;
}
