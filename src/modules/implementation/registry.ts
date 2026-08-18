/**
 * The ISO clause-register catalog. Each `tn-m-*` module shares one table
 * (`implementation_records`); this registry parameterizes per module: the code
 * prefix, the allowed status set (server-validated), and the default status.
 * Status enums mirror the legacy constants (POL_STATUS, MR_STATUS, WU_STATUS…).
 */
export interface RegisterModule {
  prefix: string;
  statuses: string[];
  /** Deep modules enforce a transition graph; generic modules accept any status in the set. */
  deep?: boolean;
  /** The transition graph a deep module enforces (current status → legal next statuses). */
  transitions?: Record<string, readonly string[]>;
  /** Statuses a record may be created at (defaults to any status in the set). */
  createStatuses?: readonly string[];
}

/**
 * OD Management Review lifecycle graph, assembled from `mrMenu` (index.html
 * 10985–11000) plus its handlers: Draft ⇄ Scheduled (`mrSave`), Draft/Scheduled
 * → In Progress (auto on `mrRecordSave` 11186), In Progress ⇄ Pending Outputs,
 * either → Completed (`mrComplete` 10995), Completed → Finalized (`mrFinalize`
 * 10996), any pre-Completed → Cancelled with a mandatory reason (`mrCancel`
 * 10997), anything not archived → Archived (`mrArchive` 11000). Illegal jumps
 * (e.g. Draft → Finalized) are rejected in `updateRecord`.
 */
export const MR_TRANSITIONS: Record<string, readonly string[]> = {
  Draft: ["Scheduled", "In Progress", "Cancelled", "Archived"],
  Scheduled: ["Draft", "In Progress", "Cancelled", "Archived"],
  "In Progress": ["Pending Outputs", "Completed", "Cancelled", "Archived"],
  "Pending Outputs": ["In Progress", "Completed", "Cancelled", "Archived"],
  Completed: ["Finalized", "Archived"],
  Finalized: ["Archived"],
  Cancelled: ["Archived"],
  Archived: [],
};

export const MS_MODULES: Record<string, RegisterModule> = {
  // --- Context & planning (clause 4–6) ---
  context: { prefix: "OCX", statuses: ["Open", "Monitored", "Dismissed", "Archived"] },
  parties: { prefix: "IPX", statuses: ["Active", "Under Review", "Archived"] },
  // NOTE: no `scope` register here — Management System Scope is the dedicated
  // 6-dimension document module (src/modules/scope), not a clause register.
  // The old duplicate register (S12) was removed; /implementation/scope now
  // falls through the unknown-module handling.
  processes: { prefix: "PRC", statuses: ["Draft", "Active", "Archived"] },
  "work-units": { prefix: "WKU", statuses: ["Applicable", "Inapplicable", "Archived"] },
  // Risk lifecycle mirrors the OD prototype (renderTnRisk): raised risks land at
  // "Pending Assessment", then assess → Assessed/Treated/Monitored, and archive.
  risks: { prefix: "RSK", statuses: ["Pending Assessment", "Assessed", "Treated", "Monitored", "Archived"] },
  objectives: { prefix: "OBJ", statuses: ["Draft", "Active", "Achieved", "On Hold", "Closed"] },
  // OD `renderTnObligations` (index.html:9035): Active/Under Review/Archived —
  // legacy "COM-" codes already issued under the old prefix keep resolving
  // (codes are never renamed retroactively); only new records get "COBL-".
  compliance: { prefix: "COBL", statuses: ["Active", "Under Review", "Archived"] },

  // --- Leadership & support (clause 5, 7) ---
  policies: { prefix: "POL", deep: true, statuses: ["Draft", "Under Review", "Pending Final Approval", "Approved", "Published", "Needs Revision", "Superseded", "Archived"] },
  training: { prefix: "TRN", statuses: ["Planned", "In Progress", "Completed", "Overdue"] },
  // OD models awareness as three tiers (db.awPrograms / awTopics / awCampaigns).
  // Each tier gets its own register entry so it inherits the same code
  // sequence, activity log and permission gating as every other module.
  awareness: { prefix: "AWR", statuses: ["Draft", "Planned", "Active", "Completed", "Under Review", "Archived"] },
  "awareness-topics": { prefix: "AWT", statuses: ["Draft", "Active", "Inactive", "Archived"] },
  "awareness-campaigns": { prefix: "AWC", statuses: ["Draft", "Scheduled", "Active", "Completed", "Partially Completed", "Overdue", "Archived"] },
  // NOTE: no `competence` register here — OD has no such register (its
  // `'tn-m-competence'` route redirects to the real Competence/Assessments
  // area, index.html:8079); the duplicate orphan register was removed and
  // `/implementation/competence` now falls through the unknown-module handling.
  // CD_STATUS (10, exact order) plus "Active": OD stores External Documents at
  // status "Active" (cdocSeedIfNeeded, cdBadge/cdCards treat it as published-
  // grade) even though it is not part of the CD_STATUS dropdown vocabulary.
  documents: { prefix: "DOC", statuses: ["Draft", "Under Review", "Revision Requested", "Approved", "Published", "Review Due", "Superseded", "Obsolete", "Archived", "Rejected", "Active"] },
  // External documents carry OD's own status vocabulary (ED_STATUS) — they are
  // externally issued, so "Draft" never applies to them.
  records: { prefix: "EXT", statuses: ["Active", "Under Review", "Updated Version Available", "Superseded", "Obsolete", "Archived"] },
  // Folders for the external-document explorer (OD `db.edFolders`) — folder
  // statuses include "Inactive" (OD ED_FOLDER_STATUS, 13008).
  "record-folders": { prefix: "EDF", statuses: ["Active", "Inactive", "Archived"] },

  // --- Operation (clause 8) ---
  controls: { prefix: "CTL", statuses: ["Draft", "Active", "Retired"] },
  suppliers: { prefix: "SUP", statuses: ["Active", "Under Review", "Suspended", "Archived"] },

  // --- Performance & improvement (clause 9, 10) ---
  performance: { prefix: "PRF", statuses: ["Draft", "Active", "Achieved", "At Risk", "Closed"] },
  // NOTE: no `audits` register here — the real Internal Audit module is the
  // dedicated `/internal-audit` surface (src/modules/internal-audit), not a
  // clause register; the duplicate orphan register was removed and
  // `/implementation/audits` now falls through the unknown-module handling.
  // OD `mrSave`: a review is born Draft or Scheduled; every later status is a
  // lifecycle transition enforced through MR_TRANSITIONS.
  reviews: { prefix: "MRV", deep: true, transitions: MR_TRANSITIONS, createStatuses: ["Draft", "Scheduled"], statuses: ["Draft", "Scheduled", "In Progress", "Pending Outputs", "Completed", "Finalized", "Cancelled", "Archived"] },
  nonconformities: { prefix: "NCR", statuses: ["Open", "CAP Required", "CAP Planned", "In Progress", "Pending Effectiveness Check", "Closed", "Cancelled", "Archived"] },
  improvements: { prefix: "IMP", statuses: ["Open", "Under Review", "Planned", "In Progress", "Implemented", "Completed", "Deferred", "Cancelled", "Archived"] },
  concerns: { prefix: "CNC", statuses: ["Draft", "Submitted", "Under Review", "Routed", "Closed", "Cancelled", "Archived"] },
  incidents: { prefix: "INC", statuses: ["Open", "Under Investigation", "Contained", "Action Required", "In Progress", "Resolved", "Closed", "Cancelled", "Archived"] },

  // --- ISO 9001 extensions (gated in the UI behind an ISO 9001 assignment) ---
  "customer-focus": { prefix: "CFO", statuses: ["Open", "In Progress", "Closed"] },
  "customer-satisfaction": { prefix: "CST", statuses: ["Planned", "Collecting", "Analyzed", "Closed"] },
  psr: { prefix: "PSR", statuses: ["Draft", "Reviewed", "Approved", "Archived"] },
  design: { prefix: "DSG", statuses: ["Planning", "In Progress", "Verification", "Validation", "Complete"] },
  provision: { prefix: "PRV", statuses: ["Draft", "Active", "Controlled", "Archived"] },
};

