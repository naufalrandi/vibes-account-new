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
  /**
   * Statuses a record may be created at (defaults to any status in the set).
   * `createStatuses[0]`, when present, is also the silent create-time default
   * used by `createRecord` in place of `statuses[0]` — so a module can order
   * `statuses` however it needs to (e.g. for display, or because the array's
   * order is itself asserted elsewhere) without that order dictating what an
   * omitted-status create lands on. `reviews` uses this field as a full
   * create-time allow-list too (`assertReviewCreateStatus`); other modules
   * (e.g. `cab-clients`) use only `[0]` as the default and still accept any
   * `statuses` member when a status is given explicitly.
   */
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

/**
 * OD Training Plan vocabulary (index.html:13933–13938) — the register's
 * source/type/delivery/priority/result dropdowns, validated server-side by
 * trainingLifecycle.ts's `assertTrainingVocab` and served to clients.
 */
export const TP_SOURCES = [
  "Competence Gap", "Manual", "Internal Audit Finding", "Management Review Output",
  "Nonconformity / Corrective Action", "Incident Follow-up", "Policy / Document Change",
  "Compliance Obligation", "Onboarding", "Other",
] as const;
export const TP_TYPES = [
  "Awareness Training", "Technical Training", "Management System Training", "Internal Audit Training",
  "Role-based Training", "Compliance Training", "Safety Training", "Security Training", "Privacy Training",
  "Onboarding Training", "Refresher Training", "Certification Training", "Mentoring / Coaching",
  "Practical Assignment", "Work Output Review", "Other",
] as const;
export const TP_DELIVERY = [
  "Classroom", "Online", "Self-paced", "On-the-job training", "Mentoring", "Coaching", "Workshop",
  "Practical observation", "External training", "Internal briefing", "Work assignment", "Other",
] as const;
export const TP_PRIORITY = ["Low", "Medium", "High", "Urgent"] as const;
export const TP_RESULTS = ["Completed", "Partially Completed", "Not Completed", "Failed", "Waived"] as const;
/** OD's exact 8-value status vocabulary (index.html:13936). "Overdue" is never a member — it's derived. */
export const TP_STATUS = [
  "Draft", "Planned", "Scheduled", "In Progress", "Completed", "Pending Reassessment", "Closed", "Cancelled",
] as const;

