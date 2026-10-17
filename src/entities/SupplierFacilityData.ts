// S3-6 · What a supplier's facility emitted in a year and how much it made,
// so the hybrid method can allocate a share of it to what we bought
// (docs/scope3/01-contracts.md §4).
//
// Created by migrate:scope3-suppliers. Used by emissionWrite/methods/hybrid.ts:
// scope12_tco2e × (purchased_qty / output_qty), by mass unless
// allocation_key says economic — the same allocation PCF already does, which
// S3-6 extracts to src/scope3/suppliers/allocate.ts without moving any PCF
// result.
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "./Company";
import { Supplier } from "./Supplier";

@Entity("supplier_facility_data")
export class SupplierFacilityData {
  @PrimaryGeneratedColumn()
  supplier_facility_data_id!: number;

  @ManyToOne(() => Company, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => Supplier, (supplier) => supplier.facility_data, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "supplier_id" })
  supplier!: Supplier;

  @Column({ type: "smallint" })
  year!: number;

  // The supplier's own Scope 1 + 2 for the facility, as it reported them.
  @Column({ type: "numeric", precision: 18, scale: 4 })
  scope12_tco2e!: string;

  @Column({ type: "numeric", precision: 18, scale: 4 })
  output_qty!: string;

  @Column({ type: "varchar", length: 20 })
  output_unit!: string;

  // 'mass' (the default) or 'economic'.
  @Column({ type: "varchar", length: 20, default: "mass" })
  allocation_key!: "mass" | "economic";
}
