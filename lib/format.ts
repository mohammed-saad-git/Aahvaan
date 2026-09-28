/**
 * Small shared formatters used by both the patient and staff surfaces.
 *
 * Kept in one neutral module so neither surface has to import from the other.
 */

/** Token label, e.g. `#009`. Fixed width so layouts never jump. */
export function formatTokenNumber(tokenNumber: number): string {
  const safe = Number.isFinite(tokenNumber)
    ? Math.max(0, Math.trunc(tokenNumber))
    : 0;

  return `#${String(safe).padStart(3, "0")}`;
}

/** Compact duration: `4 min`, `59 min`, `1 h 5 min`, `2 h`. Null-safe. */
export function formatMinutes(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) {
    return null;
  }

  const whole = Math.round(minutes);

  if (whole < 60) {
    return `${whole} min`;
  }

  const hours = Math.floor(whole / 60);
  const rest = whole % 60;

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
