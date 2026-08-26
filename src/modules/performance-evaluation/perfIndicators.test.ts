import { describe, expect, it } from "vitest";
import { applyObjectiveOverrides, computePerfIndicatorsBase, perfPct, perfRag, type PerfIndicator, type PerfIndicatorInputs } from "./perfIndicators";

function rec(status: string, data: Record<string, unknown> = {}) {
  return { status, data };
}

function emptyInputs(): PerfIndicatorInputs {
  return {
    processes: [], risks: [], iaFindings: [], nonconformities: [], concerns: [],
    trainingPlans: [], awarenessCampaigns: [], internalDocuments: [], externalDocuments: [], suppliers: [],
  };
}

/** One populated fixture per source collection — checks the real OD arithmetic against this backend's field names. */
function fullInputs(): PerfIndicatorInputs {
  return {
    processes: [
      rec("Active", { steps: [{ targets: "95% on-time" }, { targets: "" }] }),
      rec("Active", { steps: [{ targets: "80% accuracy" }] }),
    ],
    risks: [
      { status: "In Treatment", level: 6 },
      { status: "Monitored", level: 15 }, // controlled AND excluded from "open high/critical" (Monitored)
      { status: "Archived", level: 4 },
      { status: "Unassigned", level: 12 }, // open + high/critical (level >= 10, not Monitored)
      { status: "Pending TM Approval", level: 3 },
    ],
    iaFindings: [
      { issueStatus: "Closed" },
      { issueStatus: "Issued" },
      { issueStatus: "Rejected" },
      { issueStatus: "Draft" },
    ],
    nonconformities: [
      rec("Closed"), rec("Open"), rec("CAP Required"),
    ],
    concerns: [
      rec("Draft"), rec("Submitted"), rec("Under Review"), rec("Routed"), rec("Closed"),
    ],
    trainingPlans: [
      rec("Planned", { overdue: true }),
      rec("Completed", { overdue: false }),
      rec("Cancelled", { overdue: false }),
      rec("Closed", { overdue: false }),
    ],
    awarenessCampaigns: [
      rec("Active", { acks: [{ status: "Acknowledged" }, { status: "Pending" }], evals: [{ result: "Passed" }, { result: "Failed" }] }),
      rec("Active", { acks: [{ status: "Acknowledged" }, { status: "Acknowledged" }], evals: [{ result: "Passed" }] }),
      rec("Active", { acks: [], evals: [] }),
    ],
    internalDocuments: [
      rec("Published", { nextReview: "2020-01-01T00:00:00.000Z" }),
      rec("Published", { nextReview: "2099-01-01T00:00:00.000Z" }),
      rec("Draft", { nextReview: "2020-01-01T00:00:00.000Z" }),
    ],
    externalDocuments: [
      rec("Active", { nextReview: "2020-01-01T00:00:00.000Z" }),
      rec("Active", { nextReview: "2099-01-01T00:00:00.000Z" }),
      rec("Archived", { nextReview: "2020-01-01T00:00:00.000Z" }),
    ],
    suppliers: [
      rec("Approved"), rec("Pending Qualification"), rec("Approved"),
    ],
  };
}

describe("perfPct (OD app.html:11206)", () => {
  it("rounds the percentage and returns null for a zero denominator", () => {
    expect(perfPct(3, 4)).toBe(75);
    expect(perfPct(1, 3)).toBe(33);
    expect(perfPct(0, 0)).toBeNull();
  });
});

describe("perfRag (OD app.html:11207)", () => {
  it("returns 'na' for an unmeasured (null) value", () => {
    expect(perfRag(null, 90, "up")).toBe("na");
  });
  it("bands an 'up' indicator: green >= target, amber >= 85% of target, else red", () => {
    expect(perfRag(90, 90, "up")).toBe("green");
    expect(perfRag(80, 90, "up")).toBe("amber");
    expect(perfRag(70, 90, "up")).toBe("red");
  });
  it("bands a 'down' indicator: green <= target, amber within target + max(1, 15%), else red", () => {
    expect(perfRag(0, 0, "down")).toBe("green");
    expect(perfRag(1, 0, "down")).toBe("amber");
    expect(perfRag(2, 0, "down")).toBe("red");
    expect(perfRag(3, 10, "down")).toBe("green");
    expect(perfRag(11, 10, "down")).toBe("amber");
    expect(perfRag(12, 10, "down")).toBe("red");
  });
});

