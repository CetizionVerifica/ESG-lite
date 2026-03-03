import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    ManyToOne,
    JoinColumn
} from "typeorm";
import { Site } from "./Site";
import { MasterData } from "./MasterData";

@Entity()
export class SiteUnit {
    @PrimaryGeneratedColumn()
    id!: number;

    @ManyToOne(() => Site, { onDelete: "CASCADE" })
    @JoinColumn({ name: "site_id" })
    site!: Site;

    @ManyToOne(() => MasterData, { onDelete: "CASCADE" })
    @JoinColumn({ name: "master_data_id" })
    masterData!: MasterData;

    // We can store a direct unit string OR link to a Unit entity if preferred.
    // Based on user request "unit_site rhega", storing string is flexible if they don't use strict Unit table.
    // However, MasterData has `uom` (string).
    @Column()
    unit!: string;
}
