/**
 * Canonical holiday dates the business-days endpoints roll against.
 *
 * `ent-holidays` (Enterprise · Database · Holidays) does not yet have its own
 * backend persistence — its FE page (`HolidaysPage.tsx`) currently seeds the
 * same 2026 calendar as local component state rather than reading it from an
 * API (out of scope for this module; ported from OD's `holidaySeedIfNeeded`,
 * `fe-vibes-new-od/app.html:29133`). Until that module is wired to a
 * real table, this constant is the one canonical, server-side copy of that
 * same seed — every client that calls `/v1/business-days/roll` gets a date
 * rolled against the exact same calendar, which is the property BE-9 exists
 * to guarantee. When `ent-holidays` gains real persistence, swap this
 * constant for a DB read in `resolveHolidays` below; nothing else in this
 * module needs to change.
 */
export const HOLIDAY_DATES_BY_COUNTRY: Record<string, string[]> = {
  ID: [
    "2026-01-01", // New Year
    "2026-02-17", // Chinese New Year
    "2026-03-19", // Nyepi (Day of Silence)
    "2026-03-21", // Idul Fitri
    "2026-03-22", // Idul Fitri Holiday
    "2026-04-03", // Good Friday
    "2026-05-01", // Labour Day
    "2026-05-14", // Ascension Day
    "2026-05-27", // Idul Adha
    "2026-06-01", // Pancasila Day
    "2026-06-16", // Islamic New Year
    "2026-08-17", // Independence Day
    "2026-08-25", // Maulid (Prophet Birthday)
    "2026-12-25", // Christmas
  ],
  US: [
    "2026-01-01",
    "2026-01-19",
    "2026-02-16",
    "2026-05-25",
    "2026-06-19",
    "2026-07-03",
    "2026-09-07",
    "2026-11-11",
    "2026-11-26",
    "2026-12-25",
  ],
  GB: [
    "2026-01-01",
    "2026-04-03",
    "2026-04-06",
    "2026-05-04",
    "2026-05-25",
    "2026-08-31",
    "2026-12-25",
    "2026-12-28",
  ],
};

export const DEFAULT_BUSINESS_DAYS_COUNTRY = "ID";

/** Resolves the working-day calendar for `country`, defaulting to Indonesia — OD's implicit default for every `workingDaysBetween`/`addBusinessDays` call site that doesn't carry its own country field (e.g. `addBusinessDays(idate,30,'ID')`, app.html:30978). */
export function resolveHolidays(country?: string): string[] {
  const code = (country || DEFAULT_BUSINESS_DAYS_COUNTRY).toUpperCase();
  return HOLIDAY_DATES_BY_COUNTRY[code] ?? [];
}
