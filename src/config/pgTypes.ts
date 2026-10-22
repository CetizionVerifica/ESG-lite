// pg ships no type declarations (and @types/pg isn't installed); only its type registry is used here.
const { types } = require("pg") as {
  types: {
    builtins: { INT8: number };
    getTypeParser(oid: number, format?: "text"): (value: string) => unknown;
    setTypeParser(oid: number, parse: (value: string) => unknown): void;
  };
};

/** int8[] (bigint[]), e.g. pcf_result.emission_ids_used once ids are bigint. Not in `types.builtins`. */
export const INT8_ARRAY_OID = 1016;

/**
 * #191: node-postgres returns `bigint` (int8, OID 20) as a string by default, so a widened id
 * or an uncast `count(*)` / `SUM(int)` would reach the code and the API as "42". Read them as
 * numbers instead. `Number` is exact up to 2^53 (9,007,199,254,740,991), far above any id or count.
 */
export const parseBigint = (value: string | null): number | null => (value === null ? null : Number(value));

const toNumbers = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(toNumbers) : typeof value === "string" ? Number(value) : value;

/** Registers the parsers on pg's shared type registry; call before any connection is made. */
export function registerPgTypeParsers(): void {
  types.setTypeParser(types.builtins.INT8, parseBigint);
  // Arrays of bigint: pg's own parser splits them into strings; keep its parsing, convert each element.
  const parseArray = types.getTypeParser(INT8_ARRAY_OID, "text");
  if ((parseArray as { bigintNumbers?: boolean }).bigintNumbers) return;
  const parseNumberArray = Object.assign((value: string) => toNumbers(parseArray(value)), { bigintNumbers: true });
  types.setTypeParser(INT8_ARRAY_OID, parseNumberArray);
}
