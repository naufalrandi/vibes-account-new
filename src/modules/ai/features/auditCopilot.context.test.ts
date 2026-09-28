import { describe, expect, it } from "vitest";
import { clauseBlock, keepKnownClauses, processBlock, reportContext } from "./auditCopilot.context";

const reqs = [
  { id: "r1", code: "9.2.1", subject: "Internal audit", description: "The organization shall conduct internal audits." },
  { id: "r2", code: "8.4", subject: "Control of external providers", description: "Ensure externally provided processes conform." },
];

describe("audit-copilot context", () => {
  it("clauseBlock cites clauses by code with up to 3 FWRC statements", () => {
    const text = clauseBlock(reqs, new Map([["r1", ["a", "b", "c", "d"]]]));
    expect(text).toContain("[9.2.1] Internal audit. The organization shall conduct internal audits. Criteria statements: a | b | c");
    expect(text).not.toContain("| d");
    expect(text).toContain("[8.4] Control of external providers.");
    expect(clauseBlock([], new Map())).toBe("Clauses: none selected on this session.");
  });

  it("keepKnownClauses drops invented clause refs", () => {
    expect(keepKnownClauses(["9.2.1", "7.5", "9.2.1"], reqs)).toEqual(["9.2.1"]);
  });

  it("processBlock includes only present fields", () => {
    const text = processBlock({ code: "BP-1", title: "Purchasing", data: { owner: "Ana", kpis: [], steps: null } });
    expect(text).toContain("[BP-1] Process: Purchasing");
    expect(text).toContain('owner: "Ana"');
    expect(text).not.toContain("steps");
    expect(processBlock(undefined)).toMatch(/not found/);
  });

  it("reportContext lists the programme's real sessions and findings with counts, redacting PII", () => {
    const text = reportContext(
      { code: "IAP-0001", name: "2026 programme", period: "2026", scope: null, objective: null },
      [{ code: "IAS-0001", title: "Purchasing audit", process: "Purchasing", status: "Completed", date: "2026-03-01" }],
      [{ code: "IAF-0001", title: "No supplier eval", type: "Nonconformity", issueStatus: "Issued", process: "Purchasing", description: "Contact ana@x.test" }],
    );
    expect(text).toContain("Sessions (1):\n[IAS-0001] Purchasing audit");
    expect(text).toContain("Findings (1; by type: Nonconformity 1):");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("ana@x.test");
  });
});
