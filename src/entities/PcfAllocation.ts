import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from "typeorm";
import { PcfStudy } from "./PcfStudy";
import { Category } from "./Category";

// PCF (E1): one site energy source (approved Scope 1 or 2 category) allocated
// to the study's product for its reference period; written on calculate.
@Entity()
export class PcfAllocation {
  @PrimaryGeneratedColumn()
  pcf_allocation_id!: number;

  @Index()
  @ManyToOne(() => PcfStudy, (s) => s.allocations, { onDelete: "CASCADE" })
  @JoinColumn({ name: "pcf_study_id" })
  study!: PcfStudy;

  @ManyToOne(() => Category, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "category_id" })
  category!: Category | null;

  // Kept so the allocation still reads after a category is renamed or removed.
  @Column()
  category_name!: string;

  @Column({ type: "int" })
  scope!: number;

  @Column({ type: "decimal" })
  period_total_tco2e!: string;

  @Column({ type: "decimal" })
  key_value_product!: string;

  @Column({ type: "decimal" })
  key_value_site_total!: string;

  @Column({ type: "decimal" })
  share_pct!: string;

  @Column({ type: "decimal" })
  allocated_kg_per_unit!: string;

  @CreateDateColumn()
  created_at!: Date;
}
