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
