import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from "typeorm";
import { Site } from "./Site";

@Entity()
export class Company {
  @PrimaryGeneratedColumn()
  company_id!: number;

  @Column()
  name!: string;

  @Column()
  address!: string;

  @Column()
  contact_person!: string;

  @OneToMany(() => Site, site => site.company)
  sites!: Site[];
}