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

// `../../../fe-vibes-new` only resolves when this repo sits beside the frontend
// checkout; from a git worktree (which AGENTS.md requires for any edit) it points
// at a directory that does not exist, and the walk below dies with ENOENT.
// `VIBES_FRONTEND_DIR` overrides it; otherwise fall back to the primary checkout.
const FE = (() => {
  const candidates = [
    process.env.VIBES_FRONTEND_DIR,
    path.resolve(__dirname, "../../../fe-vibes-new"),
    "/root/vibes-new/fe-vibes-new",
  ].filter((d): d is string => !!d);
  return candidates.find((d) => fs.existsSync(path.join(d, "lib"))) ?? candidates[1];
})();

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

  /**
   * The reverse direction, which the two checks above never covered: a path the
   * frontend calls that no route implements. That is the more dangerous
   * asymmetry — an unused backend prefix is dead weight, but a missing route is
   * a 404 in a workflow that looks finished and passes in mock mode.
   *
   * This found three: the whole two-stage document review
   * (`reviewer-sign`, `escalate`, `periodic-review`) was implemented in the mock
   * client and called by the UI, with no backend route behind any of it.
   *
   * Matching is deliberately coarse — the last literal segment of each
   * `/approvals/...` style path the real client builds, checked against the
   * route tables. It catches a whole action going missing, not a param typo.
   */
  it("implements every /approvals action the real client calls", () => {
    const real = fs.readFileSync(path.join(FE, "lib/api/realClient.ts"), "utf8");
    const routes = fs
      .readdirSync(path.join(__dirname, "approvals"))
      .filter((f) => f.endsWith(".routes.ts"))
      .map((f) => fs.readFileSync(path.join(__dirname, "approvals", f), "utf8"))
      .join("\n");

    // Trailing literal action segments, e.g. `/approvals/records/x/y/escalate`.
    const called = new Set(
      [...real.matchAll(/\/approvals\/[A-Za-z0-9/${}._:-]*?\/([a-z][a-z-]{2,})(?=[`"'?])/g)].map((m) => m[1]),
    );
    const missing = [...called].filter((seg) => !routes.includes(`/${seg}"`));
    expect(missing).toEqual([]);
  });

  it("keeps UNCALLED honest — no entry for a prefix that is no longer mounted", () => {
    expect(Object.keys(UNCALLED).filter((m) => !mounts.includes(m))).toEqual([]);
  });
});
