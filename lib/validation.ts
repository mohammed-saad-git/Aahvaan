/**
 * Shared input validation used by both surfaces.
 *
 * Kept in a neutral module so neither the patient nor the staff code has to
 * import from the other.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Guards route params and server-action inputs BEFORE any query, so malformed
 * input never reaches Postgres and produces a raw database error.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
