// S3-6 · One figure a supplier has given for one item: kgCO₂e per unit,
// cradle-to-gate (docs/scope3/01-contracts.md §4).
//
// Created by migrate:scope3-suppliers. Two sources write these: a Manager
// entering one by hand, and accepting a C06 supplier request, which writes a
// supplier_factor beside the PCF MaterialFactor it already wrote and links
// the two (D8). PCF behaviour is unchanged.
//
// A factor whose boundary is not cradle_to_gate is refused with
// SUPPLIER_FACTOR_BOUNDARY unless the caller confirms it, the same pattern
// C06 already uses.
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "./Company";
import { Supplier } from "./Supplier";
import { EmissionDocument } from "./EmissionDocument";
import { MaterialFactor } from "./MaterialFactor";

@Entity("supplier_factor")
export class SupplierFactor {
  @PrimaryGeneratedColumn()
  supplier_factor_id!: number;

  @ManyToOne(() => Company, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => Supplier, (supplier) => supplier.factors, { onDelete: "CASCADE", nullable: false })
  @JoinColumn({ name: "supplier_id" })
  supplier!: Supplier;

  // What the figure is for, in the supplier's own words ("P1020 ingot").
  @Column()
  item!: string;

  @Column({ type: "varchar", length: 20 })
  unit!: string;

  @Column({ type: "numeric", precision: 18, scale: 8 })
  kgco2e_per_unit!: string;

  @Column({ type: "varchar", length: 20, default: "cradle_to_gate" })
  boundary!: string;

  @Column({ type: "smallint" })
  reference_year!: number;

  @Column({ type: "varchar", length: 5, nullable: true })
  gwp_set!: string | null;

  @ManyToOne(() => EmissionDocument, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "evidence_document_id" })
  evidence_document!: EmissionDocument | null;

  // 'supplier_request' (written by a C06 accept) or 'manual'.
  @Column({ type: "varchar", length: 20, default: "manual" })
  source!: "supplier_request" | "manual";

  // The PCF factor the same C06 answer wrote, when it came that way.
  @ManyToOne(() => MaterialFactor, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "material_factor_id" })
  material_factor!: MaterialFactor | null;
}
