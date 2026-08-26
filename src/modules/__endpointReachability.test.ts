import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SOF-1 app → design gate, backend half.
 *
 * `backend.md` measures module and field coverage. Nothing measured whether a
 * mounted prefix is reachable from the product at all, so eight prefixes sat
 * mounted, tested and uncalled (see /root/vibes-new/parity/audit-2026-08-26-ada.md,
 * "Pass 3"). Integration tests hit them directly, which is exactly why they stayed
 * invisible.
 *
 * This asserts every `/v1/*` mount is either referenced by the frontend or listed
 * in UNCALLED with a reason. A new endpoint group nobody wired up now fails here
 * instead of accumulating.
 */

const FE = path.resolve(__dirname, "../../../fe-vibes-new");

/** Mounted but not called by the frontend. Each needs a reason and an owning issue. */
const UNCALLED: Record<string, string> = {
  "/v1/org-units": "SOF-87: closer to OD's org-structure model than /v1/business, but FE never got wired to it — EnterpriseOrgStructurePage uses the generic business-record escape hatch instead. Kept, not deleted; needs a follow-up to wire the FE.",
  "/v1/doa-matrix": "SOF-87: matches OD's db.doaMatrix table, but FE never got wired to it — EnterpriseProcurementPolicyPage uses the generic business-record escape hatch instead. Kept, not deleted; needs a follow-up to wire the FE.",
  "/v1/management-review": "SOF-86: duplicate surface of /implementation/reviews, but MReview owns the OD-faithful MR_TOPIC_CATALOG merge semantics (mrSave/mrRecord) that the generic ImplementationRecord path lacks. Restored after a prior pass deleted it outright — kept mounted, unwired, until a follow-up decides whether the FE repoints here or the merge semantics get ported to the generic path.",
  "/v1/performance-evaluation": "SOF-86: duplicate surface of /implementation/performance, but PerfEval owns the only ISO 9.1 indicator engine (perfIndicators.ts) in the codebase. Restored after a prior pass deleted it outright — kept mounted, unwired, until a follow-up decides whether the FE repoints here or the indicator engine gets ported to the generic path.",
};

function frontendSource(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(fs.readFileSync(p, "utf8"));
    }
  };
  for (const d of ["lib", "app"]) walk(path.join(FE, d));
  return out.join("\n");
}

describe("backend endpoint reachability", () => {
  const app = fs.readFileSync(path.join(__dirname, "../app.ts"), "utf8");
  const mounts = [...new Set([...app.matchAll(/\.use\(\s*["'`](\/v1\/[^"'`]+)/g)].map((m) => m[1]))];

  it("mounts no /v1 prefix the frontend never calls", () => {
    const fe = frontendSource();
    const orphans = mounts
      .filter((m) => !fe.includes(m.replace("/v1", "").split("/:")[0]))
      .filter((m) => !(m in UNCALLED));
    expect(orphans).toEqual([]);
  });

  it("keeps UNCALLED honest — no entry for a prefix that is no longer mounted", () => {
    expect(Object.keys(UNCALLED).filter((m) => !mounts.includes(m))).toEqual([]);
  });
});