export const MS_MODULES: Record<string, RegisterModule> = {
  // --- Context & planning (clause 4–6) ---
  // Context's real code prefix is DYNAMIC (OD `ocFweCode`/`ocNewId`,
  // index.html:8119–8120): `<code of the "Organizational Context" FWE
  // element>-<n>`, unpadded. The static "OCX" below is an inert placeholder
  // (RegisterModule.prefix is required) — `contextCode()` in
  // implementation.service.ts bypasses it entirely and computes the real
  // prefix from the FrameworkElement catalog, the same way documents/policies
  // bypass `nextCode()` for their own dynamic codes.
  context: { prefix: "OCX", statuses: ["Open", "Monitored", "Dismissed", "Archived"] },
  // `parties` / `work-units` below are orphaned duplicate registrations — the
  // real Interested Parties and Work Units registers live in their own
  // modules (src/modules/interested-parties, src/modules/work-units), which
  // already mint "IP-"/"WU-" codes independently of this registry and never
  // write through it. Kept in sync here only so a stray `implementation_records`
  // row under these module keys (if any ever existed) numbers consistently;
  // this has no effect on the live Parties/Work Units features.
  parties: { prefix: "IP", statuses: ["Active", "Under Review", "Archived"] },
  // NOTE: no `scope` register here — Management System Scope is the dedicated
  // 6-dimension document module (src/modules/scope), not a clause register.
  // The old duplicate register (S12) was removed; /implementation/scope now
  // falls through the unknown-module handling.
  processes: { prefix: "BP", statuses: ["Active", "Inactive", "Archived"] },
  "work-units": { prefix: "WU", statuses: ["Applicable", "Inapplicable", "Archived"] },
  // OD `renderTnRisk`: 10 workflow statuses, 4-digit RISK-nnnn id. "Archived"
  // (P-6.1/D-1) is appended last so statuses[0] ("Unassigned", the silent
  // create default) is unchanged. OD's `riskArchive()` offers it only from
  // "Monitored" and treats it as terminal (app.html:12365-12366, 14002);
  // that transition rule is enforced in code by `assertRiskArchivable`
  // (implementation.service.ts), not by a `transitions` graph here — `risks`
  // has never carried one, so this registry entry stays a flat status set.
  risks: {
    prefix: "RISK",
    statuses: [
      "Unassigned",
      "Assigned",
      "RTP Draft",
      "Pending Approval",
      "Pending TM Approval",
      "In Treatment",
      "Assessed",
      "Treated",
      "Monitored",
      "Archived",
    ],
  },
  objectives: { prefix: "OBJ", statuses: ["Open", "Achieved", "Cancelled"] },
  // OD `renderTnObligations` (index.html:9035): Active/Under Review/Archived —
  // legacy "COM-" codes already issued under the old prefix keep resolving
  // (codes are never renamed retroactively); only new records get "COBL-".
  compliance: { prefix: "COBL", statuses: ["Active", "Under Review", "Archived"] },

  // --- Leadership & support (clause 5, 7) ---
  policies: { prefix: "POL", deep: true, statuses: ["Draft", "Under Review", "Pending Final Approval", "Approved", "Published", "Needs Revision", "Superseded", "Archived"] },
  // OD `tpForm`/`compNewId` (Training Plan region):
  // codes are "TP-nnnn". TP_STATUS is OD's exact 8-value vocabulary.
  training: { prefix: "TP", statuses: [...TP_STATUS] },
  awareness: { prefix: "AWP", statuses: ["Draft", "Planned", "Active", "Completed", "Under Review", "Archived"] },
  "awareness-topics": { prefix: "AWT", statuses: ["Draft", "Active", "Inactive", "Archived"] },
  "awareness-campaigns": { prefix: "AWC", statuses: ["Draft", "Scheduled", "Active", "Completed", "Partially Completed", "Overdue", "Archived"] },
  // CD_STATUS (10 values, exact OD order).
  documents: { prefix: "DOC", statuses: ["Draft", "Under Review", "Revision Requested", "Approved", "Published", "Review Due", "Superseded", "Obsolete", "Archived", "Rejected"] },
  records: { prefix: "EXT", statuses: ["Active", "Under Review", "Updated Version Available", "Superseded", "Obsolete", "Archived"] },
  "record-folders": { prefix: "EDF", statuses: ["Active", "Inactive", "Archived"] },

  // --- Operation (clause 8) ---
  suppliers: { prefix: "SUP", statuses: ["Pending Qualification", "Approved", "Suspended", "Rejected"] },

  // --- Performance & improvement (clause 9, 10) ---
  performance: { prefix: "PEV", statuses: ["Draft", "Active", "Achieved", "At Risk", "Closed"] },
  reviews: { prefix: "MR", deep: true, transitions: MR_TRANSITIONS, createStatuses: ["Draft", "Scheduled"], statuses: ["Draft", "Scheduled", "In Progress", "Pending Outputs", "Completed", "Finalized", "Cancelled", "Archived"] },
  nonconformities: { prefix: "NC", statuses: ["Open", "CAP Required", "CAP Planned", "In Progress", "Pending Effectiveness Check", "Closed", "Cancelled", "Archived"] },
  improvements: { prefix: "IMP", statuses: ["Open", "Under Review", "Planned", "In Progress", "Implemented", "Completed", "Deferred", "Cancelled", "Archived"] },
  concerns: { prefix: "CON", statuses: ["Draft", "Submitted", "Under Review", "Routed", "Closed", "Cancelled", "Archived"] },
  incidents: { prefix: "INC", statuses: ["Open", "Under Investigation", "Contained", "Action Required", "In Progress", "Resolved", "Closed", "Cancelled", "Archived"] },

  // --- ISO 9001 extensions ---
  "customer-satisfaction": { prefix: "CSAT", statuses: ["New", "Reviewed", "Action Required", "Closed"] },
  psr: { prefix: "PSR", statuses: ["Draft", "Active", "Retired"] },
  design: { prefix: "DSG", statuses: ["Concept", "In Design", "Design Review", "Verification", "Validation", "Released"] },
  provision: { prefix: "CP", statuses: ["Draft", "Under review", "Approved"] },

  // --- Business unit registers & frameworks ---
  // OD `cabClientForm`'s create path defaults an omitted status to "Certified"
  // (`g('cab-st')||'Certified'`, app.html:13215), not "Applicant" — even
  // though the dropdown itself, and this `statuses` order/parity-test
  // ordering, both start at "Applicant". `createStatuses[0]` carries that
  // create-time default without reordering the vocabulary (P-6.4).
  "cab-clients": { prefix: "CERT", statuses: ["Applicant", "Certified", "Surveillance Due", "Suspended", "Withdrawn"], createStatuses: ["Certified"] },
  "pcb-persons": { prefix: "PC", statuses: ["Certified", "Recert Due", "Suspended", "Expired", "Revoked"] },
  "lab-scope": { prefix: "SCOPE", statuses: ["Accredited", "Pending", "Withdrawn"] },
  // Note: isra, soa, and hira are bespoke modules with their own schemas/routes and are not generic implementation records.
};

export type MsModuleKey = keyof typeof MS_MODULES;

export function isMsModule(key: string): key is MsModuleKey {
  return Object.prototype.hasOwnProperty.call(MS_MODULES, key);
}

export const RISK_BANDS_DEFAULT: { max: number; level: string }[] = [
  { max: 4, level: "Low" },
  { max: 9, level: "Medium" },
  { max: 15, level: "High" },
  { max: 25, level: "Critical" },
];

export function riskBand(level: number, scheme = RISK_BANDS_DEFAULT): string {
  if (level <= 0) return "";
  for (const b of scheme) {
    if (level <= b.max) return b.level;
  }
  return scheme[scheme.length - 1]?.level ?? "Critical";
}

/** Module-specific derived fields (mirrors the frontend's `enrichImpl`). */
export function enrichData(module: string, data: Record<string, unknown>): Record<string, unknown> {
  if (module === "reviews") return enrichReviewData(data);
  if (module !== "risks") return data;
  const l = Number(data.likelihood) || 0;
  const i = Number(data.impact) || 0;
  const rawLevel = l * i;
  const band = riskBand(rawLevel);
  return { ...data, level: rawLevel || null, band: band || "", riskScore: rawLevel, riskLevel: band };
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
