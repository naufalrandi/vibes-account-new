import { describe, it, expect } from "vitest";
import {
  assertReviewCreateStatus,
  assertReviewSchedule,
  assertReviewTransition,
  reviewTransitionStamp,
  mriMax,
  topicsNeedIds,
  withTopicIds,
} from "./reviewLifecycle";
import { MR_TRANSITIONS, MS_MODULES, enrichReviewData } from "./registry";

const topic = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: "Internal audit results", decisionStatus: "No Action Required", itemStatus: "Not Started", action: null, ...over,
});

describe("management review transition graph (registry deep: true)", () => {
  it("declares the graph on the deep reviews module so `deep` is actually read", () => {
    expect(MS_MODULES.reviews.deep).toBe(true);
    expect(MS_MODULES.reviews.transitions).toBe(MR_TRANSITIONS);
  });

  it("allows the OD lifecycle path Draft → Scheduled → In Progress → Completed → Finalized → Archived", () => {
    expect(() => assertReviewTransition("Draft", "Scheduled")).not.toThrow();
    expect(() => assertReviewTransition("Scheduled", "In Progress")).not.toThrow();
    expect(() => assertReviewTransition("In Progress", "Completed")).not.toThrow();
    expect(() => assertReviewTransition("Completed", "Finalized")).not.toThrow();
    expect(() => assertReviewTransition("Finalized", "Archived")).not.toThrow();
  });

  it("allows the auto-promote and Pending Outputs legs", () => {
    expect(() => assertReviewTransition("Draft", "In Progress")).not.toThrow(); // mrRecordSave 11186
    expect(() => assertReviewTransition("In Progress", "Pending Outputs")).not.toThrow();
    expect(() => assertReviewTransition("Pending Outputs", "Completed")).not.toThrow();
  });

  it("allows cancelling any pre-Completed review and archiving anything not archived", () => {
    for (const from of ["Draft", "Scheduled", "In Progress", "Pending Outputs"]) {
      expect(() => assertReviewTransition(from, "Cancelled")).not.toThrow();
    }
    for (const from of ["Draft", "Scheduled", "In Progress", "Pending Outputs", "Completed", "Finalized", "Cancelled"]) {
      expect(() => assertReviewTransition(from, "Archived")).not.toThrow();
    }
  });

  it("rejects illegal jumps with a clear error", () => {
    expect(() => assertReviewTransition("Draft", "Finalized")).toThrowError(/cannot move from "Draft" to "Finalized"/);
    expect(() => assertReviewTransition("Draft", "Completed")).toThrow();
    expect(() => assertReviewTransition("Scheduled", "Finalized")).toThrow();
    expect(() => assertReviewTransition("Completed", "Cancelled")).toThrow();
    expect(() => assertReviewTransition("Finalized", "Draft")).toThrow();
    expect(() => assertReviewTransition("Cancelled", "Scheduled")).toThrow();
  });

  it("treats Archived as terminal and same-status writes as no-ops", () => {
    for (const to of ["Draft", "Scheduled", "In Progress", "Completed", "Finalized", "Cancelled"]) {
      expect(() => assertReviewTransition("Archived", to)).toThrow();
    }
    expect(() => assertReviewTransition("Finalized", "Finalized")).not.toThrow();
  });
});

describe("review create + schedule gates (OD mrSave 11124–11126)", () => {
  it("only lets a review be created Draft or Scheduled", () => {
    expect(() => assertReviewCreateStatus("Draft")).not.toThrow();
    expect(() => assertReviewCreateStatus("Scheduled")).not.toThrow();
    for (const s of ["In Progress", "Pending Outputs", "Completed", "Finalized", "Cancelled", "Archived"]) {
      expect(() => assertReviewCreateStatus(s)).toThrow();
    }
  });

  it("requires a scheduled date and time", () => {
    expect(() => assertReviewSchedule({ date: "2026-06-25", time: "10:00" })).not.toThrow();
    expect(() => assertReviewSchedule({ time: "10:00" })).toThrowError(/date is required/i);
    expect(() => assertReviewSchedule({ date: "2026-06-25", time: "  " })).toThrowError(/time is required/i);
  });
});

describe("transition stamps (OD mrFinalize 10996 / mrCancel 10997)", () => {
  it("stamps finalizedBy/finalizedDate on Finalize", () => {
    const stamp = reviewTransitionStamp("Finalized", {}, {}, "Jennifer Susan Walters", "2026-08-18T00:00:00.000Z");
    expect(stamp).toEqual({ finalizedBy: "Jennifer Susan Walters", finalizedDate: "2026-08-18T00:00:00.000Z" });
  });

  it("demands a typed reason to cancel, then stamps who/when", () => {
    expect(() => reviewTransitionStamp("Cancelled", {}, {}, "A", "now")).toThrowError(/cancellation reason/i);
    const stamp = reviewTransitionStamp("Cancelled", { cancelReason: " Sponsor unavailable " }, {}, "A", "now");
    expect(stamp).toEqual({ cancelReason: "Sponsor unavailable", cancelledBy: "A", cancelledAt: "now" });
  });

  it("carries no stamp on ordinary transitions", () => {
    expect(reviewTransitionStamp("In Progress", {}, {}, "A", "now")).toBeUndefined();
    expect(reviewTransitionStamp("Completed", {}, {}, "A", "now")).toBeUndefined();
  });
});

describe("global per-org MRI sequence (OD db._mriN, 11134)", () => {
  it("finds the max MRI number across every review's topics", () => {
    expect(mriMax([])).toBe(0);
    expect(mriMax([
      { topics: [topic("MRI-0001"), topic("MRI-0009")] },
      { topics: [topic("MRI-0004")] },
      null,
      { topics: "not-an-array" },
    ])).toBe(9);
  });

  it("only numbers topics that still need an id", () => {
    expect(topicsNeedIds({ topics: [topic("MRI-0002")] })).toBe(false);
    expect(topicsNeedIds({ topics: [topic("MRI-0002"), topic("")] })).toBe(true);
    expect(topicsNeedIds({})).toBe(false);
  });

  it("assigns max+1 ids without renumbering existing topics", () => {
    const data = { topics: [topic("MRI-0003"), topic(""), topic("")] };
    const out = withTopicIds(data, 9);
    const ids = (out.topics as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toEqual(["MRI-0003", "MRI-0010", "MRI-0011"]);
    // Immutability: the input object is untouched.
    expect((data.topics[1] as { id: string }).id).toBe("");
  });
});

describe("enrichReviewData (register derived cells)", () => {
  it("derives scheduled, topic count, and open decision/action counts", () => {
    const data = enrichReviewData({
      date: "2026-06-25", time: "10:00",
      topics: [
        topic("MRI-0001", { decisionStatus: "Action Required", action: { status: "Open" } }),
        topic("MRI-0002", { decisionStatus: "Completed", action: { status: "Completed" } }),
        topic("MRI-0003", { decisionStatus: "Deferred", action: null }),
      ],
    });
    expect(data.scheduled).toBe("2026-06-25 · 10:00");
    expect(data.topicsCount).toBe(3);
    expect(data.openDecisions).toBe(2); // Action Required + Deferred
    expect(data.openActions).toBe(1); // only the Open one
  });

  it("renders an empty schedule and zero counts for a bare record", () => {
    const data = enrichReviewData({});
    expect(data.scheduled).toBe("");
    expect(data.topicsCount).toBe(0);
    expect(data.openDecisions).toBe(0);
    expect(data.openActions).toBe(0);
  });
});
