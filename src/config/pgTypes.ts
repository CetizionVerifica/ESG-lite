// #191 · node-postgres returns bigint (int8, OID 20) and bigint[] (OID 1016) as
// strings by default, so a widened id would reach the code and the JSON
// responses as "5" instead of 5. count(*), sum() of an integer column and
// row_number() are bigint too. These parsers make them JS numbers.
//
// Number is exact up to 2^53 - 1 (9,007,199,254,740,991). A value beyond that
// is returned as the exact string rather than silently rounded.
//
// data-source.ts installs them before the DataSource is created; every process
// that talks to the database (the API, workers, migrate:* scripts) loads it.
type PgTypes = {
  setTypeParser(oid: number, parse: (value: string) => unknown): void;
  getTypeParser(oid: number): (value: string) => unknown;
};

export const PG_INT8_OID = 20;
export const PG_INT8_ARRAY_OID = 1016;

export function parseBigint(value: string | null): number | string | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : value;
}

type Nested = string | null | Nested[];
type ParsedNested = number | string | null | ParsedNested[];

const mapNested = (v: Nested): ParsedNested => (Array.isArray(v) ? v.map(mapNested) : parseBigint(v));

/** Wraps pg's own int8[] parser (strings, nulls, nested arrays) and converts each entry. */
export function bigintArrayParser(base: (value: string) => unknown) {
  return (value: string | null): ParsedNested => {
    if (value === null) return null;
    const parsed = base(value) as Nested;
    return parsed === null ? null : mapNested(parsed);
  };
}

const installed = new WeakSet<PgTypes>();

export function installPgTypeParsers(types: PgTypes = (require("pg") as { types: PgTypes }).types): void {
  if (installed.has(types)) return;
  const baseArray = types.getTypeParser(PG_INT8_ARRAY_OID);
  types.setTypeParser(PG_INT8_OID, (v) => parseBigint(v));
  types.setTypeParser(PG_INT8_ARRAY_OID, bigintArrayParser(baseArray) as (value: string) => unknown);
  installed.add(types);
}
