import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { Site } from "./Site";

@Entity()
export class Country {
  @PrimaryGeneratedColumn()
  country_id!: number;

  @Column({ unique: true })
  name!: string;

  @Column({ unique: true })
  code!: string;

  @OneToMany(() => Site, site => site.country)
  sites!: Site[];
}