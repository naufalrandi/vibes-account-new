import { describe, expect, it } from "vitest";
import { ISRA_CONSEQ_AREAS } from "../models/israScenario.models";
import {
  ISRA_DEMO_SCENARIOS,
  ISRA_DEMO_ASSET_MAPS,
  ISRA_DEMO_EXISTING_CONTROLS,
  ISRA_DEMO_EVIDENCE,
  ISRA_DEMO_INITIATIVES,
  ISRA_DEMO_CONTROL_BASELINE,
} from "./isra.tenantDemo.data";
import { ISRA_THREAT_LIBRARY_SEED } from "./isra.threatLibrary.data";
import { ISRA_VULN_LIBRARY_SEED } from "./isra.vulnLibrary.data";
import { ISRA_ANNEXA_SEED } from "./isra.annexA.data";

/**
 * The demo workspace is a snapshot of OD's generated register, so it can drift
 * away from the library seed it references without anything else noticing until
 * `seedIsraTenantDemo()` silently skips rows on an FK guard. These checks fail
 * on that drift instead.
 */
describe("ISRA tenant demo snapshot", () => {
  const codes = new Set(ISRA_DEMO_SCENARIOS.map((s) => s.id));
  const threats = new Set(ISRA_THREAT_LIBRARY_SEED.map((t) => t.id));
  const vulns = new Set(ISRA_VULN_LIBRARY_SEED.map((v) => v.id));
  const annex = new Set(ISRA_ANNEXA_SEED.map((a) => a.ref));

  it("has the expected shape", () => {
    expect(ISRA_DEMO_SCENARIOS.length).toBeGreaterThan(0);
    expect(codes.size).toBe(ISRA_DEMO_SCENARIOS.length);
    expect(ISRA_DEMO_ASSET_MAPS.length).toBeGreaterThan(0);
  });

  it("references only threats and vulns that the library seed provides", () => {
    expect(ISRA_DEMO_SCENARIOS.filter((s) => !threats.has(s.threatId)).map((s) => s.id)).toEqual([]);
    const badVulns = ISRA_DEMO_SCENARIOS.flatMap((s) => (s.includedVulnIds ?? []).filter((v) => !vulns.has(v)));
    expect([...new Set(badVulns)]).toEqual([]);
  });

  it("rates impacts on the 12 consequence areas only", () => {
    const areas = new Set(ISRA_DEMO_SCENARIOS.flatMap((s) => (s.potentialImpacts ?? []).map((p) => p.perspective)));
    expect([...areas].filter((a) => !ISRA_CONSEQ_AREAS.includes(a as never))).toEqual([]);
  });

  it("hangs every child row off a scenario in the snapshot", () => {
    expect(ISRA_DEMO_EXISTING_CONTROLS.filter((c) => !codes.has(c.scenarioId)).map((c) => c.id)).toEqual([]);
    expect(ISRA_DEMO_EVIDENCE.filter((e) => e.scenarioId && !codes.has(e.scenarioId)).map((e) => e.id)).toEqual([]);
    const badInit = ISRA_DEMO_INITIATIVES.flatMap((i) => (i.scenarioIds ?? []).filter((c) => !codes.has(c)));
    expect(badInit).toEqual([]);
  });

  it("scopes the control-maturity baseline to real Annex A refs", () => {
    expect(ISRA_DEMO_CONTROL_BASELINE.filter((b) => !annex.has(b.annexRef)).map((b) => b.annexRef)).toEqual([]);
  });
});