export type MsModuleKey = keyof typeof MS_MODULES;

export function isMsModule(key: string): key is MsModuleKey {
  return Object.prototype.hasOwnProperty.call(MS_MODULES, key);
}

const RISK_BANDS: { max: number; level: string }[] = [
  { max: 3, level: "Negligible" }, { max: 6, level: "Minor" }, { max: 12, level: "Moderate" }, { max: 18, level: "Major" }, { max: 25, level: "Critical" },
];

/** Module-specific derived fields (mirrors the frontend's `enrichImpl`). */
export function enrichData(module: string, data: Record<string, unknown>): Record<string, unknown> {
  if (module === "reviews") return enrichReviewData(data);
  if (module !== "risks") return data;
  const score = (Number(data.likelihood) || 0) * (Number(data.impact) || 0);
  const level = score === 0 ? "" : (RISK_BANDS.find((b) => score <= b.max)?.level ?? "Critical");
  return { ...data, riskScore: score, riskLevel: level };
}

/**
 * OD `mrWhen` / `mrOpenDecisions` / `mrOpenActions`: the register's Scheduled /
 * Topics / Open-dec / Open-act cells are derived from the nested agenda, the
 * same way risks derive `riskScore` — computed here so every client renders
 * identical values.
 */
export function enrichReviewData(data: Record<string, unknown>): Record<string, unknown> {
  const topics = Array.isArray(data.topics) ? (data.topics as Record<string, unknown>[]) : [];
  const date = typeof data.date === "string" ? data.date : "";
  const time = typeof data.time === "string" ? data.time : "";
  const openDecisions = topics.filter((t) =>
    ["Action Required", "In Progress", "Deferred", "Escalated"].includes(String(t.decisionStatus)),
  ).length;
  const openActions = topics.filter((t) => {
    const action = t.action as Record<string, unknown> | null | undefined;
    return Boolean(action) && !["Completed", "Cancelled"].includes(String(action?.status));
  }).length;
  return {
    ...data,
    scheduled: date ? (time ? `${date} · ${time}` : date) : "",
    topicsCount: topics.length,
    openDecisions,
    openActions,
  };
}
