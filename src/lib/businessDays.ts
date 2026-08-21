/**
 * Business-day engine (BE-9) — server-side working-day arithmetic shared by
 * every module whose dates must not differ between clients (Enterprise ·
 * Payroll Calendar cut-off/pay dates today; Purchase Requests' SLA/lead-time
 * fields later). Computing this in the browser would let two clients (or two
 * app versions) disagree on the same inputs; centralizing it here means the
 * value that gets persisted is always computed once, by the server.
 *
 * Ported from OD's holiday calendar + business-day engine
 * (`fe-vibes-new-od/app.html:29118-29129`): `CAL_WEEKEND` (weekend = Saturday
 * + Sunday), `isWorkday`, and `addBusinessDays`. OD's engine is exclusively
 * forward-walking — `addBusinessDays` increments the date one day at a time
 * (or decrements, for a negative count) until it has passed N working days,
 * so the date it lands on is always itself a working day; OD has no separate
 * "round an already-fixed date to the nearest working day" helper.
 * `nextWorkingDay` below generalizes that same forward-only convention to
 * that case — roll forward to the next working day on/after the input, never
 * backward — since forward-only is the only directionality OD's engine ever
 * exhibits (also matches OD's one real caller of this shape, PO invoice due
 * dates via `addBusinessDays(idate, 30, 'ID')`, app.html:30978/32049, which is
 * always used to push a date later, never earlier).
 *
 * Deliberately holiday-source-agnostic: every function takes the holiday
 * list as a plain parameter (ISO `YYYY-MM-DD` date strings, or objects with a
 * `date` field) instead of reading from a database — no I/O, no dependency on
 * where a given caller's holiday calendar lives.
 */

/** OD `CAL_WEEKEND=[0,6]` (app.html:29119) — Sunday and Saturday. */
const WEEKEND_DAYS = new Set([0, 6]);

export type HolidayLike = string | { date: string };

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Parses a `YYYY-MM-DD` string (or Date) into a local-midnight `Date`.
 * Deliberately avoids `new Date(isoString)`, which the JS spec parses as
 * UTC midnight for a date-only ISO string — that shifts by a day in any
 * negative-UTC-offset timezone. Building the `Date` from its y/m/d parts
 * keeps this function's result identical regardless of the host timezone.
 */
function parseIsoDate(value: Date | string): Date {
  if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const [y, m, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, day || 1);
}

function holidaySet(holidays: readonly HolidayLike[]): Set<string> {
  const set = new Set<string>();
  for (const h of holidays) set.add((typeof h === "string" ? h : h.date).slice(0, 10));
  return set;
}

/**
 * True when `date` is neither a weekend day nor listed in `holidays`.
 * OD `isWorkday` (app.html:29127).
 */
export function isWorkingDay(date: Date | string, holidays: readonly HolidayLike[] = []): boolean {
  const d = parseIsoDate(date);
  if (WEEKEND_DAYS.has(d.getDay())) return false;
  return !holidaySet(holidays).has(toIsoDate(d));
}

/**
 * The next working day on/after `date` — returns `date` (normalized to
 * `YYYY-MM-DD`) unchanged when it is already a working day. Rolls forward
 * only; see the module doc comment for why (no OD precedent for backward
 * rounding).
 */
export function nextWorkingDay(date: Date | string, holidays: readonly HolidayLike[] = []): string {
  const set = holidaySet(holidays);
  const d = parseIsoDate(date);
  while (WEEKEND_DAYS.has(d.getDay()) || set.has(toIsoDate(d))) {
    d.setDate(d.getDate() + 1);
  }
  return toIsoDate(d);
}

/**
 * Adds `n` working days to `date`. OD `addBusinessDays` (app.html:29129):
 * walks one calendar day at a time, only counting days that are themselves
 * working days (so weekends and holidays are skipped without being counted,
 * and a holiday that happens to fall on a weekend is not double-skipped — it
 * is still just one non-working day). `n` may be negative to count backward;
 * whichever direction, the returned date is always itself a working day.
 *
 * `n === 0` returns `date` unchanged (normalized), matching OD exactly: its
 * `while(added<num)` loop never executes when `num` is `0`, so OD returns
 * the untouched start date even if that date is a weekend/holiday. This is
 * intentionally *not* the same as `nextWorkingDay(date, holidays)` — callers
 * that want "roll onto a working day" should call `nextWorkingDay` directly.
 */
export function addWorkingDays(date: Date | string, n: number, holidays: readonly HolidayLike[] = []): string {
  const d = parseIsoDate(date);
  if (n === 0) return toIsoDate(d);
  const set = holidaySet(holidays);
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    if (!WEEKEND_DAYS.has(d.getDay()) && !set.has(toIsoDate(d))) remaining -= 1;
  }
  return toIsoDate(d);
}
