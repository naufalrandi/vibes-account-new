import { describe, expect, it } from "vitest";
import type { IsraSampleScenarioRow } from "../../../db/seeders/isra.tenantSample.data";
import { mechanismSources, pickFewShots, scenarioPrompt, soaBatchPrompt } from "./isra-copilot.feature";

const sample = (id: string, threatId: string, vulnIds: string[], note = "note"): IsraSampleScenarioRow => ({
  id, primaryAsset: "", primaryAssetId: "", process: "", secondaryAsset: "", secondaryAssetId: "",
  threat: "", threatId, includedVulns: [], includedVulnIds: vulnIds,
  potentialImpacts: [{ id: "PI-1", perspective: "privacy", severity: 4, note }, { id: "PI-2", perspective: "ops", severity: 2, note: "" }],
  impactOverride: null, cia: { c: true }, ciaDesc: { c: "loss of customer data", i: "" }, inherentL: 4,
  likelihoodNote: `likely ${id}`, title: `Title ${id}`, status: "Draft", createdAt: "",
});

describe("isra-copilot context builders", () => {
  it("picks same-threat platform examples, most vulnerability overlap first, capped at 4, without scores", () => {
    const rows = [
      sample("A", "THR-1", ["V1"]),
      sample("B", "THR-1", ["V1", "V2"]),
      sample("C", "THR-2", ["V1", "V2"]),
      sample("D", "THR-1", []),
      sample("E", "THR-1", []),
      sample("F", "THR-1", []),
    ];
    const shots = pickFewShots("THR-1", ["V1", "V2"], rows);
    expect(shots.map((s) => s.title)).toEqual(["Title B", "Title A", "Title D", "Title E"]);
    expect(shots[0]).toEqual({
      id: "EX-1", title: "Title B", ciaDesc: { c: "loss of customer data" }, likelihoodNote: "likely B",
      impactNotes: [{ area: "privacy", note: "note" }],
    });
    expect(JSON.stringify(shots)).not.toMatch(/severity|inherentL/);
  });

  it("falls back to three generic examples when the threat has none", () => {
    const rows = [sample("A", "THR-1", []), sample("B", "THR-2", []), sample("C", "THR-3", []), sample("D", "THR-4", [])];
    expect(pickFewShots("THR-9", [], rows)).toHaveLength(3);
  });

  it("builds a scenario prompt that cites threat and vulnerability ids with library names", () => {
    const lib = (id: string, name: string) => new Map([[id, { name, description: "desc", category: "cat" }]]);
    const out = scenarioPrompt(
      { secondaryAssetId: "SAL-1", threatId: "THR-1", vulnIds: ["V1", "V9"] },
      { threat: lib("THR-1", "Account takeover"), vuln: lib("V1", "No MFA"), secondary: lib("SAL-1", "Web app") },
      [],
    );
    expect(out).toContain("[THR-1] Threat: Account takeover (cat) — desc");
    expect(out).toContain("[V1] Vulnerability: No MFA");
    expect(out).toContain("[V9] Vulnerability: not in the library");
    expect(out).toContain("Secondary asset SAL-1: Web app");
    expect(out).toContain("privacy");
  });

  it("joins mechanism sources from knowledge-map edges in code", () => {
    const edges = [
      { id: "KVC-1", vulnId: "V1", annexRef: "A.8.5", mechanism: "m" },
      { id: "KVC-2", vulnId: "V2", annexRef: "A.8.5", mechanism: null },
      { id: "KVC-3", vulnId: "V1", annexRef: "A.5.1", mechanism: "m" },
    ];
    expect(mechanismSources(edges, "A.8.5")).toBe("KVC-1, KVC-2");
    expect(mechanismSources(edges, "A.9.9")).toBeNull();
  });

  it("describes SoA controls with their scenarios and dispositions", () => {
    const row = { ref: "A.8.5", name: "Secure authentication", category: "Technological", applicable: true, scenarios: [{ code: "RSC-0001" }] };
    const out = soaBatchPrompt([row as never], new Map([["A.8.5", ["RSC-0001: Selected"]]]));
    expect(out).toContain("[A.8.5] Secure authentication [Technological]. Applicable — used in RSC-0001. RSC-0001: Selected");
  });
});
