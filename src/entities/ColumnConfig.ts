import { Entity, PrimaryGeneratedColumn, Column, ManyToMany, ManyToOne, JoinColumn, JoinTable } from "typeorm";
import { ColumnEntity as DynamicColumn } from "./Column";
import { Category } from "./Category";
import { Site } from "./Site";

// Interface for dropdown option values
export interface DropdownOptionValue {
  id: string | number;
  label: string;
}

// Maps column_id (as string key) to array of dropdown options
export interface ColumnOptionsMap {
  [columnId: string]: DropdownOptionValue[];
}

// Maps child column name to parent column name
// Example: { "disposal_method": "material" } - disposal_method depends on material
export interface ColumnDependencies {
  [childColumnName: string]: string;
}

// Options for dependent columns based on parent value
// Example: { "disposal_method": { "paper": [{id: "recycled", label: "Recycled"}] } }
export interface DependentOptionsMap {
  [childColumnName: string]: {
    [parentValue: string]: DropdownOptionValue[];
  };
}

// Maps column value combinations to emission_category_name
// Key format: "parentValue|childValue" or "value1|value2|..." for multiple dependencies
// Example: { "paper|recycled": "Paper - Recycled" }
export interface EmissionCategoryMapping {
  [key: string]: string;
}

// Per-method multi-field calculation (see services/calculationSpec.ts).
// When set, the activity value is the PRODUCT of the listed columns instead
// of a single heuristically-found field. Keys of `methods` are the option
// ids of the method dropdown (activity_data stores option ids for selects).
export interface MethodCalculation {
  multiply: string[];      // column names whose values multiply together
  percent?: string[];      // subset of multiply entered as percentages (divided by 100)
  activity_unit?: string;  // unit the product is in (preselects activity_data_unit)
}

export interface CalculationSpec {
  // per_method: a select column picks which fields multiply (Use of Sold Products).
  // per_unit:   the row's activity_data_unit picks them (transport: tonne.km →
  //             Weight × Distance, km → Distance alone). Keys of `methods` are
  //             normalized unit names (lowercase, separators as ".").
  mode: "per_method" | "per_unit";
  method_column?: string;              // per_method only: the select column
  identity_columns?: string[];         // columns added to the duplicate-entry identity
  methods: { [methodKeyOrUnit: string]: MethodCalculation };
  // per_unit only: rows saved BEFORE the spec existed carry only the already
  // multiplied value under this field (and none of the other multiply fields).
  // When the other fields are absent (key missing, not just empty) the legacy
  // field is used as the activity value as-is.
  legacy_field?: string;
}

// Definition for supplementary (extra) fields per category
// These fields don't affect emission calculation — stored separately in emission.extra_data
export interface ExtraFieldDefinition {
  key: string;          // e.g., "equipment", "po_number"
  label: string;        // e.g., "Equipment", "PO Number"
  type: "text" | "number" | "date" | "select" | "textarea";
  required: boolean;
  options?: string[];   // For type="select" only
  show_for?: string[];  // If set, only show when emission_category contains one of these strings
}

@Entity()
export class ColumnConfig {
  @PrimaryGeneratedColumn()
  pk_id!: number;

  @Column()
  config_name!: string;

  @ManyToOne(() => Site, site => site.column_configs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "site_id" })
  site!: Site;

  @ManyToOne(() => Category, category => category.column_configs, { onDelete: "CASCADE" })
  @JoinColumn({ name: "category_id" })
  category!: Category;

  // Site-specific dropdown options for each column
  @Column({ type: "jsonb", nullable: true, default: {} })
  column_options?: ColumnOptionsMap;

  // Defines which columns depend on other columns
  // Example: { "disposal_method": "material" }
  @Column({ type: "jsonb", nullable: true, default: {} })
  column_dependencies?: ColumnDependencies;

  // Options for dependent columns based on parent column value
  // Example: { "disposal_method": { "paper": [{id: "recycled", label: "Recycled"}] } }
  @Column({ type: "jsonb", nullable: true, default: {} })
  dependent_options?: DependentOptionsMap;

  // Maps column value combinations to emission_category_name
  // Example: { "paper|recycled": "Paper - Recycled" }
  @Column({ type: "jsonb", nullable: true, default: {} })
  emission_category_mapping?: EmissionCategoryMapping;

  // Supplementary field definitions for this site+category
  // These define extra form fields that don't affect emission calculation
  @Column({ type: "jsonb", nullable: true, default: [] })
  extra_fields?: ExtraFieldDefinition[];

  // Multi-field calculation spec (null = normal one-value × factor category).
  // Column added by direct SQL, not TypeORM sync — see docs/use-of-sold-products.md.
  @Column({ type: "jsonb", nullable: true })
  calculation?: CalculationSpec | null;

  @ManyToMany(() => DynamicColumn, (column: DynamicColumn) => column.columnConfigs)
  @JoinTable({
    name: "column_config_columns",
    joinColumn: {
      name: "column_config_id",
      referencedColumnName: "pk_id",
    },
    inverseJoinColumn: {
      name: "column_id",
      referencedColumnName: "pk_id",
    },
  })
  columns!: DynamicColumn[];
}
