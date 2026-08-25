import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * Cross-tenant isolation, proven as a property rather than assumed.
 *
 * `src/middleware/tenantScope.ts` deliberately does NOT restrict row
 * visibility — it gates SaaS subscription lifecycle (G-75). Tenant row
 * visibility rests entirely on every service layer applying its own filter
 * derived from the verified JWT (`req.auth` -> `AuthContext`). Across the ~60
 * authenticated route mounts in `src/app.ts`, a single service that forgets is
 * a live cross-tenant leak.
 *
 * This test enumerates the mounts, statically analyses every Sequelize query
 * reachable from them, and fails when a query against an org-scoped model
 * carries no org/tenant predicate. Pre-existing unscoped call sites are
 * recorded in `tenant-isolation.baseline.json`; the test fails on anything new,
 * so the surface can only shrink. Run with UPDATE_TENANT_BASELINE=1 to rewrite
 * the baseline after a deliberate change.
 */

const SRC = join(__dirname, "..", "src");
const MODULES = join(SRC, "modules");
const BASELINE = join(__dirname, "tenant-isolation.baseline.json");

/** Query methods whose options argument must carry the org/tenant predicate. */
const OPTION_ARG: Record<string, number> = {
  findAll: 0,
  findOne: 0,
  findAndCountAll: 0,
  count: 0,
  min: 1,
  max: 1,
  sum: 1,
  destroy: 0,
  update: 1,
  increment: 1,
  decrement: 1,
};
/** Primary-key lookups can never carry a scope in the call itself. */
const PK_METHODS = new Set(["findByPk"]);
/**
 * `findOne({ where: { id, module: "risks" } })` is a primary-key lookup spelled the
 * long way. Deliberately narrow: shorthand `id` or `id: <plain identifier>` only, never
 * `id: { [Op.in]: ids }`, which is a plural lookup and must carry its own scope. */
const PK_WHERE_RE = /where:\s*\{\s*id\s*(?:[,}]|:\s*[A-Za-z_$][\w$.]*\s*[,}])/;

/** Anything in the resolved options text that proves a tenancy predicate is applied. */
const SCOPE_RE = /\borg_?Ids?\b|\btenantId\b|\btenant_id\b|\borg_id\b/i;

/**
 * An ownership check standing in for a scope predicate. `findByPk` cannot carry
 * a WHERE, so the guard has to appear elsewhere in the same function: either a
 * direct comparison against the actor's org, or one of the shared assertions.
 */
const OWNERSHIP_RE =
  /\bassert(?:Can|Owned|Visible|Org)\w*|\brequireOwned\w*|canActOnOrg|targetOrg|visible\w*OrgIds|orgClause|ForbiddenError|scopeWhere|ScopeWhere/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

/**
 * Model classes that own a tenancy column. A model without `orgId`/`tenantId`
 * is either global reference data (ISIC, countries, the action catalog) or a
 * child row reached only through an already-scoped parent — neither can leak by
 * itself.
 */
function orgScopedModels(): Set<string> {
  const scoped = new Set<string>();
  for (const file of sourceFiles(join(SRC, "db", "models"))) {
    ts.forEachChild(parse(file), function visit(node): void {
      if (ts.isClassDeclaration(node) && node.name) {
        const props = node.members.filter(ts.isPropertyDeclaration).map((m) => m.name.getText());
        if (props.includes("orgId") || props.includes("tenantId")) scoped.add(node.name.text);
      }
      ts.forEachChild(node, visit);
    });
  }
  return scoped;
}

/**
 * Mounts that legitimately reach a handler without `authenticate`. Anything not
 * listed here and not mounted behind `authenticate, tenantScope` fails the
 * mount census below, so a new public route cannot be added silently.
 */
const EXEMPT_MOUNTS: Record<string, string> = {
  "/health": "Liveness probe — static payload, touches no model.",
  "/v1/auth": "Issues the JWT (login/refresh/activate/reset), so it cannot require one. Behind its own rate limiter.",
  "/v1/demo-requests":
    "Public demo-request intake from the marketing site — write-only, deduped by email, own per-IP rate limiter.",
};

/** `app.use("/v1/x", authenticate, tenantScope, xRoutes)` -> router symbol per prefix. */
function authenticatedMounts(): { prefix: string; router: string }[] {
  const text = readFileSync(join(SRC, "app.ts"), "utf8");
  const re = /app\.use\(\s*"([^"]+)"\s*,\s*authenticate\s*,\s*tenantScope\s*,\s*(\w+)\s*\)/g;
  const out: { prefix: string; router: string }[] = [];
  for (const m of text.matchAll(re)) out.push({ prefix: m[1], router: m[2] });
  return out;
}

/** Router symbol -> the module directory it is imported from. */
function routerDirs(): Map<string, string> {
  const text = readFileSync(join(SRC, "app.ts"), "utf8");
  const map = new Map<string, string>();
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/modules\/([^/]+)\//g)) {
    for (const sym of m[1].split(",")) {
      const name = sym.trim().split(/\s+as\s+/).pop()!.trim();
      if (name) map.set(name, m[2]);
    }
  }
  return map;
}

