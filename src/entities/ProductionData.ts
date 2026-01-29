import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Product } from "./Product";
import { Site } from "./Site";
import { User } from "./User";

export enum ProductionDataStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

@Entity()
export class ProductionData {
  @PrimaryGeneratedColumn()
  production_id!: number;

  @ManyToOne(() => Product, (product) => product.production_data, { onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product!: Product;

  @ManyToOne(() => Site, (site) => site.production_data, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column("decimal", { precision: 15, scale: 4 })
  quantity!: number;

  @Column()
  unit!: string;

  @Column({ type: "date" })
  start_date!: Date;

  @Column({ type: "date" })
  end_date!: Date;

  @Column({ nullable: true })
  notes!: string;

  @Column({
    type: "enum",
    enum: ProductionDataStatus,
    default: ProductionDataStatus.PENDING,
  })
  status!: ProductionDataStatus;

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
}
