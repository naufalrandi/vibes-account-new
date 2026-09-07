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
  "/v1/management-review": "SOF-86: duplicate surface of /implementation/reviews, but MReview owns the OD-faithful MR_TOPIC_CATALOG merge semantics (mrSave/mrRecord) that the generic ImplementationRecord path lacks. Restored after a prior pass deleted it outright — kept mounted, unwired, until a follow-up decides whether the FE repoints here or the merge semantics get ported to the generic path.",
  "/v1/performance-evaluation": "SOF-86: duplicate surface of /implementation/performance, but PerfEval owns the only ISO 9.1 indicator engine (perfIndicators.ts) in the codebase. Restored after a prior pass deleted it outright — kept mounted, unwired, until a follow-up decides whether the FE repoints here or the indicator engine gets ported to the generic path.",
  "/v1/processes": "R823: the BusinessProcess surface (list/create/sync-catalog). The FE's process pickers read the reference-db catalogue at /reference-db/business-processes instead, which is what the old substring check mistook for a call to this prefix. Kept mounted, unwired, pending a follow-up that decides which of the two is the process register.",
  "/v1/my-frameworks": "R823: the per-user framework subscription list (GET /, DELETE /:subscriptionId). The My Frameworks screen reads /framework-assignments instead; nothing in the client layer ever builds a /my-frameworks request. Surfaced when the substring check was replaced with call-graph detection — the old one was matching the nav href \"/my-frameworks\", a page URL, not an API path. Kept mounted, unwired, pending a follow-up that decides whether the screen repoints here or the mount goes.",
  "/v1/accounts": "R823: the linked-account register (list/create/update/delete). realClient has the four helpers and no screen calls any of them — there is no Accounts page; app/(app)/account is the signed-in user's own profile. Surfaced when the substring check was replaced with call-graph detection, which stopped counting those dead helpers as a call. Kept mounted, unwired, pending a follow-up that decides whether a screen gets built or the mount goes.",
};

/**
 * Every `.ts/.tsx` the product ships, paired with its path. Tests are excluded:
 * a client method only a `.test.tsx` mock names is not a call from the product.
 */
function frontendFiles(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push({ file: p, src: fs.readFileSync(p, "utf8") });
    }
  };
  for (const d of ["lib", "app", "components"]) walk(path.join(FE, d));
  return out;
}

/**
 * R823 — a bare `fe.includes("/cms")` counted any occurrence of the substring
 * anywhere in the frontend, and anchoring it to a quote was no better: both
 * still count two things that are not calls.
 *
 *   1. A Next route, not an API path. `router.push(`/processes?...`)` and
 *      `href="/my-frameworks"` are page URLs; they say nothing about whether
 *      the backend prefix of the same name is ever requested.
 *   2. A dead client helper. `realClient.listCmsPages()` builds `/cms/pages`
 *      perfectly well — nothing calls it. Same for the whole `/accounts` group.
 *
 * So reachability is resolved in two hops instead of one: harvest the request
 * paths the API-client layer actually builds together with the method that
 * builds each, then require that method to be named by product code outside
 * that layer. A prefix is called when some method that requests it is reached.
 */
