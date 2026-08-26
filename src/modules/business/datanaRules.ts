/**
 * Server-side field-level typing/validation for the Datana business area (`datana/dn-*`),
 * wired into `createBusiness`/`updateBusiness` the same conditional-by-module way
 * `assertValidInquiryData`/`assertValidProposalData` are scoped to their own modules
 * (business.service.ts). Datana is a cybersecurity-pentest + software-delivery engine sitting
 * on the same generic `BusinessRecord` blob storage every other business area uses — per this
 * codebase's established precedent (`inquiryRules.ts`, `proposalRules.ts`), field shapes are
 * enforced by a typed validator layered on top of the JSONB `data` column, not by dedicated
 * Sequelize models.
 *
 * Field shapes and vocabularies below are sourced from OD's `js/datana.js` (the module that
 * actually seeds/renders/edits `db.dnClients/dnEngagements/dnFindings/dnProjects/dnBacklog`) —
 * `dnSeedIfNeeded` (datana.js:12-48) for the seeded shape, `dnEngForm`/`dnFindingForm`/
 * `dnProjForm`/`dnBacklogForm` (datana.js:112-194) for the editable fields and their `<select>`
 * option lists (the enums below).
 *
 * No stage-machine / transition graph is implemented for any of the five modules: unlike the
 * Business Unit modules that DO get one in `prLifecycle.ts` (`ent-pr`, `ent-po`, `ent-inq`,
 * `ent-proposals`, `ent-projects` — each driven by an OD `*Actions`/`*Set` function that offers
 * only specific next-status buttons per current status), every Datana status field
 * (`dnEngForm`'s `pe-st`, `dnFindingForm`'s `vf-st`, `dnProjForm`'s `sp-st`,
 * `dnBacklogForm`'s `bl-st`) is a plain `<select>` listing every value with no per-status
 * filtering and no dedicated "advance status" action function anywhere in datana.js — so this
 * is a real design-source gap-check, not an oversight: there is nothing to port. Similarly, CVSS
 * (`dnFindingForm`'s `vf-cvss`) is a free-typed number next to `severity`, never derived from it
 * or vice versa (`dnSevBadge`, datana.js:9, only maps severity → a display color) — no severity
 * scoring logic exists to port either.
 */
import { BadRequestError } from "../../lib/errors";

export const DN_CLIENTS = "dn-clients";
export const DN_ENGAGEMENTS = "dn-engagements";
export const DN_FINDINGS = "dn-findings";
export const DN_PROJECTS = "dn-projects";
export const DN_BACKLOG = "dn-backlog";

/** The five Datana modules this validator covers — every other `datana/*` module (e.g. the
 *  pre-existing generic `dn-pentest` exercised by `business.integration.test.ts`) is left
 *  untouched, exactly as every non-listed `enterprise/*` module is untouched by the sibling
 *  rules files. */
export const DATANA_MODULES = [DN_CLIENTS, DN_ENGAGEMENTS, DN_FINDINGS, DN_PROJECTS, DN_BACKLOG] as const;
export type DatanaModule = typeof DATANA_MODULES[number];

export function isDatanaModule(module: string): module is DatanaModule {
  return (DATANA_MODULES as readonly string[]).includes(module);
}

/** OD `dnEngForm`'s `pe-type` options (datana.js:116). */
export const DN_TEST_TYPES = ["Web App", "Network", "Mobile / API", "Cloud", "Wireless", "Red Team"] as const;
/** OD `dnEngForm`'s `pe-st` options (datana.js:117). */
export const DN_ENGAGEMENT_STATUSES = ["Scoping", "Testing", "Reporting", "Retest", "Closed"] as const;
/** OD `dnFindingForm`'s `vf-sev` options (datana.js:127). */
export const DN_SEVERITIES = ["Critical", "High", "Medium", "Low", "Info"] as const;
/** OD `dnFindingForm`'s `vf-st` options (datana.js:131). */
export const DN_FINDING_STATUSES = ["Open", "Fixed", "Retested", "Accepted"] as const;
/** OD `dnProjForm`'s `sp-type` options (datana.js:174). */
export const DN_PROJECT_TYPES = ["Web", "Mobile", "Custom", "API", "Data"] as const;
/** OD `dnProjForm`'s `sp-st` options (datana.js:177). */
export const DN_PROJECT_STATUSES = ["Discovery", "Build", "UAT", "Live", "Maintenance"] as const;
/** OD `dnBacklogForm`'s `bl-kind` options (datana.js:187). */
export const DN_BACKLOG_KINDS = ["Feature", "Bug", "Task"] as const;
/** OD `dnBacklogForm`'s `bl-pri` options (datana.js:188). */
export const DN_BACKLOG_PRIORITIES = ["High", "Medium", "Low"] as const;
/** OD `dnBacklogForm`'s `bl-st` options (datana.js:189). */
export const DN_BACKLOG_STATUSES = ["Todo", "In Progress", "Done"] as const;

/** The record's own top-level `status` vocabulary, per module — enforced in `business.service.ts`
 *  (top-level `status`, unlike everything else here which lives in `data`). `dn-clients` has no
 *  status editor in OD (`dnClientForm` never surfaces one) so it is intentionally absent — any
 *  status is accepted for that module, same as any module with no entry here. */
export const DN_STATUSES: Partial<Record<DatanaModule, readonly string[]>> = {
  [DN_ENGAGEMENTS]: DN_ENGAGEMENT_STATUSES,
  [DN_FINDINGS]: DN_FINDING_STATUSES,
  [DN_PROJECTS]: DN_PROJECT_STATUSES,
  [DN_BACKLOG]: DN_BACKLOG_STATUSES,
};

