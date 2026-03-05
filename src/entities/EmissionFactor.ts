import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Unique,
  CreateDateColumn,
} from "typeorm";
import { Site } from "./Site";
import { Category } from "./Category";

@Entity("emission_factors")
@Unique(["site", "category", "year", "emission_category_name"])
export class EmissionFactor {
  @PrimaryGeneratedColumn()
  emission_factor_id!: number;

  @ManyToOne(() => Site, site => site.emission_factors, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @ManyToOne(() => Category, category => category.emission_factors, { onDelete: "CASCADE" })
  @JoinColumn({ name: "category_id" })
  category!: Category;

  @Column()
  year!: number;

  @Column("decimal", { precision: 10, scale: 4 })
  factor_value!: number;

  @Column({ nullable: true })
  denominator_unit!: string;

  @Column({ nullable: true })
  source!: string;

  @Column({ nullable: true })
  emission_category_name!: string;

  @Column({ nullable: true })
  global_category_name!: string;

  @CreateDateColumn()
  created_at!: Date;
}