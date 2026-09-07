import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { BUSINESS_DATA_SCHEMAS } from "./dataSchemas";

/**
 * FE/BE business module parity (SOF-47), in the spirit of
 * `implementation/registry.snapshot.test.ts`: the frontend's set of module
 * keys must be a subset of the backend's registered `BUSINESS_DATA_SCHEMAS`
 * keys, or a request to that module can never reach a registered handler.
 *
 * R822 — this gate used to take both halves on trust. Its input was a
 * hand-maintained mirror of the frontend's `const MODULE = "..."` literals, so
 * it only knew what someone last remembered to copy across (it missed all five
 * `ent-mkt-*` keys the Website CMS posts to, and seven more besides), and it
 * compared key sets only, never the field names inside `data` — which is what
 * the `.strict()` schemas in `dataSchemas.ts` actually reject with a 400
 * (`business.controller.ts` `parseInput`). Both inputs are now read out of the
 * frontend checkout itself, the same way `__endpointReachability.test.ts`
 * reads it, so drift shows up here instead of in production.
 */

// `../../../../fe-vibes-new` only resolves when this repo sits beside the
// frontend checkout; from a git worktree it points at a directory that does not
// exist. `VIBES_FRONTEND_DIR` overrides it; otherwise fall back to the primary
// checkout. Same resolution as `src/modules/__endpointReachability.test.ts`.
const FE = (() => {
  const candidates = [
    process.env.VIBES_FRONTEND_DIR,
    path.resolve(__dirname, "../../../../fe-vibes-new"),
    "/root/vibes-new/fe-vibes-new",
  ].filter((d): d is string => !!d);
  return candidates.find((d) => fs.existsSync(path.join(d, "lib"))) ?? candidates[1];
})();

/**
 * Every `.ts/.tsx` the product ships, paired with its path. Tests are excluded:
 * a module key or a payload that only a `.test.tsx` fixture names is not
 * something the product posts.
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

/* -------------------------------------------------------------------------
 * A small brace-matching scanner. The frontend has no exported module-key
 * list and no per-module payload type — keys are `const MODULE = "..."`
 * literals per page and payloads are inline `data: { ... }` object literals —
 * so the only way to read them is to walk the source. Deliberately not a
 * parser: it resolves what it can prove and skips the rest (see `scanFrontend`).
 * ---------------------------------------------------------------------- */

/** Index just past the string or template literal that starts at `i`. */
function skipString(src: string, i: number): number {
  const quote = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === quote) return i + 1;
    // A template hole can hold anything, braces and quotes included.
    if (quote === "`" && src[i] === "$" && src[i + 1] === "{") { i = matchBracket(src, i + 1); continue; }
    i++;
  }
  return i;
}

/** Index just past the comment that starts at `i`, which is not the end. */
function skipComment(src: string, i: number, end: number): number {
  if (src[i + 1] === "/") { while (i < end && src[i] !== "\n") i++; return i; }
  const close = src.indexOf("*/", i);
  return close < 0 ? end : close + 2;
}

const isComment = (src: string, i: number) => src[i] === "/" && (src[i + 1] === "/" || src[i + 1] === "*");

/** Index just past the `{`, `(` or `[` opened at `i`, skipping strings and comments. */
function matchBracket(src: string, i: number): number {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (isComment(src, i)) { i = skipComment(src, i, src.length); continue; }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") { depth--; if (depth === 0) return i + 1; }
    i++;
  }
  return i;
}

/**
 * The field names an object literal declares at its own top level — `a: 1`,
 * `"a": 1` and the `a` shorthand alike. A `...spread` declares nothing here
 * (it merges a record the backend already stored) and a `[computed]` key is
 * unknowable, so both are skipped rather than guessed at.
 */