/** OD's own default `status` per module when a record is first created (`dnSeedIfNeeded`'s seed
 *  literals / each form's `onOk` fallback — `dnEngForm`: `'Scoping'`, `dnFindingForm`: `'Open'`,
 *  `dnProjForm`: `'Discovery'`, `dnBacklogForm`: `'Todo'`) — used in place of the generic
 *  `BusinessRecord` default of `"Open"`, which is only coincidentally valid for `dn-findings`. */
export const DN_DEFAULT_STATUS: Partial<Record<DatanaModule, string>> = {
  [DN_ENGAGEMENTS]: "Scoping",
  [DN_FINDINGS]: "Open",
  [DN_PROJECTS]: "Discovery",
  [DN_BACKLOG]: "Todo",
};

export function datanaDefaultStatus(module: string): string | undefined {
  return isDatanaModule(module) ? DN_DEFAULT_STATUS[module] : undefined;
}

/** Enforces the module's own status vocabulary (no transition graph — see file header). No-op for
 *  `dn-clients` and any module without an entry above, mirroring `assertBusinessTransition`'s
 *  "no registered graph → any status accepted" fallback. */
export function assertValidDatanaStatus(module: string, status: string): void {
  if (!isDatanaModule(module)) return;
  const allowed = DN_STATUSES[module];
  if (!allowed) return;
  if (!allowed.includes(status)) {
    throw new BadRequestError(`Unknown ${module} status: ${status}`, "INVALID_STATUS");
  }
}

function str(d: Record<string, unknown>, key: string): string {
  return String(d[key] ?? "").trim();
}

function assertEnum(value: string, allowed: readonly string[], field: string, code: string): void {
  if (value !== "" && !allowed.includes(value)) {
    throw new BadRequestError(`Unknown ${field}: ${value}`, code);
  }
}

/**
 * Validates and normalizes a Datana record's `data` blob for the given module. Mirrors
 * `assertValidProposalData`'s shape: called unconditionally on the full (post-merge) `data`
 * object on both create and update, so a record can never end up with an invalid/missing
 * required reference regardless of which fields a given PATCH actually touched. Returns the
 * (possibly unmodified) data — callers must write the return value back, never trust the
 * caller's original object was already normalized.
 *
 * No-ops for any module not in `DATANA_MODULES` (defensive — callers only invoke this for the
 * five listed modules).
 */
export function assertValidDatanaData(module: string, data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!isDatanaModule(module)) return data ?? {};
  const d = data ?? {};

  switch (module) {
    case DN_CLIENTS: {
      // No enum fields — `industry`/`country`/`contact` are OD free-text inputs
      // (`dnClientForm`, datana.js:70-71). Just typed as strings.
      return { ...d, industry: str(d, "industry"), country: str(d, "country"), contact: str(d, "contact") };
    }
    case DN_ENGAGEMENTS: {
      const clientId = str(d, "clientId");
      if (!clientId) throw new BadRequestError("Engagement client is required", "CLIENT_ID_REQUIRED");
      const testType = str(d, "testType");
      assertEnum(testType, DN_TEST_TYPES, "engagement test type", "INVALID_TEST_TYPE");
      return { ...d, clientId, testType: testType || "Web App", scope: str(d, "scope") };
    }
    case DN_FINDINGS: {
      const engagementId = str(d, "engagementId");
      if (!engagementId) throw new BadRequestError("Finding engagement is required", "ENGAGEMENT_ID_REQUIRED");
      const severity = str(d, "severity");
      assertEnum(severity, DN_SEVERITIES, "finding severity", "INVALID_SEVERITY");
      const cvss = d.cvss === undefined || d.cvss === "" ? 0 : Number(d.cvss);
      if (!Number.isFinite(cvss) || cvss < 0 || cvss > 10) {
        throw new BadRequestError("CVSS must be between 0 and 10", "INVALID_CVSS");
      }
      return { ...d, engagementId, severity: severity || "Medium", cvss, category: str(d, "category"), asset: str(d, "asset") };
    }
    case DN_PROJECTS: {
      const clientId = str(d, "clientId");
      if (!clientId) throw new BadRequestError("Project client is required", "CLIENT_ID_REQUIRED");
      const type = str(d, "type");
      assertEnum(type, DN_PROJECT_TYPES, "project type", "INVALID_PROJECT_TYPE");
      const progress = d.progress === undefined || d.progress === "" ? 0 : Number(d.progress);
      if (!Number.isFinite(progress)) throw new BadRequestError("Progress must be a number", "INVALID_PROGRESS");
      // `dnProjForm`'s onOk clamps to [0,100] rather than rejecting out-of-range input (datana.js:179-180).
      const clamped = Math.max(0, Math.min(100, progress));
      return { ...d, clientId, type: type || "Web", stack: str(d, "stack"), progress: clamped };
    }
    case DN_BACKLOG: {
      const projectId = str(d, "projectId");
      if (!projectId) throw new BadRequestError("Backlog item project is required", "PROJECT_ID_REQUIRED");
      const kind = str(d, "kind");
      assertEnum(kind, DN_BACKLOG_KINDS, "backlog item kind", "INVALID_KIND");
      const priority = str(d, "priority");
      assertEnum(priority, DN_BACKLOG_PRIORITIES, "backlog item priority", "INVALID_PRIORITY");
      return { ...d, projectId, kind: kind || "Feature", priority: priority || "Medium" };
    }
    default:
      return d;
  }
}
