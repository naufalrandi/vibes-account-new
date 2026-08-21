import { describe, expect, it } from "vitest";
import { addWorkingDays, isWorkingDay, nextWorkingDay } from "./businessDays";

// Fixture calendar (all Sundays start the week):
//   2026-08-17 Mon  2026-08-18 Tue  2026-08-19 Wed  2026-08-20 Thu
//   2026-08-21 Fri  2026-08-22 Sat  2026-08-23 Sun  2026-08-24 Mon
//   2026-03-18 Wed  2026-03-19 Thu  2026-03-20 Fri  2026-03-21 Sat
//   2026-03-22 Sun  2026-03-23 Mon  2026-03-24 Tue  2026-03-25 Wed  2026-03-26 Thu
//
// ID holidays reused verbatim from OD's seed (`holidaySeedIfNeeded`,
// app.html:29140) / the FE's `HolidaysPage.tsx` SEED_HOLIDAYS: Nyepi
// (2026-03-19, a Thursday), Idul Fitri (2026-03-21, a Saturday) and Idul
// Fitri Holiday (2026-03-22, a Sunday) — the latter two already fall on the
// weekend, which is exactly what the "no double-skip" cases below exercise.

describe("isWorkingDay", () => {
  it("is true for an ordinary weekday with no holidays", () => {
    expect(isWorkingDay("2026-08-19")).toBe(true); // Wednesday
  });

  it("is false for Saturday and Sunday", () => {
    expect(isWorkingDay("2026-08-22")).toBe(false); // Saturday
    expect(isWorkingDay("2026-08-23")).toBe(false); // Sunday
  });

  it("is false for a weekday listed as a holiday", () => {
    expect(isWorkingDay("2026-08-25", [{ date: "2026-08-25" }])).toBe(false); // Tuesday, Maulid
  });

  it("is true for that same weekday when it is not in the holiday list", () => {
    expect(isWorkingDay("2026-08-25", [])).toBe(true);
  });

  it("accepts holidays as plain ISO strings, not just {date} objects", () => {
    expect(isWorkingDay("2026-08-25", ["2026-08-25"])).toBe(false);
  });
});

describe("nextWorkingDay", () => {
  it("returns the same date unchanged when it is already a working day", () => {
    expect(nextWorkingDay("2026-08-19")).toBe("2026-08-19"); // Wednesday
  });

  it("rolls a Saturday forward to the following Monday", () => {
    expect(nextWorkingDay("2026-08-22")).toBe("2026-08-24");
  });

  it("rolls a Sunday forward to the following Monday", () => {
    expect(nextWorkingDay("2026-08-23")).toBe("2026-08-24");
  });

  it("rolls a mid-week holiday forward to the next working day", () => {
    // Tuesday 2026-08-25 (Maulid) -> Wednesday 2026-08-26 (not a holiday).
    expect(nextWorkingDay("2026-08-25", [{ date: "2026-08-25" }])).toBe("2026-08-26");
  });

  it("does not double-skip when a holiday lands on what is already a weekend", () => {
    // Idul Fitri (Sat 2026-03-21) and Idul Fitri Holiday (Sun 2026-03-22) are
    // both weekend days *and* holidays; the roll should still land on the
    // very next Monday, not two Mondays later.
    const holidays = ["2026-03-21", "2026-03-22"];
    expect(nextWorkingDay("2026-03-21", holidays)).toBe("2026-03-23");
    expect(nextWorkingDay("2026-03-21", holidays)).toBe(nextWorkingDay("2026-03-21", []));
  });
});

describe("addWorkingDays", () => {
  it("adds N working days across a weekday-only span", () => {
    // Mon 2026-08-17 + 3 working days -> Tue, Wed, Thu -> 2026-08-20.
    expect(addWorkingDays("2026-08-17", 3, [])).toBe("2026-08-20");
  });

  it("skips a weekend without counting it", () => {
    // Wed 2026-08-19 + 3 working days -> Thu, Fri, (skip Sat/Sun), Mon -> 2026-08-24.
    expect(addWorkingDays("2026-08-19", 3, [])).toBe("2026-08-24");
  });

  it("spans multiple holidays, including one that coincides with the weekend", () => {
    // Wed 2026-03-18 + 5 working days, holidays = Nyepi (Thu 03-19, a weekday
    // holiday) and Idul Fitri / Idul Fitri Holiday (Sat 03-21 + Sun 03-22,
    // already-weekend holidays): Fri(1) Mon(2) Tue(3) Wed(4) Thu(5) -> 2026-03-26.
    const holidays = ["2026-03-19", "2026-03-21", "2026-03-22"];
    expect(addWorkingDays("2026-03-18", 5, holidays)).toBe("2026-03-26");
  });

  it("counts backward for a negative N, landing on a working day", () => {
    // Mon 2026-08-24 - 2 working days -> (skip Sun/Sat), Fri(1), Thu(2) -> 2026-08-20.
    expect(addWorkingDays("2026-08-24", -2, [])).toBe("2026-08-20");
  });

  it("returns the date unchanged for N=0, even if it lands on a weekend (matches OD)", () => {
    // OD's `addBusinessDays` loop never executes for num===0, so it returns
    // the start date untouched rather than rolling it — this intentionally
    // differs from `nextWorkingDay`.
    expect(addWorkingDays("2026-08-22", 0, [])).toBe("2026-08-22");
  });

  it("normalizes a Date input the same way as an ISO string input", () => {
    const asDate = new Date(2026, 7, 17); // August 17, 2026 (local)
    expect(addWorkingDays(asDate, 3, [])).toBe(addWorkingDays("2026-08-17", 3, []));
  });
});
