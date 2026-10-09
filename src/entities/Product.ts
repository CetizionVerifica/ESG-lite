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

  // PCF (E1): what one footprint is expressed per, e.g. 1 kg or 1 km.
  @Column({ type: "varchar", length: 20, nullable: true })
  declared_unit!: string | null;

  @Column({ type: "decimal", nullable: true })
  declared_unit_qty!: string | null;

  @Column({ type: "decimal", nullable: true })
  mass_per_unit_kg!: string | null;

  @Column({ type: "varchar", nullable: true })
  pcr_tag!: string | null;

  @OneToMany(() => ProductionData, (pd) => pd.product)
  production_data!: ProductionData[];

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
