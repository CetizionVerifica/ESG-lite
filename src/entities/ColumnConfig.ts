import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, ManyToOne, JoinColumn, JoinTable } from "typeorm";
import { ColumnEntity as DynamicColumn } from "./Column";
import { Category } from "./Category";
import { Site } from "./Site";

@Entity()
export class ColumnConfig {
  @PrimaryGeneratedColumn()
  pk_id!: number;

  @Column()
  config_name!: string;

  @ManyToOne(() => Site, site => site.column_configs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @ManyToOne(() => Category, category => category.column_configs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "category_id" })
  category!: Category;

  @ManyToMany(() => DynamicColumn, (column: DynamicColumn) => column.columnConfigs)
  @JoinTable({
    name: "column_config_columns",
    joinColumn: {
      name: "column_config_id",
      referencedColumnName: "pk_id",
    },
    inverseJoinColumn: {
      name: "column_id",
      referencedColumnName: "pk_id",
    },
  })
  columns!: DynamicColumn[];
}