function objectKeys(src: string, start: number): string[] {
  const end = matchBracket(src, start);
  const keys: string[] = [];
  let i = start + 1;
  const trivia = () => {
    for (;;) {
      while (i < end && /\s/.test(src[i])) i++;
      if (i < end && isComment(src, i)) { i = skipComment(src, i, end); continue; }
      return;
    }
  };
  /** Past one entry's value, to its top-level comma or the closing brace. */
  const value = () => {
    while (i < end - 1) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
      if (isComment(src, i)) { i = skipComment(src, i, end); continue; }
      if (c === "{" || c === "(" || c === "[") { i = matchBracket(src, i); continue; }
      if (c === "," || c === "}") return;
      i++;
    }
  };
  while (i < end - 1) {
    trivia();
    if (i >= end - 1 || src[i] === "}") break;
    if (src.startsWith("...", i)) { i += 3; value(); }
    else if (src[i] === '"' || src[i] === "'") {
      const close = skipString(src, i);
      const quoted = src.slice(i + 1, close - 1);
      i = close;
      trivia();
      if (src[i] === ":") { i++; keys.push(quoted); }
      value();
    } else if (src[i] === "[") {
      i = matchBracket(src, i);
      trivia();
      if (src[i] === ":") i++;
      value();
    } else if (/[A-Za-z_$]/.test(src[i])) {
      let j = i;
      while (j < end && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      i = j;
      trivia();
      if (src[i] === ":") i++;
      keys.push(word);
      value();
    } else i++;
    trivia();
    if (src[i] === ",") i++;
  }
  return keys;
}

/** A call's arguments, split on its own top-level commas. */
function splitArgs(args: string): string[] {
  const parts: string[] = [];
  let last = 0;
  let i = 0;
  while (i < args.length) {
    const c = args[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(args, i); continue; }
    if (isComment(args, i)) { i = skipComment(args, i, args.length); continue; }
    if (c === "{" || c === "(" || c === "[") { i = matchBracket(args, i); continue; }
    if (c === ",") { parts.push(args.slice(last, i).trim()); last = i + 1; }
    i++;
  }
  parts.push(args.slice(last).trim());
  return parts;
}

