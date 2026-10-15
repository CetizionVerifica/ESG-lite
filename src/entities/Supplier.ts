// S3-6 · A supplier of a company, and the figures it has given.
//
// Created by migrate:scope3-suppliers. A supplier is company-scoped: two
// clients naming the same firm get a row each, and nothing crosses between
// them. Names are compared case-folded, so "Gulf Smelter Co." and "gulf
// smelter co." are one supplier (the unique index is on lower(name)).
//
// The backfill creates these from `emission.extra_data.supplier_name` and from
// supplier_request, and writes name matches to a review list. It never merges
// two spellings on its own (D8).
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany, Index } from "typeorm";
import { Company } from "./Company";
import { User } from "./User";
import { SupplierFactor } from "./SupplierFactor";
import { SupplierFacilityData } from "./SupplierFacilityData";

@Entity("supplier")
// The real index is on (company_id, lower(name)) and is created by
// migrate:scope3-suppliers. TypeORM cannot express a functional index, so it
// is declared here only to be left alone: without synchronize: false the
// schema check asks to drop an index it does not recognise.
@Index("UQ_supplier_company_lower_name", ["company", "name"], { unique: true, synchronize: false })
export class Supplier {
  @PrimaryGeneratedColumn()
  supplier_id!: number;

  @ManyToOne(() => Company, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column()
  name!: string;

  @Column({ type: "varchar", length: 2, nullable: true })
  country!: string | null;

  @Column({ type: "varchar", nullable: true })
  email!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  created_by!: User | null;

  @OneToMany(() => SupplierFactor, (factor) => factor.supplier)
  factors!: SupplierFactor[];

  @OneToMany(() => SupplierFacilityData, (facility) => facility.supplier)
  facility_data!: SupplierFacilityData[];
}
