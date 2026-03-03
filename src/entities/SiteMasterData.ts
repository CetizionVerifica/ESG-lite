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
export class SiteMasterData {
    @PrimaryGeneratedColumn()
    id!: number;

    @ManyToOne(() => Site, { onDelete: "CASCADE" })
    @JoinColumn({ name: "site_id" })
    site!: Site;

    @ManyToOne(() => MasterData, { onDelete: "CASCADE" })
    @JoinColumn({ name: "master_data_id" })
    masterData!: MasterData;

    @Column({ default: true })
    is_active!: boolean;
}
