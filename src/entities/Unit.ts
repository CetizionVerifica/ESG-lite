import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Site } from "./Site";
import { Category } from "./Category";

@Entity()
export class Unit {
  @PrimaryGeneratedColumn()
  unit_id!: number;

  @Column()
  unit_name!: string;

  @Column({ nullable: true })
  description!: string;

  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @ManyToOne(() => Category, { onDelete: "CASCADE" })
  @JoinColumn({ name: "category_id" })
  category!: Category;
}