interface Site {
  file: string;
  line: number;
  model: string;
  method: string;
}

const key = (s: Site) => `${s.file}:${s.model}.${s.method}`;

/**
 * Project-wide index of helper bodies, keyed by name. A WHERE clause is
 * routinely assembled somewhere other than the call site — `scopeWhere(auth)`,
 * `orgWhere(auth)`, `visibleOrgIds(auth)` — sometimes in another file. Resolving
 * a referenced name to its body is what keeps those from reading as violations.
 * Same-name helpers in different modules are unioned; that is deliberately
 * permissive, so this analysis is a regression fence, not a soundness proof.
 */
let helperIndex: Map<string, string> | undefined;
function helpers(): Map<string, string> {
  if (helperIndex) return helperIndex;
  helperIndex = new Map();
  for (const file of [...sourceFiles(MODULES), ...sourceFiles(join(SRC, "lib"))]) {
    const sf = parse(file);
    ts.forEachChild(sf, function visit(node): void {
      let name: string | undefined;
      if (ts.isFunctionDeclaration(node) && node.name) name = node.name.text;
      else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) name = node.name.text;
      if (name) helperIndex!.set(name, `${helperIndex!.get(name) ?? ""}\n${node.getText()}`);
      ts.forEachChild(node, visit);
    });
  }
  return helperIndex;
}

/** Nearest enclosing function/method node, or the source file as a fallback. */
function enclosingFn(node: ts.Node): ts.Node {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n)) {
      return n;
    }
  }
  return node.getSourceFile();
}

function enclosingBody(node: ts.Node): string {
  return enclosingFn(node).getText();
}

/**
 * Every declaration/assignment statement in the enclosing function, whole — not
 * split by line, so a multi-line `const where = { ... }` stays intact.
 */
const assignmentCache = new WeakMap<ts.Node, string[]>();
function assignments(node: ts.Node): string[] {
  const fn = enclosingFn(node);
  const hit = assignmentCache.get(fn);
  if (hit) return hit;
  const out: string[] = [];
  ts.forEachChild(fn, function visit(n): void {
    if (ts.isVariableStatement(n) || ts.isExpressionStatement(n)) out.push(n.getText());
    ts.forEachChild(n, visit);
  });
  assignmentCache.set(fn, out);
  return out;
}

const writeCache = new Map<string, RegExp>();

/**
 * Does this statement WRITE `name` — declare it, assign to it (or to a property
 * of it), or `Object.assign` into it? Mere mention does not count. That
 * distinction is the whole game: matching on mention makes ubiquitous tokens
 * (`const`, `await`, `Site`) drag the entire function body into the scope text,
 * and then any stray `orgId` anywhere in the function hides a genuinely
 * unscoped query.
 */
function writesTo(name: string): RegExp {
  const cached = writeCache.get(name);
  if (cached) return cached;
  const n = name.replace(/\$/g, "\\$");
  const re = new RegExp(
    `\\b(?:const|let|var)\\s+(?:\\{[^}]*\\b${n}\\b[^}]*\\}|\\[[^\\]]*\\b${n}\\b[^\\]]*\\]|${n}\\b)` +
      `|\\b${n}\\b(?:\\.\\w+|\\[[^\\]]*\\])*\\s*(?:\\+|\\?\\?|\\|\\|)?=(?!=)` +
      `|Object\\.assign\\(\\s*${n}\\b`,
  );
  writeCache.set(name, re);
  return re;
}

/**
 * Everything the query's scope could come from, grown outward from the options
 * argument only — never from the whole enclosing function, which would let an
 * unrelated `writeAudit({ organizationId: auth.orgId })` or a `tenantId` field
 * in a view mapper read as a filter and hide a genuinely unscoped query.
 *
 * Rounds of: for every name the text references, pull in the statements that
 * *write* that name (this is how `Object.assign(where, { orgId })` reaches a
 * `{ where }` call site) plus the body of every helper it calls
 * (`scopeWhere(auth)`, `visibleOrgIds(auth)`, ...). Repeat until nothing new,
 * so `where <- ids <- visibleTenantOrgIds(auth)` resolves transitively.
 */
function resolvedScopeText(optsText: string, node: ts.Node): string {
  const stmts = assignments(node);
  let text = optsText;
  for (let round = 0; round < 4; round++) {
    const names = new Set(text.match(/\b[A-Za-z_$][\w$]*\b/g) ?? []);
    let added = "";
    for (const name of names) {
      const w = writesTo(name);
      for (const s of stmts) if (w.test(s) && !text.includes(s)) added += `\n${s}`;
      const helper = helpers().get(name);
      if (helper && new RegExp(`\\b${name}\\s*\\(`).test(text) && !text.includes(helper)) added += `\n${helper}`;
    }
    if (!added) break;
    text += added;
  }
  return text;
}

