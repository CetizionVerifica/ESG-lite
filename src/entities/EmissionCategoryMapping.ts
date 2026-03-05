import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from "typeorm";

@Entity("emission_category_mapping")
@Unique(["company_id", "site_id", "category_id", "company_category_name"])
export class EmissionCategoryMapping {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  company_id!: number;

  @Column()
  company_name!: string;

  @Column({ nullable: true })
  site_id!: number;

  @Column()
  category_id!: number;

  @Column()
  company_category_name!: string;

  @Column()
  global_category_name!: string;

  @Column({ nullable: true, type: "int" })
  emission_factor_id!: number | null;

  @Column({ nullable: true })
  created_by!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
