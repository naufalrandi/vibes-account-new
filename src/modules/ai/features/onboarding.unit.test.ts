import { describe, expect, it } from "vitest";
import { sanitizeSuggestions } from "./onboarding.feature";

const existing = { scopeStatements: [], contextTitles: ["Old issue"], partyNames: ["Regulator"], processNames: ["Internal Audit"], objectiveTitles: [] };

describe("onboarding sanitizeSuggestions", () => {
  it("drops unknown processes/clauses and anything already recorded or repeated", () => {
    const out = sanitizeSuggestions({
      scope: { statement: " S ", exclusions: [{ clauseRef: "8.3", justification: "j" }, { clauseRef: "42", justification: "j" }] },
      contextIssues: [
        { domain: "Market", type: "external", title: "old ISSUE", description: "" },
        { domain: "Market", type: "external", title: "New issue", description: "" },
        { domain: "Market", type: "external", title: "new issue ", description: "" },
      ],
      interestedParties: [{ name: "Regulator", category: "Regulators", needs: [] }, { name: "Staff", category: "Employees", needs: ["Pay"] }],
      processes: [{ catalogName: "Internal Audit", reason: "" }, { catalogName: "Software Testing", reason: "" }, { catalogName: "Made up", reason: "" }],
      objectives: [{ title: "O1", target: "t", measure: "m", due: "2027-01-01" }],
    }, existing, new Set(["8.3"]), ["Internal Audit", "Software Testing"]);
    expect(out.scope).toEqual({ statement: "S", exclusions: [{ clauseRef: "8.3", justification: "j" }] });
    expect(out.contextIssues.map((c) => c.title)).toEqual(["New issue"]);
    expect(out.interestedParties.map((p) => p.name)).toEqual(["Staff"]);
    expect(out.processes.map((p) => p.catalogName)).toEqual(["Software Testing"]);
    expect(out.objectives).toHaveLength(1);
  });
});
