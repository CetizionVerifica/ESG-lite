import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinColumn,
  JoinTable,
} from "typeorm";
import { Company } from "./Company";
import { Country } from "./Country";
import { Category } from "./Category";
import { User } from "./User";
import { Emission } from "./Emission";
import { EmissionFactor } from "./EmissionFactor";
import { ColumnConfig } from "./ColumnConfig";
import { Product } from "./Product";
import { ProductionData } from "./ProductionData";

@Entity()
export class Site {
  @PrimaryGeneratedColumn()
  site_id!: number;

  @Column()
  name!: string;

  @Column()
  address!: string;

  @Column()
  contact_person!: string;

  @ManyToOne(() => Company, company => company.sites)
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => Country, country => country.sites)
  @JoinColumn({ name: "country_id" })
  country!: Country;

  @ManyToMany(() => Category, category => category.sites)
  @JoinTable({
    name: "site_categories",
    joinColumn: {
      name: "site_id",
      referencedColumnName: "site_id",
    },
    inverseJoinColumn: {
      name: "category_id",
      referencedColumnName: "category_id",
    },
  })
  categories!: Category[];

  // Regular users assigned to this site
  @OneToMany(() => User, (user) => user.site)
  users!: User[];

  // Managers who can manage this site (many-to-many)
  @ManyToMany(() => User, (user) => user.sites)
  managers!: User[];

  @OneToMany(() => Emission, (emission) => emission.site)
  emissions!: Emission[];

  @OneToMany(() => EmissionFactor, ef => ef.site)
  emission_factors!: EmissionFactor[];

  @OneToMany(() => ColumnConfig, cc => cc.site)
  column_configs!: ColumnConfig[];

  @OneToMany(() => Product, (product) => product.site)
  products!: Product[];

  @OneToMany(() => ProductionData, (pd) => pd.site)
  production_data!: ProductionData[];
}