describe("computePerfIndicatorsBase (OD perfIndicatorsBase, app.html:11208-11236)", () => {
  it("computes all 14 indicators, in OD's exact order/naming/category/target/calc text", () => {
    const result = computePerfIndicatorsBase(fullInputs());
    expect(result).toHaveLength(14);
    expect(result.map((i) => i.name)).toEqual([
      "Process steps with defined KPIs / targets",
      "Risks under active control",
      "Open High / Critical risks",
      "Audit finding closure rate",
      "Open audit findings",
      "Nonconformity closure rate",
      "Concerns pending review",
      "Training completion rate",
      "Overdue training actions",
      "Awareness acknowledgment rate",
      "Awareness evaluation pass rate",
      "Internal documents within review date",
      "External documents current",
      "Approved suppliers",
    ]);
  });

  it("Process steps with defined KPIs / targets: 2 of 3 steps carry a target", () => {
    const [ind] = computePerfIndicatorsBase(fullInputs());
    expect(ind).toMatchObject({
      cat: "Process control (§4.4)", route: "tn-m-processes", src: "Business Processes",
      unit: "%", dir: "up", target: 80, num: 2, den: 3, calc: "Steps with KPIs/targets ÷ all process steps",
      val: 67,
    });
  });

  it("Risk indicators: controlled ratio + open high/critical count (level >= 10, not Monitored)", () => {
    const result = computePerfIndicatorsBase(fullInputs());
    const controlled = result.find((i) => i.name === "Risks under active control")!;
    expect(controlled).toMatchObject({
      cat: "Risk management (§6.1)", route: "tn-m-risk", unit: "%", dir: "up", target: 75,
      num: 3, den: 5, calc: "Risks in treatment/monitored/pending ÷ all risks", val: 60,
    });
    const openHighCritical = result.find((i) => i.name === "Open High / Critical risks")!;
    expect(openHighCritical).toMatchObject({
      unit: "#", dir: "down", target: 0, den: 5, calc: "Risks with level ≥ 10 not yet monitored", val: 1,
    });
  });

  it("Internal audit indicators use `issueStatus`, not OD's dead `status` field", () => {
    const result = computePerfIndicatorsBase(fullInputs());
    const closure = result.find((i) => i.name === "Audit finding closure rate")!;
    expect(closure).toMatchObject({
      cat: "Internal audit (§9.2)", route: "tn-m-audit", unit: "%", dir: "up", target: 85,
      num: 1, den: 4, calc: "Closed findings ÷ all audit findings", val: 25,
    });
    const open = result.find((i) => i.name === "Open audit findings")!;
    expect(open).toMatchObject({ unit: "#", dir: "down", target: 3, den: 4, val: 2 });
  });

  it("Nonconformity closure rate: closed ÷ all NCs", () => {
    const result = computePerfIndicatorsBase(fullInputs());
    const ind = result.find((i) => i.name === "Nonconformity closure rate")!;
    expect(ind).toMatchObject({
      cat: "Improvement (§10)", route: "tn-m-nc", unit: "%", dir: "up", target: 90,
      num: 1, den: 3, calc: "Closed NCs ÷ all nonconformities", val: 33,
    });
  });

  it("Concerns pending review counts Submitted + Under Review (not OD's dead 'Open'/'Pending Review'/'Pending' literals)", () => {
    const result = computePerfIndicatorsBase(fullInputs());
    const ind = result.find((i) => i.name === "Concerns pending review")!;
    expect(ind).toMatchObject({
      cat: "Improvement (§10)", route: "tn-m-concerns", unit: "#", dir: "down", target: 0,
      den: 5, calc: "Concerns open or pending review", val: 2,
    });
  });

  it("Training indicators: completion rate excludes Cancelled from the denominator; overdue reads the decorated flag", () => {
    const result = computePerfIndicatorsBase(fullInputs());
    const completion = result.find((i) => i.name === "Training completion rate")!;
    expect(completion).toMatchObject({
      cat: "Competence & awareness (§7.2 / 7.3)", route: "tn-m-training", unit: "%", dir: "up",
      target: 90, num: 2, den: 3, calc: "Completed plans ÷ active (non-cancelled) plans", val: 67,
    });
    const overdue = result.find((i) => i.name === "Overdue training actions")!;
    expect(overdue).toMatchObject({ unit: "#", dir: "down", target: 0, den: 4, val: 1 });
  });

  it("Awareness indicators: ack rate averages per-campaign rates; eval pass rate pools every campaign's evals", () => {
    const result = computePerfIndicatorsBase(fullInputs());
    const ack = result.find((i) => i.name === "Awareness acknowledgment rate")!;
    // cmp1: 1/2=50%, cmp2: 2/2=100%, cmp3: no acks -> excluded from the average.
    expect(ack).toMatchObject({
      cat: "Competence & awareness (§7.2 / 7.3)", route: "tn-m-awareness", unit: "%", dir: "up",
      target: 95, den: 2, calc: "Average acknowledgment rate across campaigns", val: 75,
    });
    const evalRate = result.find((i) => i.name === "Awareness evaluation pass rate")!;
    expect(evalRate).toMatchObject({
      unit: "%", dir: "up", target: 80, num: 2, den: 3, calc: "Passed evaluations ÷ all evaluations", val: 67,
    });
  });

  it("Documented information indicators: internal docs use cdReviewDue (30-day window, excluded statuses); external docs use edReviewStatus precedence", () => {
    const result = computePerfIndicatorsBase(fullInputs());
    const internal = result.find((i) => i.name === "Internal documents within review date")!;
    expect(internal).toMatchObject({
      cat: "Documented information (§7.5)", route: "tn-m-documents", unit: "%", dir: "up",
      target: 95, num: 2, den: 3, calc: "Docs within review date ÷ all internal docs", val: 67,
    });
    const external = result.find((i) => i.name === "External documents current")!;
    expect(external).toMatchObject({
      route: "tn-m-records", unit: "%", dir: "up", target: 90,
      num: 2, den: 3, calc: "Current docs ÷ all external documents", val: 67,
    });
  });

  it("Approved suppliers: included with a real ratio when suppliers exist", () => {
    const result = computePerfIndicatorsBase(fullInputs());
    const ind = result.find((i) => i.name === "Approved suppliers")!;
    expect(ind).toMatchObject({
      cat: "External providers (§8.4)", route: "tn-m-suppliers", unit: "%", dir: "up", target: 80,
      num: 2, den: 3, calc: "Approved suppliers ÷ all suppliers", val: 67,
    });
  });

  it("Approved suppliers: omitted entirely (not shown as 0 or unmeasured) when there are no suppliers yet", () => {
    const result = computePerfIndicatorsBase({ ...fullInputs(), suppliers: [] });
    expect(result).toHaveLength(13);
    expect(result.find((i) => i.name === "Approved suppliers")).toBeUndefined();
  });
});

