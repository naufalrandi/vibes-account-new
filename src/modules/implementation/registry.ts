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
}

export const MS_MODULES: Record<string, RegisterModule> = {
  // --- Context & planning (clause 4–6) ---
  context: { prefix: "OCX", statuses: ["Open", "Monitored", "Dismissed", "Archived"] },
  parties: { prefix: "IPX", statuses: ["Active", "Under Review", "Archived"] },
  scope: { prefix: "SCP", statuses: ["Draft", "Active", "Archived"] },
  processes: { prefix: "PRC", statuses: ["Draft", "Active", "Archived"] },
  "work-units": { prefix: "WKU", statuses: ["Applicable", "Inapplicable", "Archived"] },
  // Risk lifecycle mirrors the OD prototype (renderTnRisk): raised risks land at
  // "Pending Assessment", then assess → Assessed/Treated/Monitored, and archive.
  risks: { prefix: "RSK", statuses: ["Pending Assessment", "Assessed", "Treated", "Monitored", "Archived"] },
  objectives: { prefix: "OBJ", statuses: ["Draft", "Active", "Achieved", "On Hold", "Closed"] },
  compliance: { prefix: "COM", statuses: ["Active", "Completed", "On Hold", "Waived"] },

  // --- Leadership & support (clause 5, 7) ---
  policies: { prefix: "POL", deep: true, statuses: ["Draft", "Under Review", "Pending Final Approval", "Approved", "Published", "Needs Revision", "Superseded", "Archived"] },
  training: { prefix: "TRN", statuses: ["Planned", "In Progress", "Completed", "Overdue"] },
  // OD models awareness as three tiers (db.awPrograms / awTopics / awCampaigns).
  // Each tier gets its own register entry so it inherits the same code
  // sequence, activity log and permission gating as every other module.
  awareness: { prefix: "AWR", statuses: ["Draft", "Planned", "Active", "Completed", "Under Review", "Archived"] },
  "awareness-topics": { prefix: "AWT", statuses: ["Draft", "Active", "Inactive", "Archived"] },
  "awareness-campaigns": { prefix: "AWC", statuses: ["Draft", "Scheduled", "Active", "Completed", "Partially Completed", "Overdue", "Archived"] },
  competence: { prefix: "CMP", statuses: ["Competent", "In Training", "Needs Refresher", "Expired"] },
  documents: { prefix: "DOC", statuses: ["Draft", "Under Review", "Revision Requested", "Approved", "Published", "Review Due", "Superseded", "Obsolete", "Archived", "Rejected"] },
  // External documents carry OD's own status vocabulary (ED_STATUS) — they are
  // externally issued, so "Draft" never applies to them.
  records: { prefix: "EXT", statuses: ["Active", "Under Review", "Updated Version Available", "Superseded", "Obsolete", "Archived"] },
  // Folders for the external-document explorer (OD `db.edFolders`).
  "record-folders": { prefix: "EDF", statuses: ["Active", "Archived"] },

  // --- Operation (clause 8) ---
  controls: { prefix: "CTL", statuses: ["Draft", "Active", "Retired"] },
  suppliers: { prefix: "SUP", statuses: ["Active", "Under Review", "Suspended", "Archived"] },

  // --- Performance & improvement (clause 9, 10) ---
  performance: { prefix: "PRF", statuses: ["Draft", "Active", "Achieved", "At Risk", "Closed"] },
  audits: { prefix: "AUD", deep: true, statuses: ["Planned", "In Progress", "Completed", "Closed"] },
  reviews: { prefix: "MRV", deep: true, statuses: ["Draft", "Scheduled", "In Progress", "Pending Outputs", "Completed", "Finalized", "Cancelled", "Archived"] },
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
  if (module !== "risks") return data;
  const score = (Number(data.likelihood) || 0) * (Number(data.impact) || 0);
  const level = score === 0 ? "" : (RISK_BANDS.find((b) => score <= b.max)?.level ?? "Critical");
  return { ...data, riskScore: score, riskLevel: level };
}
