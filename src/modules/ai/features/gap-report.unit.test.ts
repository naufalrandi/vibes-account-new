import { describe, expect, it } from "vitest";
import type { AssessmentDetailView, GapView } from "../../assessments/assessment.service";
import { buildClauses, buildReportPrompt, computeReadiness, mergeReport, severityFor } from "./gap-report.feature";

const detail = {
  elements: [{
    elementId: "el1", elementName: "Internal Audit",
    questions: [
      { id: "q1", text: "Audit programme?", answeredResponseId: "r1", responses: [{ id: "r1", text: "None", score: 0 }, { id: "r2", text: "Full", score: 9 }] },
      { id: "q2", text: "Audit reports?", answeredResponseId: "r4", responses: [{ id: "r3", text: "None", score: 0 }, { id: "r4", text: "Full", score: 9 }] },
      { id: "q3", text: "Unanswered", answeredResponseId: null, responses: [{ id: "r5", text: "x", score: 0 }] },
    ],
  }],
} as unknown as AssessmentDetailView;
const reqs = [{ id: "req1", code: "9.2", subject: "Internal audit" }, { id: "req2", code: "9.3", subject: "Management review" }];
const fwrcs = [
  { id: "f1", requirementId: "req1", questionId: "q1", responseId: "r1", statement: "No audit programme exists." },
  { id: "f2", requirementId: "req2", questionId: "q2", responseId: "r4", statement: "Reviews are held." },
  { id: "f3", requirementId: "req1", questionId: "q3", responseId: "r5", statement: "unanswered" },
];
const gap = { id: "g", assessmentId: "a", elementId: "el1", elementName: "Internal Audit", score: 1, severity: "High", recommendedModuleKey: "internal-audit", recommendedModuleLabel: "Internal Audit", recommendedRoute: "/internal-audit" } as GapView;

describe("gap-report helpers", () => {
  it("computes readiness from maturity and answer coverage", () => {
    expect(computeReadiness(9, 10, 10)).toBe(100);
    expect(computeReadiness(4.5, 5, 10)).toBe(25);
    expect(computeReadiness(null, 0, 10)).toBe(0);
    expect(computeReadiness(5, 3, 0)).toBe(0);
  });

  it("maps scores to severities on the assessment rubric", () => {
    expect([severityFor(0), severityFor(2), severityFor(4.9)]).toEqual(["High", "Medium", "Low"]);
  });

  it("keeps only below-target clauses reached through the chosen response", () => {
    const clauses = buildClauses(detail, fwrcs, reqs, [gap]);
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toMatchObject({ requirementCode: "9.2", severity: "High", score: 0 });
    expect(clauses[0].evidenceSources).toEqual(["q1", "f1"]);
  });

  it("falls back to element gaps when no FWRC mapping exists", () => {
    const clauses = buildClauses(detail, [], [], [gap]);
    expect(clauses).toEqual([expect.objectContaining({ requirementCode: "Internal Audit", severity: "High", evidenceSources: ["q1", "q2"] })]);
  });

  it("puts clauses, cited statements and allowed modules in the prompt", () => {
    const prompt = buildReportPrompt({ title: "T", frameworkName: "ISO 9001", readiness: 40, maturity: 3.6, answered: 2, total: 3, clauses: buildClauses(detail, fwrcs, reqs, []), gaps: [gap] });
    expect(prompt).toContain("Clause 9.2 — Internal audit (severity High");
    expect(prompt).toContain("[f1] No audit programme exists.");
    expect(prompt).toContain("readiness (computed): 40/100");
    expect(prompt).toContain("improvements");
  });

  it("merges model prose onto computed clauses and normalises the roadmap", () => {
    const merged = mergeReport(buildClauses(detail, fwrcs, reqs, []), {
      executiveSummary: " Summary ",
      clauses: [{ requirementCode: "9.2", finding: "F", recommendation: "R" }, { requirementCode: "4.4", finding: "x", recommendation: "y" }],
      roadmap: [{ phase: "90 days", actions: [{ title: " Act ", clauseRefs: ["9.2", "4.4"], ownerRole: "QM", module: "capa" }, { title: " ", clauseRefs: [], ownerRole: "", module: "capa" }] }],
    });
    expect(merged.executiveSummary).toBe("Summary");
    expect(merged.clauses).toEqual([expect.objectContaining({ requirementCode: "9.2", finding: "F", recommendation: "R" })]);
    expect(merged.roadmap.map((p) => p.actions.length)).toEqual([0, 0, 1]);
    expect(merged.roadmap[2].actions[0]).toMatchObject({ title: "Act", clauseRefs: ["9.2"] });
  });
});
