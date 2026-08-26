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
  "/v1/management-review": "SOF-86: duplicate of the /implementation/reviews path; MReview is the richer model — decide which survives",
  "/v1/performance-evaluation": "SOF-86: duplicate of /implementation/performance; PerfEval owns the indicator engine",
  "/v1/org-units": "SOF-87: work-units is the one in use",
  "/v1/doa-matrix": "SOF-87: the DOA screen stores through /v1/business",
  "/v1/framework-types": "SOF-87: frameworks pages use /frameworks, /framework-groups, /framework-xref",
  "/v1/framework-families": "SOF-87: same",
  "/v1/framework-catalog": "SOF-87: same",
  "/v1/isra-org-controls": "SOF-87: no caller; ISRA screens use the isra prefix",
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