describe("unmeasured indicators — a source collection with no data renders as null, never a fabricated number", () => {
  it("every ratio indicator is val: null (and rag 'na') when its source collection is empty", () => {
    const result = computePerfIndicatorsBase(emptyInputs());
    const ratioIndicatorNames = [
      "Process steps with defined KPIs / targets",
      "Risks under active control",
      "Audit finding closure rate",
      "Nonconformity closure rate",
      "Training completion rate",
      "Awareness acknowledgment rate",
      "Awareness evaluation pass rate",
      "Internal documents within review date",
      "External documents current",
    ];
    for (const name of ratioIndicatorNames) {
      const ind = result.find((i) => i.name === name);
      expect(ind, name).toBeDefined();
      expect(ind!.val, name).toBeNull();
      expect(perfRag(ind!.val, ind!.target, ind!.dir), name).toBe("na");
    }
  });

  it("count-based indicators report a real 0, never a fabricated positive number, when their source is empty", () => {
    const result = computePerfIndicatorsBase(emptyInputs());
    for (const name of ["Open High / Critical risks", "Open audit findings", "Concerns pending review", "Overdue training actions"]) {
      const ind = result.find((i) => i.name === name);
      expect(ind!.val, name).toBe(0);
    }
  });

  it("omits 'Approved suppliers' entirely (not a 0-of-0 'unmeasured' row) when there are no suppliers", () => {
    const result = computePerfIndicatorsBase(emptyInputs());
    expect(result.find((i) => i.name === "Approved suppliers")).toBeUndefined();
    expect(result).toHaveLength(13);
  });
});

