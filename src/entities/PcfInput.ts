import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";
import { PcfStudy } from "./PcfStudy";
import { MaterialFactor } from "./MaterialFactor";
import { EmissionFactor } from "./EmissionFactor";

export type PcfStage = "A1" | "A2" | "A3_packaging" | "A3_waste";

// PCF (E1): one line of a study per declared unit: a BOM line (A1), an
// inbound transport leg (A2), packaging or process waste (A3).
@Entity()
export class PcfInput {
  @PrimaryGeneratedColumn()
  pcf_input_id!: number;

  @Index()
  @ManyToOne(() => PcfStudy, (s) => s.inputs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "pcf_study_id" })
  study!: PcfStudy;

  @Column({ type: "varchar", length: 20 })
  stage!: PcfStage;

  @Column()
  name!: string;

  @Column({ type: "int", default: 0 })
  sort_order!: number;

  // Virgin (or only) factor for A1, packaging and waste lines.
  @ManyToOne(() => MaterialFactor, { nullable: true })
  @JoinColumn({ name: "material_factor_id" })
  material_factor!: MaterialFactor | null;

  // Cut-off recycled factor; used for recycled_share_pct of the quantity.
  @ManyToOne(() => MaterialFactor, { nullable: true })
  @JoinColumn({ name: "recycled_material_factor_id" })
  recycled_material_factor!: MaterialFactor | null;

  // A2 legs reuse the existing DEFRA freight rows (tonne.km).
  @ManyToOne(() => EmissionFactor, { nullable: true })
  @JoinColumn({ name: "emission_factor_id" })
  emission_factor!: EmissionFactor | null;

  // Supplier-specific footprint (kg CO2e per unit) replacing a secondary factor.
  @Column({ type: "decimal", nullable: true })
  supplier_pcf_kgco2e!: string | null;

  // Per declared unit, losses included.
  @Column({ type: "decimal", default: 0 })
  quantity!: string;

  @Column({ type: "varchar", length: 20 })
  unit!: string;

  @Column({ type: "decimal", default: 0 })
  recycled_share_pct!: string;

  @Column({ type: "varchar", nullable: true })
  origin_country!: string | null;

  @Column({ type: "varchar", nullable: true })
  supplier_name!: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  transport_mode!: string | null;

  @Column({ type: "decimal", nullable: true })
  distance_km!: string | null;

  // A2: mass carried per declared unit in tonnes (carried input incl. losses),
  // not the vehicle's capacity.
  @Column({ type: "decimal", nullable: true })
  payload_t!: string | null;

  @Column({ type: "varchar", length: 10, default: "secondary" })
  data_type!: "primary" | "secondary";

  // Data quality 1 (best) to 3 (worst).
  @Column({ type: "smallint", default: 3 })
  dqr_technology!: number;

  @Column({ type: "smallint", default: 3 })
  dqr_geography!: number;

  @Column({ type: "smallint", default: 3 })
  dqr_time!: number;

  @Column({ default: false })
  ai_suggested!: boolean;

  @Column({ type: "decimal", nullable: true })
  ai_confidence!: string | null;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
