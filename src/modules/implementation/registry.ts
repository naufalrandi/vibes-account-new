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
  // OD `renderTnObligations` (app.html:14864): Active/Under Review/Archived —
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
  // SOF-58 follow-up: OD `db.tnPOs` (ISO 9001 §8.4.2/§8.4.3), `tnPoForm`/
  // `tnPoSeed` (`core.js:8676`/`8711`) — a live, seeded feature the extractor
  // missed only because `tnPoSeed(t)` takes an arg (`parity/backend-
  // unseeded.md`). Not `enterprise/ent-po` (that is the business-side
  // procurement PO on `BusinessRecord`, a different module/lifecycle).
  // Recommended by the same doc: ride `ImplementationRecord` next to
  // `suppliers` rather than a bespoke table. `TPO-0001` codes match OD's
  // `tnPoNextId()`. Two OD behaviours are storage-only here for now (no
  // auto-NC on a rejected receipt via `tnPoRaiseNC`, no evaluation push onto
  // `supplier.evaluations` via `tnPoEval`) — the field contract is complete,
  // the cross-module side effects are a follow-up.
  "supplier-po": { prefix: "TPO", statuses: ["Issued", "Accepted", "Closed", "Rejected"] },

  // --- Performance & improvement (clause 9, 10) ---
  performance: { prefix: "PEV", statuses: ["Draft", "Active", "Achieved", "At Risk", "Closed"] },
  reviews: { prefix: "MR", deep: true, transitions: MR_TRANSITIONS, createStatuses: ["Draft", "Scheduled"], statuses: ["Draft", "Scheduled", "In Progress", "Pending Outputs", "Completed", "Finalized", "Cancelled", "Archived"] },
  nonconformities: { prefix: "NC", statuses: ["Open", "CAP Required", "CAP Planned", "In Progress", "Pending Effectiveness Check", "Closed", "Cancelled", "Archived"] },
  improvements: { prefix: "IMP", statuses: ["Open", "Under Review", "Planned", "In Progress", "Implemented", "Completed", "Deferred", "Cancelled", "Archived"] },
  concerns: { prefix: "CON", statuses: ["Draft", "Submitted", "Under Review", "Routed", "Closed", "Cancelled", "Archived"] },
  incidents: { prefix: "INC", statuses: ["Open", "Under Investigation", "Contained", "Action Required", "In Progress", "Resolved", "Closed", "Cancelled", "Archived"] },

  // --- ISO 9001 extensions ---
  "customer-satisfaction": { prefix: "CSAT", statuses: ["New", "Reviewed", "Action Required", "Closed"] },
  // OD's PSR module (app.html:11507-11938) stores three different `kind`s of
  // row in one array (`db.psrRecords`/`db.psrCatalog`/`db.psrSpecTemplates`)
  // — this port collapses all three into the one generic "psr" module,
  // distinguished by `data.kind`. Catalog offerings and specification
  // templates share OD's PSR_STATUS 3-value set (Draft/Active/Retired,
  // `psrStatusBadge`, app.html:11513); the §8.2.3 requirements-review record
  // (`psrRec*`) has its own 6-value PSR_REC_STATUS vocabulary (app.html:
  // 11516: Draft/Under Review/Accepted/Rejected/Fulfilled/Closed). Both sets
  // validate against this one shared status column, so it carries the union.
  psr: { prefix: "PSR", statuses: ["Draft", "Active", "Retired", "Under Review", "Accepted", "Rejected", "Fulfilled", "Closed"] },
  // OD `dndSave`'s create path mints "DND-" codes (`ipPad(db.designItems,'DND-')`,
  // app.html:22199) — the design catalog register uses OD's "Design &
  // Development" module short code, not a "DSG" invention. Migration 0076
  // renames any pre-existing "DSG-" rows so the register stays consistent.
  //
  // Statuses are OD's exact 8-value `DND_STATUS` (app.html:22103), not the
  // 6-value `DND_STAGES` subset `dndAdvance`/`dndStageBar` step through.
  // "On Hold" and "Retired" are appended last (after "Released") so
  // `statuses[0]` stays "Concept", the create default. Wave Q task W5: this
  // port had drifted to `DND_STAGES` only, which meant `assertStatus` hard-
  // rejected "On Hold" outright and "Retired" too (the latter despite the FE
  // TS union already claiming it) — both are legal OD statuses reachable
  // from `dndForm`'s status dropdown (unrestricted, any status selectable),
  // and "Retired" is additionally one click away via `dndMenu`'s "Retire"
  // item. "Archived" is deliberately NOT listed here, matching every other
  // bespoke-workspace module (e.g. `psr`) — it is handled by `assertStatus`'s
  // unconditional `status !== "Archived"` bypass, the repo-wide convention
  // for the terminal archive state (see `risks`'s comment above and P-6.1).
  design: {
    prefix: "DND",
    statuses: ["Concept", "In Design", "Design Review", "Verification", "Validation", "Released", "On Hold", "Retired"],
  },
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

  // --- Scaffold modules: registers OD declares but never implements --------
  //
  // SOF-24. The 17 keys below are `TN_MODULES` entries (js/core.js:7830) that
  // OD renders through `renderTenantModule()`'s generic fallback
  // (core.js:8957-8970): a title, the module's `intent` line, a card per
  // sub-tab, and an empty-state table whose "New Record" button only fires
  // `toast('… (scaffold)')`. That means OD defines a NAME, a GROUP, an FWE
  // mapping and a set of sub-tabs for each — and no fields, no status
  // dropdown and no save path. There is nothing to transcribe.
  //
  // So unlike every entry above, these vocabularies are NOT ported from OD —
  // they are derived from the normative standard each module's `fwe` and
  // `intent` name, cited per entry. They are the first server-side contract
  // for these modules, deliberately flat (no `deep`/`transitions`): OD has no
  // state machine here to mirror, and inventing one would pin clients to a
  // graph no design or standard actually mandates. `statuses[0]` is the
  // create default in each set, chosen to be the state a freshly-entered
  // record is genuinely in.
  //
  // NOT registered here: `tn-m-lab-operations`. OD routes it to
  // `setPlat('axia','lims')` (core.js:8951) — the whole LIMS platform area,
  // not a clause register — so a register entry would be a fake home for it.
  // SOF-32 closed that gap the way OD draws it: the module's backend home is
  // `src/modules/lims`, whose `GET /v1/lims/area` serves OD's `LIMSCFG()` map
  // (5 sections / 7 views) and states which of them the server actually backs.
  // `/v1/implementation/lab-operations` therefore still 404s, deliberately —
  // pinned by "does not register lab-operations as a clause register" below.

  // ISO 9001 §10.2 / ISO 45001 §10.2 corrective action: react, evaluate the
  // need to eliminate causes, implement, review effectiveness. Vocabulary is
  // aligned with the `nonconformities` register above (which speaks of a
  // "CAP" and a "Pending Effectiveness Check") so a CAPA raised from an NC
  // reads in the same language; "Root Cause Analysis" and "Verified" carry
  // the two sub-tabs OD names but never builds (Root Cause Analysis,
  // Effectiveness Review).
  capa: {
    prefix: "CAPA",
    statuses: [
      "Open", "Root Cause Analysis", "Action Planned", "In Progress",
      "Pending Effectiveness Check", "Verified", "Closed", "Cancelled", "Archived",
    ],
  },
  // ISO 9001 §7.1.5 monitoring and measuring resources: §7.1.5.2 requires
  // measuring equipment to be calibrated/verified at intervals, safeguarded,
  // and — when found unfit — assessed for the validity of previous results.
  // The vocabulary is the equipment's fitness-for-use state, which is what
  // the "Calibration & Verification Schedule" sub-tab reports on.
  mmr: {
    prefix: "MMR",
    statuses: [
      "In Service", "Calibration Due", "Under Calibration", "Out of Calibration",
      "Under Repair", "Retired", "Archived",
    ],
  },
  // ISO 45001 §6.1.2 hazard identification and assessment of OH&S risks,
  // §8.1.2 hierarchy of controls, §6.1.2.1 "ongoing and proactive" (hence
  // "Reassessment Due"). Mirrors the shape of the `risks` register — identify,
  // assess, treat, monitor — without adopting its ISO 31000 approval chain,
  // which is an ISMS-specific flow OD only ever built for `risks` itself.
  hira: {
    prefix: "HIRA",
    statuses: [
      "Identified", "Under Assessment", "Controls Planned", "Controls Implemented",
      "Monitored", "Reassessment Due", "Closed", "Archived",
    ],
  },

  // ISO/IEC 17021-1 (certification bodies for management systems).
  // §7.3/§8.2 scheme ownership and publicly available scheme documents.
  "cab-schemes": { prefix: "CSCH", statuses: ["Draft", "Under Review", "Active", "Suspended", "Withdrawn", "Archived"] },
  // §9.1-9.4 the audit programme: initial stage 1/stage 2, surveillance and
  // recertification. Stage is a property of the audit, not its state, so it
  // lives in `data` — this is the lifecycle of one programmed audit through
  // planning, conduct, reporting and finding closure.
  "cab-audits": { prefix: "CAUD", statuses: ["Planned", "Scheduled", "In Progress", "Reporting", "Findings Open", "Closed", "Cancelled", "Archived"] },
  // §9.5 certification decision, §9.6 maintaining/renewing certification,
  // §9.6.2-9.6.5 suspend / restore / reduce / withdraw. The status is the
  // decision taken, which is what an auditable decision register records.
  "cab-decisions": { prefix: "CDEC", statuses: ["Pending Review", "Under Decision", "Granted", "Maintained", "Suspended", "Restored", "Withdrawn", "Refused", "Archived"] },
  // §5.2 and Annex A: identify, analyse, evaluate and treat threats to
  // impartiality; residual threats may be accepted at an acceptable level,
  // hence "Accepted" alongside "Mitigated".
  "cab-impartiality": { prefix: "IMPT", statuses: ["Identified", "Under Evaluation", "Mitigated", "Accepted", "Escalated", "Closed", "Archived"] },
  // §9.7 appeals, §9.8 complaints — receipt, acknowledgement, investigation,
  // decision by someone not involved in the subject of the appeal, closure.
  "cab-appeals": { prefix: "APPL", statuses: ["Received", "Acknowledged", "Under Investigation", "Decision Pending", "Upheld", "Rejected", "Closed", "Archived"] },

  // ISO/IEC 17024 (certification of persons).
  // §8 scheme development, review and revision.
  "pcb-schemes": { prefix: "PSCH", statuses: ["Draft", "Under Review", "Active", "Suspended", "Withdrawn", "Archived"] },
  // §9.3 examination: development of items, approval, delivery, marking and
  // release of results; retired exams stay on the register for traceability.
  "pcb-exams": { prefix: "EXM", statuses: ["Draft", "Item Development", "Approved", "Scheduled", "Delivered", "Marked", "Results Released", "Retired", "Archived"] },
  // §9.1-9.4 application, eligibility review, examination, decision. Pass/fail
  // is the exam outcome; "Certified" only lands once a §9.4 decision is made
  // (which the `pcb-decisions` register records).
  "pcb-candidates": { prefix: "CAND", statuses: ["Applied", "Eligibility Review", "Eligible", "Ineligible", "Exam Scheduled", "Examined", "Passed", "Failed", "Certified", "Withdrawn", "Archived"] },
  // §9.4 certification decision, §9.5 recertification, §9.6 suspending and
  // withdrawing certification.
  "pcb-decisions": { prefix: "PDEC", statuses: ["Pending Review", "Under Decision", "Certified", "Recertified", "Refused", "Suspended", "Revoked", "Archived"] },
  // §9.8 appeals, §9.9 complaints — same shape as the CAB register above;
  // kept as its own module because the two bodies keep separate registers.
  "pcb-appeals": { prefix: "PAPL", statuses: ["Received", "Acknowledged", "Under Investigation", "Decision Pending", "Upheld", "Rejected", "Closed", "Archived"] },

  // ISO/IEC 17025 (testing and calibration laboratories).
  // §7.2.1 selection/verification of methods, §7.2.2 validation of non-standard
  // and lab-developed methods; a superseded method stays on the register.
  "lab-methods": { prefix: "MTH", statuses: ["Draft", "Under Validation", "Validated", "In Use", "Under Review", "Superseded", "Withdrawn", "Archived"] },
  // §6.4 equipment: §6.4.3 fitness for use, §6.4.4 verification before use,
  // §6.4.6 calibration, §6.4.9 equipment removed from service after overload
  // or mishandling. Same fitness-state vocabulary as `mmr` minus the ISO 9001
  // §7.1.5 "Out of Calibration" state, which 17025 handles as removal from
  // service (§6.4.9) rather than a distinct calibration verdict.
  "lab-equipment": { prefix: "EQP", statuses: ["In Service", "Calibration Due", "Under Calibration", "Out of Service", "Under Repair", "Retired", "Archived"] },
  // §7.6 evaluation of measurement uncertainty; the budget is a controlled
  // document-like artefact (drafted, reviewed, approved, superseded), which is
  // why this vocabulary is a document lifecycle rather than an equipment one.
  "lab-uncertainty": { prefix: "MU", statuses: ["Draft", "Under Review", "Approved", "Superseded", "Archived"] },
  // §7.7.2 proficiency testing / interlaboratory comparison participation.
  // The three terminal verdicts are ISO 13528's performance-score bands
  // (|z| ≤ 2 satisfactory, 2 < |z| < 3 questionable, |z| ≥ 3 unsatisfactory).
  "lab-pt": { prefix: "PTS", statuses: ["Planned", "Registered", "Sample Received", "In Progress", "Results Submitted", "Satisfactory", "Questionable", "Unsatisfactory", "Closed", "Archived"] },
  // Note: isra and soa are bespoke modules with their own schemas/routes and are not generic implementation records.
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