describe("cdReviewDue / edReviewDue edge cases (no prior server port existed for either)", () => {
  it("internal doc: no nextReview never counts as due, regardless of status", () => {
    const result = computePerfIndicatorsBase({
      ...emptyInputs(),
      internalDocuments: [rec("Published", {})],
    });
    const ind = result.find((i) => i.name === "Internal documents within review date")!;
    expect(ind.val).toBe(100); // not due -> within date
  });

  it("internal doc: excluded status (e.g. Draft) never counts as due even with a past nextReview", () => {
    const result = computePerfIndicatorsBase({
      ...emptyInputs(),
      internalDocuments: [rec("Draft", { nextReview: "2020-01-01T00:00:00.000Z" })],
    });
    const ind = result.find((i) => i.name === "Internal documents within review date")!;
    expect(ind.val).toBe(100);
  });

  it("external doc: 'Under Review' status short-circuits to not-due even with a past nextReview", () => {
    const result = computePerfIndicatorsBase({
      ...emptyInputs(),
      externalDocuments: [rec("Under Review", { nextReview: "2020-01-01T00:00:00.000Z" })],
    });
    const ind = result.find((i) => i.name === "External documents current")!;
    expect(ind.val).toBe(100);
  });
});

describe("applyObjectiveOverrides (OD perfIndicators(), app.html:11209-11211)", () => {
  function ind(name: string, target: number, dir: "up" | "down" = "up"): PerfIndicator {
    return { cat: "c", name, route: "r", src: "s", unit: "%", dir, target, den: 1, denLbl: "x", calc: "c", val: 50 };
  }

  it("overrides target/dir on the indicator whose name matches the objective's source.indicator", () => {
    const result = applyObjectiveOverrides(
      [ind("Training completion rate", 90, "up")],
      [{ id: "OBJ-0001", title: "Raise training completion", source: { kind: "indicator", indicator: "Training completion rate" }, target: 95, dir: "up" }],
    );
    expect(result[0].target).toBe(95);
    expect(result[0].objId).toBe("OBJ-0001");
    expect(result[0].objTitle).toBe("Raise training completion");
  });

  it("leaves indicators with no matching objective untouched", () => {
    const base = ind("Training completion rate", 90, "up");
    const result = applyObjectiveOverrides([base], [{ id: "OBJ-0001", title: "x", source: { kind: "indicator", indicator: "Other indicator" }, target: 10, dir: "down" }]);
    expect(result[0]).toEqual(base);
  });

  it("ignores objectives not linked to an indicator (source.kind !== 'indicator')", () => {
    const base = ind("Training completion rate", 90, "up");
    const result = applyObjectiveOverrides([base], [{ id: "OBJ-0002", title: "Manual objective", source: { kind: "manual" }, target: 10, dir: "down" }]);
    expect(result[0]).toEqual(base);
  });

  it("keeps the base target when the objective's target is null/empty", () => {
    const result = applyObjectiveOverrides(
      [ind("Training completion rate", 90, "up")],
      [{ id: "OBJ-0003", title: "x", source: { kind: "indicator", indicator: "Training completion rate" }, target: null, dir: "down" }],
    );
    expect(result[0].target).toBe(90);
    expect(result[0].dir).toBe("down");
    expect(result[0].objId).toBe("OBJ-0003");
  });
});
