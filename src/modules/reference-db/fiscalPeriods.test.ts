import { describe, expect, it } from "vitest";
import { buildPeriods } from "./referenceDb.service";

describe("buildPeriods — fiscal period generation", () => {
  it("produces 12 monthly periods for a January-start year", () => {
    const p = buildPeriods("2026", 1, "Monthly");
    expect(p).toHaveLength(12);
    expect(p[0]).toMatchObject({ name: "January 2026", start: "2026-01-01", end: "2026-01-31", status: "Open" });
    expect(p[11]).toMatchObject({ name: "December 2026", start: "2026-12-01", end: "2026-12-31" });
  });

  it("rolls a non-January fiscal year into the next calendar year", () => {
    const p = buildPeriods("2026", 4, "Monthly");
    expect(p[0]).toMatchObject({ name: "April 2026", start: "2026-04-01", end: "2026-04-30" });
    expect(p[11]).toMatchObject({ name: "March 2027", start: "2027-03-01", end: "2027-03-31" });
  });

  it("spans quarters correctly, labelling each by the year it starts in", () => {
    expect(buildPeriods("2026", 1, "Quarterly").map((x) => [x.name, x.start, x.end])).toEqual([
      ["Q1 2026", "2026-01-01", "2026-03-31"],
      ["Q2 2026", "2026-04-01", "2026-06-30"],
      ["Q3 2026", "2026-07-01", "2026-09-30"],
      ["Q4 2026", "2026-10-01", "2026-12-31"],
    ]);
    // April-start: the final quarter begins in January, so it carries 2027.
    const apr = buildPeriods("2026", 4, "Quarterly");
    expect(apr.map((x) => x.name)).toEqual(["Q1 2026", "Q2 2026", "Q3 2026", "Q4 2027"]);
    expect(apr[3]).toMatchObject({ start: "2027-01-01", end: "2027-03-31" });
  });

  it("gets month-end lengths right, including February in a leap year", () => {
    expect(buildPeriods("2028", 1, "Monthly")[1].end).toBe("2028-02-29");
    expect(buildPeriods("2027", 1, "Monthly")[1].end).toBe("2027-02-28");
  });

  it("gives every period a unique id and starts them all Open", () => {
    const p = buildPeriods("2026", 7, "Monthly");
    expect(new Set(p.map((x) => x.id)).size).toBe(12);
    expect(p.every((x) => x.status === "Open")).toBe(true);
  });
});
