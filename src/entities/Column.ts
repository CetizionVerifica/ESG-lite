import { Entity, PrimaryGeneratedColumn, Column, ManyToMany } from "typeorm";
import { ColumnConfig } from "./ColumnConfig";

@Entity()
export class ColumnEntity {
  @PrimaryGeneratedColumn()
  pk_id!: number;

  @Column()
  column_name!: string;

  @Column()
  column_type!: string;

  @ManyToMany(() => ColumnConfig, config => config.columns)
  columnConfigs!: ColumnConfig[];
}
