import { Entity, PrimaryGeneratedColumn, Column, Index, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Unique } from "typeorm";
import { Company } from "./Company";
import { Site } from "./Site";
import { Category } from "./Category";
import { User } from "./User";

// Mapping memory for the smart Excel import (XI3, docs/excel-import/
// modules/XI3-mapping-memory/CLAUDE.md, contracts §3). One row is one confirmed
// sheet mapping of ONE company for one header fingerprint, site and category:
// the next upload of the same layout maps itself. Written only when a plan
// that carried a confirmed MappingProposal commits; read only through the
// caller's writer context, so nothing learned from one client is ever served
// to another. Created by migrate:mapping-profiles.

@Entity({ name: "import_mapping_profile" })
@Unique(["company_id", "fingerprint", "site_id", "category_id"])
export class ImportMappingProfile {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column()
  company_id!: number;

  // Site-wise imports: always set. Goes with the site.
  @ManyToOne(() => Site, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @Column()
  site_id!: number;

  // NULL when the sheet takes its category from a column.
  @ManyToOne(() => Category, { onDelete: "CASCADE", nullable: true })
  @JoinColumn({ name: "category_id" })
  category!: Category | null;

  @Column({ type: "integer", nullable: true })
  category_id!: number | null;

  // sha256 hex of the normalised header names (contracts §1).
  @Index()
  @Column({ type: "varchar", length: 64 })
  fingerprint!: string;

  // A SheetProposal (src/imports/mapping.ts) without activities[].save_mapping:
  // only the mapping, never row values beyond the distinct texts it names.
  @Column({ type: "jsonb" })
  sheet_proposal!: any;

  // Kept when the user is deleted (SET NULL): the mapping stays the company's.
  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "confirmed_by" })
  confirmer!: User | null;

  @Column({ type: "integer", nullable: true })
  confirmed_by!: number | null;

  @Column({ type: "timestamp", nullable: true })
  confirmed_at!: Date | null;

  @Column({ type: "integer", default: 0 })
  uses!: number;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
