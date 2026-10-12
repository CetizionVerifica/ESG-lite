import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from "typeorm";
import { OauthGrant } from "./OauthGrant";

export const OAUTH_TOKEN_KINDS = ["access", "refresh"] as const;
export type OauthTokenKind = (typeof OAUTH_TOKEN_KINDS)[number];

/**
 * Access (1 h) and refresh (30 d sliding) tokens, stored as sha256 hashes
 * only. A refresh token is rotated on use: the old row gets replaced_at and
 * presenting it again revokes the whole grant. See src/oauth/CLAUDE.md.
 */
@Entity({ name: "oauth_token" })
export class OauthToken {
  @PrimaryGeneratedColumn()
  token_id!: number;

  @Index({ unique: true })
  @Column({ type: "varchar", length: 64 })
  token_hash!: string;

  @Column({ type: "varchar", length: 8 })
  kind!: OauthTokenKind;

  @ManyToOne(() => OauthGrant, { onDelete: "CASCADE" })
  @JoinColumn({ name: "grant_id" })
  grant!: OauthGrant;

  @Column({ type: "integer" })
  grant_id!: number;

  @Column({ type: "varchar", length: 200 })
  scopes!: string;

  @Column({ type: "varchar", length: 500 })
  resource!: string;

  @Column({ type: "timestamp" })
  expires_at!: Date;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  revoked_at!: Date | null;

  /** Refresh tokens only: when this token was exchanged for a new one. */
  @Column({ type: "timestamp", nullable: true })
  replaced_at!: Date | null;
}