const BUSINESS_CALL = /\b(?:list|create|update|delete)Business\s*\(/g;
const MODULE_CONST = /\b(\w*MODULE)\s*=\s*["']([a-z][a-z0-9-]*)["']/g;
const EXPORTED_MODULE_CONST = /\bexport const (\w*MODULE)\s*=\s*["']([a-z][a-z0-9-]*)["']/g;
const DATA_LITERAL = /\bdata\s*:\s*\{/;

type Post = { file: string; module: string; fields: string[] };

/**
 * Every business module key the frontend requests, and — for each call that
 * builds its payload inline — the field names it writes into `data`.
 *
 * A call whose module argument is a parameter rather than a literal or a
 * module const (`useCmsCollection(module)`) resolves to nothing and is
 * skipped: it makes no claim about which key it hits. Likewise a payload
 * assembled in a child component and handed up through a prop
 * (`website-cms/PagesTab.tsx`'s `onSave`) is not attributable to a key, so
 * the field check below covers call sites, not every literal in the tree.
 */
function scanFrontend(): { keys: Set<string>; posts: Post[] } {
  const files = frontendFiles();
  // A bare `const MODULE = "ent-pr"` is redeclared per page with a different
  // key, so it only resolves inside its own file; only exported consts (the
  // Website CMS's five) travel across files.
  const exported = new Map<string, string>();
  for (const { src } of files) for (const m of src.matchAll(EXPORTED_MODULE_CONST)) exported.set(m[1], m[2]);

  const keys = new Set<string>();
  const posts: Post[] = [];
  for (const { file, src } of files) {
    const consts = new Map(exported);
    for (const m of src.matchAll(MODULE_CONST)) consts.set(m[1], m[2]);
    for (const call of src.matchAll(BUSINESS_CALL)) {
      const open = (call.index ?? 0) + call[0].length - 1;
      const args = src.slice(open + 1, matchBracket(src, open) - 1);
      const moduleArg = splitArgs(args)[1] ?? "";
      const literal = /^["']([a-z][a-z0-9-]*)["']$/.exec(moduleArg);
      const key = literal ? literal[1] : consts.get(moduleArg);
      if (!key) continue;
      keys.add(key);
      const data = DATA_LITERAL.exec(args);
      if (data) posts.push({ file, module: key, fields: objectKeys(args, (data.index ?? 0) + data[0].length - 1) });
    }
  }
  return { keys, posts };
}

const FRONTEND = scanFrontend();

/**
 * Known drift as of SOF-47: these FE module keys have no backend
 * `BUSINESS_DATA_SCHEMAS` entry yet, so requests to them fall through to
 * unvalidated writes. Tracked here (not silently ignored) so this test stays
 * green while still failing loudly the moment a *new*, unacknowledged key
 * drifts. Shrink this list — never grow it — as each module gets a real
 * backend registration; don't add newly-discovered drift here without
 * filing a follow-up to close it.
 */
const KNOWN_UNREGISTERED_FE_KEYS = new Set([
  "dn-pentest",
  "dn-software",
  "ent-orgstructure",
  // R822 — surfaced the moment the key list stopped being hand-maintained.
  // Both are read-only from the frontend today (`listBusiness` only), so
  // nothing writes an unvalidated payload to them yet.
  "ent-bpcatalog",
  "ent-svc-clauses",
]);

/**
 * R822 — fields the frontend really writes that the module's `.strict()`
 * schema does not declare, i.e. a live 400 on that save. Every entry below is
 * the same defect: the inquiry → proposal → contract → project chain stamps a
 * back-reference onto the *upstream* record after each conversion, and no
 * schema was widened for it. Closing them means adding the fields in
 * `dataSchemas.ts` (and to `dataSchemas.test.ts`'s `MODULE_FIELDS`); until
 * then they are tracked here so this gate fails on *new* drift instead of
 * being red for old drift. Shrink this list — never grow it.
 */
const KNOWN_UNVALIDATED_FE_FIELDS: Record<string, string[]> = {
  // `EnterpriseInquiriesPage` convert-to-proposal, `EnterpriseProposalsPage`
  // convert-to-contract, `EnterpriseServiceContractsPage` convert-to-project.
  "ent-inq": ["proposalId", "proposalCode", "contractId", "contractCode", "projectId", "projectCode"],
  // `EnterpriseProposalsPage` stamps the contract it produced.
  "ent-proposals": ["contractId", "contractCode"],
  // `EnterpriseServiceContractsPage` stamps the project it produced. The
  // schema declares `propId` (upstream) but nothing downstream.
  "ent-svc-contracts": ["projectId"],
};

const declaredFields = (module: string): Set<string> | null => {
  const schema = BUSINESS_DATA_SCHEMAS[module];
  if (!schema) return null;
  return new Set(Object.keys((schema as unknown as { shape: Record<string, unknown> }).shape));
};

describe("FE/BE business module drift (SOF-47)", () => {
  it("reads the frontend tree — a scan that finds nothing would pass everything below", () => {
    expect(FRONTEND.keys.size).toBeGreaterThanOrEqual(30);
    expect(FRONTEND.posts.length).toBeGreaterThanOrEqual(20);
  });

  it("every FE-posted module key is either backend-registered or a tracked known gap", () => {
    const unregistered = [...FRONTEND.keys].filter((key) => !(key in BUSINESS_DATA_SCHEMAS));
    expect(new Set(unregistered)).toEqual(KNOWN_UNREGISTERED_FE_KEYS);
  });

  it("does not carry a known-gap entry that's actually already registered", () => {
    const stale = [...KNOWN_UNREGISTERED_FE_KEYS].filter((key) => key in BUSINESS_DATA_SCHEMAS);
    expect(stale).toEqual([]);
  });

  it("every field the frontend writes into `data` is declared by that module's schema", () => {
    const rejected: string[] = [];
    for (const post of FRONTEND.posts) {
      const declared = declaredFields(post.module);
      if (!declared) continue; // unregistered key — the key gate above owns that
      const tracked = KNOWN_UNVALIDATED_FE_FIELDS[post.module] ?? [];
      for (const field of post.fields) {
        if (declared.has(field) || tracked.includes(field)) continue;
        rejected.push(`${post.module}.${field} (${path.relative(FE, post.file)})`);
      }
    }
    expect([...new Set(rejected)].sort()).toEqual([]);
  });

  it("keeps the known-unvalidated field list honest", () => {
    const posted = new Set(FRONTEND.posts.flatMap((p) => p.fields.map((f) => `${p.module}.${f}`)));
    const entries = Object.entries(KNOWN_UNVALIDATED_FE_FIELDS);
    // Already fixed backend-side: the schema declares it now, so drop the entry.
    expect(entries.flatMap(([module, fields]) => {
      const declared = declaredFields(module);
      return declared ? fields.filter((f) => declared.has(f)).map((f) => `${module}.${f}`) : [];
    })).toEqual([]);
    // Already fixed frontend-side: nothing posts it any more, so drop the entry.
    expect(entries.flatMap(([module, fields]) =>
      fields.filter((f) => !posted.has(`${module}.${f}`)).map((f) => `${module}.${f}`))).toEqual([]);
  });
});
