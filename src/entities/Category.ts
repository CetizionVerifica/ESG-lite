import {
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
export class Category {
  @PrimaryGeneratedColumn()
  category_id!: number;

  @Column()
  category_name!: string;

  @Column({ type: "varchar", nullable: true })
  scope?: string;

  @ManyToMany(() => Site, site => site.categories)
  sites!: Site[];

  @OneToMany(() => Emission, emission => emission.category)
  emissions!: Emission[];

  @OneToMany(() => EmissionFactor, ef => ef.category)
  emission_factors!: EmissionFactor[];

  @OneToMany(() => ColumnConfig, cc => cc.category)
  column_configs!: ColumnConfig[];
}