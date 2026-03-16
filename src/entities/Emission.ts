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
}
