import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { Company } from "./Company";

// PCF (E1): kg CO2e per unit of a material, packaging, waste route or
// transport service, used by PcfInput lines. company = null is the global
// library every company sees; otherwise the factor belongs to that company.
// Licence 'ecoinvent' values must never be shown raw to clients (C04).
@Entity()
export class MaterialFactor {
  @PrimaryGeneratedColumn()
  material_factor_id!: number;

  @ManyToOne(() => Company, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company | null;

  @Column()
  name!: string;

  // aluminium, copper, polymer, steel, packaging, chemical, energy, transport, waste
  @Column({ type: "varchar", length: 30 })
  material_group!: string;

  @Column({ type: "varchar", nullable: true })
  geography!: string | null;

  // kg, t, m2, kWh, tonne.km, unit
  @Column({ type: "varchar", length: 20 })
  unit!: string;

  // Full precision (numeric without scale); the pg driver returns a string.
  @Column({ type: "decimal" })
  value_kgco2e!: string;

  @Column({ type: "varchar", length: 5, default: "AR6" })
  gwp_set!: "AR6" | "AR5";

  @Column({ type: "varchar", nullable: true })
  source!: string | null;

  @Column({ type: "int", nullable: true })
  source_year!: number | null;

  @Column({ type: "varchar", nullable: true })
  dataset_ref!: string | null;

  @Column({ type: "varchar", length: 20, default: "open" })
  licence!: "open" | "ecoinvent" | "supplier";

  // true = the recycled (cut-off) variant of a material, carrying only
  // collection and reprocessing.
  @Column({ default: false })
  recycled_variant!: boolean;

  @Column({ type: "date", nullable: true })
  valid_from!: string | null;

  @Column({ type: "date", nullable: true })
  valid_to!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
