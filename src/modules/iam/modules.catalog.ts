/**
 * The platform feature modules used by the Team Management permission grid. Each
 * key matches an AXIA module and a sidebar nav group; the label is the display
 * name shown in the permission checkboxes and permission summaries.
 *
 * OD `MODULES` (js/core.js:112-119), verbatim and in order.
 */
export interface ModuleDef {
  key: string;
  label: string;
}

export const MODULES: ModuleDef[] = [
  { key: "team", label: "Team Management" },
  { key: "partner", label: "Partner Management" },
  { key: "tenant", label: "Tenant Management" },
  { key: "framework", label: "Framework Management" },
  { key: "billing", label: "Billing Management" },
  { key: "ticket", label: "Ticket Management" },
];

const MODULE_KEYS = new Set(MODULES.map((m) => m.key));

/** True when `key` is a member of the module catalog above. */
export function isModuleKey(key: string): boolean {
  return MODULE_KEYS.has(key);
}

/* =========================================================================
 * Service Provider domain catalog — the menu map the Access Configuration
 * screen grants against. OD `acSections()` (js/core.js:4995) returns
 * `VIEWCFG().sp.sections` (js/core.js:2507-2548): nine sections, twenty-two
 * grantable menu keys. This is a different, finer axis than `MODULES` above —
 * OD derives the coarse module list from it via `acNavToModules`
 * (js/core.js:5003-5006).
 * ========================================================================= */

export interface SpMenuItem {
  k: string;
  label: string;
}
export interface SpSection {
  label: string;
  items: SpMenuItem[];
}

