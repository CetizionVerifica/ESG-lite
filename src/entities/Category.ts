import {
  Check,
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToMany,
} from "typeorm";
import { Site } from "./Site";
import { Emission } from "./Emission";
import { EmissionFactor } from "./EmissionFactor";
import { ColumnConfig } from "./ColumnConfig";

@Entity()
@Check("CHK_category_ghg_category", `"ghg_category" IS NULL OR ("ghg_category" >= 1 AND "ghg_category" <= 15)`)
export class Category {
  @PrimaryGeneratedColumn()
  category_id!: number;

  @Column()
  category_name!: string;

  @Column({ type: "varchar", nullable: true })
  scope?: string;

  // GHG Protocol Scope 3 category number 1–15 (S3-1). Only on Scope 3
  // categories; null until a Superadmin confirms it (Unmapped).
  @Column({ type: "smallint", nullable: true })
  ghg_category?: number | null;

  @ManyToMany(() => Site, site => site.categories)
  sites!: Site[];

  @OneToMany(() => Emission, emission => emission.category)
  emissions!: Emission[];

  @OneToMany(() => EmissionFactor, ef => ef.category)
  emission_factors!: EmissionFactor[];

  @OneToMany(() => ColumnConfig, cc => cc.category)
  column_configs!: ColumnConfig[];
}