const REQUEST_CALL = /\b(?:apiFetch|fetch)\s*(?:<[^(]*>)?\s*\(\s*[`"']/;
// The path literal of such a call, up to its first interpolation:
// `apiFetch<X>(`/cms/pages/${id}`)` → `/cms/pages/`, and a leading hole is
// skipped so `fetch(`${BASE}/public/cms/${orgId}/posts`)` → `/public/cms/`.
const REQUEST_PATH = /\b(?:apiFetch|fetch)\s*(?:<[^(]*>)?\s*\(\s*[`"'](?:\$\{[^}]*\})?(\/[A-Za-z][^`"'$]*)/;
// Who owns the call: a member of the client object (two-space indent) or a
// module-level export. Deliberately not any `const` — an inner `const q = …`
// inside a method would otherwise be credited with the method's request.
const OWNER = /^(?:  (?:async )?([A-Za-z_$][\w$]*)\s*[(<]|export (?:async )?(?:function |const )([A-Za-z_$][\w$]*))/;

/** Request paths the frontend builds, each tagged with the function that builds it. */
function frontendCalls(): { called: (seg: string) => boolean } {
  const files = frontendFiles();
  const clients = files.filter((f) => REQUEST_CALL.test(f.src));
  const calls: { owner: string; path: string }[] = [];
  for (const { src } of clients) {
    let owner = "";
    for (const line of src.split("\n")) {
      const o = OWNER.exec(line);
      if (o) owner = o[1] ?? o[2];
      const p = REQUEST_PATH.exec(line);
      if (p) calls.push({ owner, path: p[1] });
    }
  }
  // Product code = everything that is neither a path-building client module nor
  // the interface/mock restatements of one (`client.ts` declares every method
  // and `mockClient.ts` implements every method — naming one there is not a call).
  const product = files
    .filter((f) => !clients.includes(f) && !f.file.includes(`${path.sep}lib${path.sep}api${path.sep}`))
    .map((f) => f.src)
    .join("\n");
  const names = new Set(product.match(/[A-Za-z_$][\w$]*/g) ?? []);
  return {
    called: (seg) =>
      calls.some((c) => (c.path === seg || c.path.startsWith(`${seg}/`)) && names.has(c.owner)),
  };
}

function isCalled(fe: { called: (seg: string) => boolean }, mount: string): boolean {
  const seg = mount.replace("/v1", "").split("/:")[0];
  if (!seg || seg === "/") return true;
  return fe.called(seg);
}

describe("backend endpoint reachability", () => {
  const app = fs.readFileSync(path.join(__dirname, "../app.ts"), "utf8");
  const mounts = [...new Set([...app.matchAll(/\.use\(\s*["'`](\/v1[^"'`]*)/g)].map((m) => m[1]))];

  it("mounts no /v1 prefix the frontend never calls", () => {
    const fe = frontendCalls();
    const orphans = mounts.filter((m) => !isCalled(fe, m)).filter((m) => !(m in UNCALLED));
    expect(orphans).toEqual([]);
  });

  /**
   * The reverse direction, which the two checks above never covered: a path the
   * frontend calls that no route implements. That is the more dangerous
   * asymmetry — an unused backend prefix is dead weight, but a missing route is
   * a 404 in a workflow that looks finished and passes in mock mode.
   *
   * This found eight across three modules: the whole two-stage document review
   * (`reviewer-sign`, `escalate`, `periodic-review`), the competence gap review
   * lifecycle (`review`, `unreview`, `reopen`), and four Enterprise → Database
   * screens (banks, holidays, business-processes, fiscal-periods) whose pages
   * only ever worked against the mock client.
   *
   * Matching is deliberately coarse — the trailing literal segment of each path
   * the real client builds, checked against every route table. It catches a
   * whole action or resource going missing, not a param-shape mismatch.
   */
  it("implements every endpoint the real client calls", () => {
    const real = fs.readFileSync(path.join(FE, "lib/api/realClient.ts"), "utf8");
    const routes: string[] = [];
    const walkRoutes = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkRoutes(p);
        else if (e.name.endsWith(".routes.ts")) routes.push(fs.readFileSync(p, "utf8"));
      }
    };
    walkRoutes(__dirname);
    const routeSrc = routes.join("\n");

    // Only template literals passed to `apiFetch` count — a backtick inside a
    // prose comment is not a call. And cut each literal at its first
    // interpolation: splitting on "/" alone glued the last segment to the
    // interpolation whenever one immediately followed it, as in
    // `/hr-employees${q ? ...}`, so the segment was dropped and the endpoint
    // went unchecked. That is how `GET /hr-employees` (Team Management's
    // no-access employee count) sat unimplemented behind a green guard.
    const calledPaths = new Set<string>();
    for (const m of real.matchAll(/apiFetch[^(\n]*\(\s*`(\/[^`]*)/g)) {
      const segs = m[1].split("${")[0].split("/").filter(Boolean).map((x) => x.split("?")[0]);
      if (segs.length && /^[a-z][a-z0-9-]{2,}$/.test(segs[0])) calledPaths.add(segs.join("/"));
    }

    // A one-segment call names a mount prefix, which lives in app.ts; a deeper
    // call names an action inside a route table. Check each where it belongs.
    // `app.use("/v1", ...)` is a blanket mount, so a prefix it serves shows up
    // in the router's own path declarations rather than in app.ts.
    const blanket = mounts.includes("/v1");
    // A mount can be several segments deep (`/v1/public/purchase-orders`), so
    // match against whole mount prefixes and check only the part of the path
    // the mount does not already account for — otherwise a segment belonging to
    // the mount gets looked up as if it were a route action.
    const longestMount = (p: string): string | null => {
      const full = `/v1/${p}`;
      const hits = mounts.filter((m) => m === full || full.startsWith(`${m}/`));
      return hits.sort((a, b) => b.length - a.length)[0] ?? null;
    };
    const missing = [...calledPaths]
      .filter((p) => {
        const mount = longestMount(p);
        if (!mount) {
          // `app.use("/v1", ...)` serves prefixes declared inside the router.
          return !(blanket && routeSrc.includes(`"/${p.split("/")[0]}`));
        }
        const rest = `/v1/${p}`.slice(mount.length).split("/").filter(Boolean);
        const last = rest[rest.length - 1];
        if (!last || !/^[a-z][a-z0-9-]{2,}$/.test(last)) return false;
        return !routeSrc.includes(`"/${last}`) && !routeSrc.includes(`/${last}"`) && !routeSrc.includes(`/${last}/`);
      })
      .sort();
    expect(missing).toEqual([]);
  });

  it("keeps UNCALLED honest — no entry for a prefix that is no longer mounted", () => {
    expect(Object.keys(UNCALLED).filter((m) => !mounts.includes(m))).toEqual([]);
  });

});
