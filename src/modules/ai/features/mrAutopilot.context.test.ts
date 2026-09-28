import { describe, expect, it } from "vitest";
import {
  TOPIC_SOURCES, attachActions, buildInputsPrompt, citedSources, indicatorDigest, previousActionsDigest,
  registerDigest, reviewPeriod,
} from "./mrAutopilot.context";

const period = { from: "2026-01-01", to: "2026-06-30", prevFrom: "2025-07-05" };

describe("mr-autopilot context", () => {
  it("covers all 25 ISO 9.3 topics", () => {
    expect(Object.keys(TOPIC_SOURCES)).toHaveLength(25);
  });

  it("reviewPeriod runs from the previous review (else 12 months) with an equal previous period", () => {
    expect(reviewPeriod("2026-06-30", ["2026-01-01", "2025-06-01", "2027-01-01"])).toEqual({ from: "2026-01-01", to: "2026-06-30", prevFrom: "2025-07-05" });
    expect(reviewPeriod("2026-06-30", []).from).toBe("2025-06-30");
  });

  it("registerDigest counts by status and compares periods, citing the register and records", () => {
    const d = registerDigest("nonconformities", [
      { code: "NC-1", title: "Late calibration", status: "Open", createdAt: "2026-02-01T00:00:00Z", data: { severity: "Major" } },
      { code: "NC-2", title: "Missing record", status: "Closed", createdAt: "2026-03-01T00:00:00Z", data: {} },
      { code: "NC-3", title: "Old one", status: "Closed", createdAt: "2025-09-01T00:00:00Z", data: {} },
    ], period);
    expect(d.facts[0]).toContain("[register:nonconformities] Nonconformities: 3 records in total; by status: Open 1, Closed 2");
    expect(d.facts[0]).toContain("New in review period (2026-01-01 to 2026-06-30): 2; in previous period (2025-07-05 to 2026-01-01): 1");
    expect(d.facts[1]).toBe("[NC-2] Missing record — status: Closed");
    expect(d.facts[2]).toContain("severity: Major");
    expect(d.sources.map((s) => s.id)).toEqual(["register:nonconformities", "NC-2", "NC-1", "NC-3"]);
  });

  it("registerDigest averages CSAT scores per period", () => {
    const d = registerDigest("customer-satisfaction", [
      { code: "C-1", title: "a", status: "New", createdAt: "2026-02-01", data: { score: 4 } },
      { code: "C-2", title: "b", status: "New", createdAt: "2026-02-02", data: { score: 5 } },
    ], period);
    expect(d.facts[1]).toContain("Average score in review period: 4.50; previous period: n/a");
  });

  it("indicatorDigest never renders an unmeasured indicator as 0", () => {
    const d = indicatorDigest([{ name: "Open NCs", val: null, unit: "#", target: 0, dir: "down", cat: "Improvement" }]);
    expect(d.facts[0]).toBe("[PI-1] Improvement — Open NCs: not measured (no data); target ≤ 0");
  });

  it("previousActionsDigest lists open actions of earlier reviews only", () => {
    const reviews = [
      { id: "cur", code: "MR-0003", status: "Scheduled", data: { date: "2026-06-30", topics: [{ id: "MRI-0009", title: "X", action: { title: "Now", status: "Open" } }] } },
      { id: "old", code: "MR-0001", status: "Finalized", data: { date: "2026-01-01", topics: [
        { id: "MRI-0001", title: "Policy", action: { title: "Update policy", owner: "Ana", due: "2026-03-01", status: "Open" } },
        { id: "MRI-0002", title: "Risk", action: { title: "Done thing", status: "Completed" } },
        { id: "MRI-0003", title: "None", action: null },
      ] } },
    ];
    const d = previousActionsDigest(reviews, "cur", "2026-06-30");
    expect(d.facts[0]).toContain("2 in total; by status: Open 1, Completed 1; still open: 1");
    expect(d.facts[1]).toBe("[MR-0001/MRI-0001] Update policy — owner: Ana — due: 2026-03-01 — Open");
  });

  it("citedSources keeps only provided ids, falling back to register-level sources", () => {
    const provided = [{ id: "register:risks", label: "Risks" }, { id: "R-1", label: "R-1" }];
    expect(citedSources(provided, ["R-1", "made-up"])).toEqual([{ id: "R-1", label: "R-1" }]);
    expect(citedSources(provided, [])).toEqual([{ id: "register:risks", label: "Risks" }]);
  });

  it("buildInputsPrompt tags each topic with its key", () => {
    const text = buildInputsPrompt([{ topicKey: "MRI-0001", title: "Risk and opportunity status", facts: ["[register:risks] Risks: 2"], sources: [] }], period);
    expect(text).toContain("### topicKey: MRI-0001\nTopic: Risk and opportunity status\n[register:risks] Risks: 2");
  });

  it("attachActions sets topic.action like Record Outputs and rejects conflicts", () => {
    const topics = [
      { id: "MRI-0001", title: "Policy suitability", action: null },
      { id: "MRI-0002", title: "Resource adequacy", action: { title: "Hire", status: "Open" } },
    ];
    const ok = attachActions(topics, [{ topicKey: "Policy suitability", action: "Revise policy", ownerName: "Budi", due: "2026-08-01" }]);
    expect(ok.errors).toEqual([]);
    expect(ok.topics[0]).toMatchObject({
      action: { title: "Revise policy", owner: "Budi", due: "2026-08-01", priority: "Medium", status: "Open", desc: "" },
      responsible: "Budi", due: "2026-08-01",
    });
    expect(ok.topics[1]).toBe(topics[1]);
    const bad = attachActions(topics, [
      { topicKey: "MRI-0002", action: "x" },
      { topicKey: "nope", action: "y" },
      { topicKey: "MRI-0001", action: "a" },
      { topicKey: "MRI-0001", action: "b" },
    ]);
    expect(bad.errors).toEqual([
      "\"Resource adequacy\" already has a follow-up action",
      "Unknown topic \"nope\"",
      "More than one action selected for \"Policy suitability\"",
    ]);
  });
});