/** OD `VIEWCFG().sp.sections` (js/core.js:2507-2548) — labels and keys verbatim. */
export const SP_SECTIONS: SpSection[] = [
  { label: "Framework Implementation", items: [{ k: "svc-impl", label: "Framework Implementation" }] },
  { label: "Framework Audit", items: [{ k: "svc-audit", label: "Framework Audit" }] },
  { label: "Framework Assessment", items: [{ k: "svc-assess", label: "Framework Assessment" }] },
  {
    label: "Competence Development",
    items: [
      { k: "comp-leads", label: "Leads" },
      { k: "comp-inq", label: "Inquiries" },
      { k: "comp-prop", label: "Proposals" },
      { k: "comp-proj", label: "Projects" },
      { k: "comp-catalog", label: "Course Catalog" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { k: "partners", label: "Partner Management" },
      { k: "sp-agreements", label: "Partnership Agreements" },
      { k: "sp-billing", label: "Billing Management" },
    ],
  },
  {
    label: "Tenants",
    items: [
      { k: "sp-treq", label: "Tenant Requests" },
      { k: "sp-tenants", label: "Tenants" },
      { k: "sp-subs", label: "Subscriptions" },
    ],
  },
  {
    label: "Framework",
    items: [
      { k: "elements", label: "Element Library" },
      { k: "frameworks", label: "Framework Library" },
      { k: "req-library", label: "Requirement Library" },
      { k: "sp-scopedata", label: "Scope Datasets" },
    ],
  },
  {
    label: "Cross References",
    items: [
      { k: "xref", label: "Element → Requirement" },
      { k: "rcmap", label: "Response → Criteria" },
    ],
  },
  {
    label: "Support",
    items: [
      { k: "kb", label: "Knowledge Base" },
      { k: "sp-tickets", label: "Ticket Management" },
    ],
  },
];

/** OD `acAllKeys()` (js/core.js:4996) — flattened in section order. */
export const SP_ALL_KEYS: string[] = SP_SECTIONS.flatMap((s) => s.items.map((it) => it.k));

const SP_KEY_SET = new Set(SP_ALL_KEYS);

/** True when `key` is a grantable Service Provider menu key (`acAllKeys()` member). */
export function isSpMenuKey(key: string): boolean {
  return SP_KEY_SET.has(key);
}

/**
 * OD `acPreset` (js/core.js:4997-5002) — the menu-key set a role group is fixed
 * to. Only 'Administrator' is operator-configurable; every other group's grant
 * is derived from the group alone. Note `org-profile`: it is a grantable menu
 * key that `acSections()` does not list, so it is a legal `navPerms` member
 * without being an `acAllKeys()` member.
 */
export function acPreset(roleGroup: string): string[] {
  if (roleGroup === "Administrator") return [...SP_ALL_KEYS];
  if (roleGroup === "Billing Manager") return ["org-profile", "sp-billing", "sp-subs"];
  if (roleGroup === "Technical Support") return ["org-profile", "sp-tickets", "kb"];
  return ["org-profile"]; /* Basic User — profile only */
}

const NAV_PERM_KEY_SET = new Set([...SP_ALL_KEYS, "org-profile"]);

/**
 * True when `key` may be persisted in `navPerms`. Wider than `isSpMenuKey` by
 * exactly one member — `acPreset` writes 'org-profile' for every group but
 * Administrator, and `acSave` (js/core.js:5225) persists that set verbatim.
 */
export function isNavPermKey(key: string): boolean {
  return NAV_PERM_KEY_SET.has(key);
}

/** OD `acNavToModules` (js/core.js:5003-5006) — menu keys → the coarse module ids. */
const NAV_TO_MODULE: Record<string, string> = {
  team: "team", partners: "partner", "sp-agreements": "partner", "sp-treq": "tenant",
  "sp-tenants": "tenant", "sp-subs": "tenant", elements: "framework", frameworks: "framework",
  "req-library": "framework", "sp-scopedata": "framework", xref: "framework", rcmap: "framework",
  "sp-billing": "billing", "sp-tickets": "ticket", kb: "ticket",
};

export function acNavToModules(keys: readonly string[]): string[] {
  const set: Record<string, 1> = {};
  for (const k of keys) {
    const m = NAV_TO_MODULE[k];
    if (m) set[m] = 1;
  }
  return Object.keys(set);
}

/* =========================================================================
 * Enterprise (system of record) and AXIA operating-unit catalogs. Both are
 * grant axes independent of the Service Provider menu map above, and both are
 * closed sets in OD — `acSave` only ever writes members of them.
 * ========================================================================= */

/** OD `acEntAllKeys()` (js/core.js:5020) over `ENT_TREE` (js/core.js:2793-2803), in tree order. */
export const ENT_ALL_KEYS: string[] = [
  "ent-tasks", "ent-myreq",
  "ent-org-profile", "ent-team",
  "ent-leads", "ent-inq", "ent-proposals", "ent-mkt", "ent-svc-ctypes", "ent-svc-clauses",
  "ent-orgstructure", "ent-emplevels", "ent-recruitment", "ent-personnel", "ent-roles",
  "ent-ctypes", "ent-clauses", "ent-complib", "ent-instruments", "ent-assess",
  "ent-comp", "ent-payroll", "ent-ss", "ent-minwage", "ent-disc",
  "ent-suppliers", "ent-pr", "ent-po", "ent-doa", "ent-sup-ctypes", "ent-sup-clauses", "ent-assets",
  "ent-accounting",
  "ent-conformance", "ent-compliance", "ent-audits",
  "kb", "ent-tickets",
  "ent-db-countries", "ent-banks", "ent-holidays", "ent-fiscal", "ent-db-edu",
  "ent-db-sectors", "ent-db-frameworks", "ent-bpcatalog", "ent-db-courses", "ent-db-edufields",
];

const ENT_KEY_SET = new Set(ENT_ALL_KEYS);

/** True when `key` is a grantable Enterprise menu key (`acEntAllKeys()` member). */
export function isEntKey(key: string): boolean {
  return ENT_KEY_SET.has(key);
}

export interface AcUnit {
  key: string;
  /** OD `AC_UNITS[].items` keys — `acUnitKeys(unit)` (js/core.js:5052). */
  items: string[];
}

/** OD `AC_UNITS` (js/core.js:5041-5048) — keys and item keys verbatim, in order. */
export const AC_UNITS: AcUnit[] = [
  { key: "lims", items: ["lims-samples", "lims-tests", "lims-methods", "lims-results", "lims-reports"] },
  { key: "atr", items: ["atr-courses", "atr-schedule", "atr-learners", "atr-certs"] },
  { key: "acert", items: ["acert-schemes", "acert-candidates", "acert-exams", "acert-decisions"] },
  { key: "abizc", items: ["abizc-clients", "abizc-engage", "abizc-assess", "abizc-reports"] },
  { key: "datana", items: ["dn-pentest", "dn-software", "dn-clients"] },
  { key: "motoran", items: ["mb-vehicle", "mb-fleet", "mb-booking", "mb-rental", "mb-support"] },
];

const UNIT_BY_KEY = new Map(AC_UNITS.map((u) => [u.key, u]));

/** True when `key` is one of the six AXIA operating units. */
export function isUnitKey(key: string): boolean {
  return UNIT_BY_KEY.has(key);
}

/** OD `acUnitKeys(key)` (js/core.js:5052) — one unit's own item keys; [] for an unknown unit. */
export function acUnitKeys(unitKey: string): string[] {
  return UNIT_BY_KEY.get(unitKey)?.items ?? [];
}
