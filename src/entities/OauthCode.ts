import { Entity, PrimaryColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from "typeorm";
import { OauthGrant } from "./OauthGrant";

/**
 * A one-time authorization code (60 s). Stored hashed; the PKCE challenge,
 * redirect_uri and resource it was issued for are checked at the token
 * endpoint. See src/oauth/CLAUDE.md.
 */
@Entity({ name: "oauth_code" })
export class OauthCode {
  @PrimaryColumn({ type: "varchar", length: 64 })
  code_hash!: string;

  @ManyToOne(() => OauthGrant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "grant_id" })
  grant!: OauthGrant;

  @Column({ type: "integer" })
  grant_id!: number;

  @Column({ type: "varchar", length: 64 })
  client_id!: string;

  @Column({ type: "varchar", length: 2000 })
  redirect_uri!: string;

  @Column({ type: "varchar", length: 128 })
  code_challenge!: string;

  @Column({ type: "varchar", length: 500 })
  resource!: string;

  @Column({ type: "varchar", length: 200 })
  scopes!: string;

  @Column({ type: "timestamp" })
  expires_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  used_at!: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
