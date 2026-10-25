import { Generated, PrimaryColumn, ValueTransformer } from "typeorm";
import { parseBigint } from "../config/pgTypes";

// #191 · bigint primary keys. The int8 parser (config/pgTypes.ts) makes find()
// and raw queries return them as numbers, but TypeORM writes a generated bigint
// id back from save() as a string (its fix for TypeORM issue #720 runs String()
// on it). This transformer turns it back, so entity.id after save() is the same
// JS number find() returns, and a JSON response never carries "123".
export const bigintId: ValueTransformer = {
  to: (value: unknown) => value,
  from: (value: unknown) => (typeof value === "string" ? parseBigint(value) : value),
};

/**
 * A bigint primary key filled by a sequence (BIGSERIAL), read and written as a
 * JS number. Every new table's id uses this (ESG-lite CLAUDE.md), not
 * `@PrimaryGeneratedColumn()`, which is integer. Columns that store the id are
 * `@Column({ type: "bigint" })`; a relation's join column follows by itself.
 */
export function PrimaryGeneratedBigintColumn(): PropertyDecorator {
  return (target, propertyName) => {
    PrimaryColumn({ type: "bigint", transformer: bigintId })(target, propertyName);
    Generated("increment")(target, propertyName);
  };
}