/** Unscoped query call sites in one file. */
function scanFile(file: string, scopedModels: Set<string>): Site[] {
  const sf = parse(file);
  const rel = relative(join(__dirname, ".."), file);
  const found: Site[] = [];

  ts.forEachChild(sf, function visit(node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const model = node.expression.expression.getText();
      const method = node.expression.name.text;
      if (scopedModels.has(model)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const takesOptions = method in OPTION_ARG;
        if (!takesOptions && !PK_METHODS.has(method)) return ts.forEachChild(node, visit);
        const opts = takesOptions ? node.arguments[OPTION_ARG[method]] : undefined;
        const optsText = opts?.getText() ?? "";

        // Best case: the query carries its own tenancy predicate.
        if (opts && SCOPE_RE.test(resolvedScopeText(optsText, node))) return ts.forEachChild(node, visit);

        // A lookup pinned to one primary key is in the same position as
        // `findByPk`: the row is singular, so the scope cannot live in the WHERE
        // and the check has to follow in the same function. Only an explicit
        // ownership assertion counts — a bare `orgId` mention proves nothing,
        // since every service reads `row.orgId` for audit or view mapping.
        const pkLike = PK_METHODS.has(method) || PK_WHERE_RE.test(optsText);
        if (!pkLike || !OWNERSHIP_RE.test(enclosingBody(node))) found.push({ file: rel, line, model, method });
      }
    }
    ts.forEachChild(node, visit);
  });
  return found;
}

describe("cross-tenant isolation (service-layer org filtering)", () => {
  const scopedModels = orgScopedModels();
  const mounts = authenticatedMounts();
  const dirs = routerDirs();

  it("every org-scoped model is discovered", () => {
    // Sanity floor: if the model-scanning heuristic breaks, the whole analysis
    // silently passes. Anchor it on models that must always be org-scoped.
    expect(scopedModels.has("WorkUnit")).toBe(true);
    expect(scopedModels.has("Site")).toBe(true);
    expect(scopedModels.size).toBeGreaterThan(40);
  });

  it("every authenticated route mount resolves to a module directory that exists", () => {
    expect(mounts.length).toBeGreaterThan(50);
    const unresolved = mounts.filter(({ router }) => {
      const dir = dirs.get(router);
      return !dir || !existsSync(join(MODULES, dir));
    });
    expect(unresolved).toEqual([]);
  });

  it("every mount is either authenticated+tenant-scoped or an explicit exemption", () => {
    const text = readFileSync(join(SRC, "app.ts"), "utf8");
    const all = [...text.matchAll(/app\.(?:use|get|post|put|patch|delete)\(\s*"([^"]+)"/g)].map((m) => m[1]);
    const guarded = new Set(mounts.map((m) => m.prefix));
    const unaccounted = all.filter((p) => !guarded.has(p) && !(p in EXEMPT_MOUNTS));
    expect(unaccounted).toEqual([]);
    // Exemptions must be live: a stale entry means the census is guessing.
    expect(Object.keys(EXEMPT_MOUNTS).filter((p) => !all.includes(p))).toEqual([]);
  });

  it("no query against an org-scoped model runs without an org/tenant predicate", () => {
    const dirsInPlay = [...new Set(mounts.map((m) => dirs.get(m.router)!))];
    const sites = dirsInPlay
      .flatMap((d) => sourceFiles(join(MODULES, d)))
      .flatMap((f) => scanFile(f, scopedModels));

    // Counted per (file, model, method), not per line: line numbers churn on
    // every unrelated edit above them, counts only move when a query does.
    const current = new Map<string, number>();
    for (const s of sites) current.set(key(s), (current.get(key(s)) ?? 0) + 1);

    const baseline: Record<string, { count: number; why: string }> = JSON.parse(readFileSync(BASELINE, "utf8"));

    if (process.env.UPDATE_TENANT_BASELINE) {
      const next = Object.fromEntries(
        [...current].sort(([a], [b]) => a.localeCompare(b)).map(([k, count]) => [
          k,
          { count, why: baseline[k]?.why ?? "TRIAGE ME" },
        ]),
      );
      writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    }

    // A new call site, or another unscoped call at a site that already had one,
    // both fail. Every accepted entry must carry a triage note.
    const regressions = [...current]
      .filter(([k, count]) => (baseline[k]?.count ?? 0) < count)
      .map(([k, count]) => `${k}: ${count} unscoped call(s), baseline ${baseline[k]?.count ?? 0}`);
    expect(regressions).toEqual([]);

    const untriaged = Object.entries(baseline)
      .filter(([, v]) => !v.why || v.why === "TRIAGE ME")
      .map(([k]) => k);
    expect(untriaged).toEqual([]);
    // Whole-tree parse + per-call-site dataflow widening; well past vitest's 5s default.
  }, 120_000);
});
