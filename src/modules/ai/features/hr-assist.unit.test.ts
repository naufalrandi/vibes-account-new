import { describe, expect, it } from "vitest";
import { candidateProfessionalProfile, contractClauseLines, missingClauses, redactAmounts } from "./hr-assist.context";

describe("hr-assist context", () => {
  it("redactAmounts hides money figures and PII", () => {
    const out = redactAmounts("Salary Rp 12.500.000 per month, bonus IDR 5,000,000 or 3 juta rupiah; mail hr@x.co. Probation 3 months.");
    expect(out).not.toMatch(/12\.500|5,000|hr@x/);
    expect(out).toContain("[amount]");
    expect(out).toContain("Probation 3 months");
  });

  it("candidateProfessionalProfile keeps professional fields only", () => {
    const profile = candidateProfessionalProfile({
      entity: "candidate", email: "a@b.co", phone: "08123456789", rating: 5, notes: "Religion: X",
      offer: { amount: "10000000" }, contract: { type: "PKWT" },
      education: [{ level: "Bachelor", field: "CS", institution: "UI", year: "2019" }],
      experience: [{ title: "QA", org: "Acme", from: "2019", to: "2024" }],
      interviews: [{ type: "HR", date: "2026-01-01", interviewer: "Budi", outcome: "Pass", note: "Expects Rp 15.000.000" }],
      tests: [{ name: "Auditing L1", scorePct: 80, result: "Pass" }],
    });
    const text = JSON.stringify(profile);
    expect(Object.keys(profile)).toEqual(["education", "experience", "interviews", "tests"]);
    expect(text).not.toMatch(/a@b|0812|Religion|10000000|PKWT|Budi|15\.000/);
    expect(text).toContain("80%");
  });

  it("contractClauseLines skips excluded clauses and numbers the rest", () => {
    const lines = contractClauseLines([
      { title: "Pay", category: "Remuneration", body: "Rp 9.000.000 monthly", include: true },
      { title: "Old", body: "x", include: false },
      { title: "Notice", body: "30 days" },
    ]);
    expect(lines).toEqual([
      { id: "1", text: "Pay (Remuneration): [amount] monthly" },
      { id: "2", text: "Notice: 30 days" },
    ]);
  });

  it("missingClauses keeps checklist keys only, in checklist order", () => {
    expect(missingClauses(["termination", "made-up", "Probation"]).map((c) => c.key)).toEqual(["probation", "termination"]);
  });
});
