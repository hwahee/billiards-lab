/**
 * Time facade.
 *
 * Policy: the server stores and processes ALL timestamps in UTC — as
 * `UtcIsoString` in application code and as `timestamptz` in Postgres.
 * Time-zone conversion happens only at the boundary: the client formats
 * UTC values into the viewer's local time zone via `formatUtcInTimeZone`.
 */

/** Branded ISO-8601 UTC timestamp, e.g. `"2026-07-02T04:00:00.000Z"`. */
export type UtcIsoString = string & { readonly __brand: 'UtcIsoString' };

/** Current instant as a UTC ISO string. */
export function nowUtc(): UtcIsoString {
  return new Date().toISOString() as UtcIsoString;
}

/** Converts any `Date` to a UTC ISO string. */
export function toUtcIso(date: Date): UtcIsoString {
  return date.toISOString() as UtcIsoString;
}

/**
 * Parses a UTC ISO string back into a `Date`.
 * Throws on values that are not valid ISO timestamps.
 */
export function parseUtcIso(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Not a valid ISO timestamp: ${JSON.stringify(value)}`);
  }
  return date;
}

/**
 * Boundary conversion: formats a UTC timestamp in the given IANA time zone
 * for display. This is the ONLY sanctioned way to leave UTC.
 *
 * @param timeZone IANA zone, e.g. `"Asia/Seoul"`. Defaults to the runtime's zone
 *                 (on the client: the viewer's browser zone).
 */
export function formatUtcInTimeZone(
  value: UtcIsoString,
  options: { timeZone?: string; locale?: string } = {},
): string {
  return formatterFor(options.locale, options.timeZone).format(parseUtcIso(value));
}

/**
 * One formatter per locale + zone. Building an `Intl.DateTimeFormat` costs
 * tens of times more than using one, and a list formats a timestamp for every
 * row it draws.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(locale: string | undefined, timeZone: string | undefined) {
  const key = `${locale ?? ''}|${timeZone ?? ''}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}
