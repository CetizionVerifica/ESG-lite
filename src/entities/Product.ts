import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Site } from "./Site";
import { ProductionData } from "./ProductionData";

@Entity()
export class Product {
  @PrimaryGeneratedColumn()
  product_id!: number;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string;

  @Column()
  unit!: string; // Default unit of measurement for production (e.g., "tonnes", "units", "kWh")

  @ManyToOne(() => Site, (site) => site.products, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @OneToMany(() => ProductionData, (pd) => pd.product)
  production_data!: ProductionData[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
