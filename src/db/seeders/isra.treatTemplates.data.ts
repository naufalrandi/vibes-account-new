// GENERATED FILE — do not edit by hand.
// Extracted programmatically from OD's demo treatment-template seed
// (fe-vibes-new-od/app.html:20984-20988, inside _isra3SeedV1 — db.israTreatTemplates).
// OD's own array (3 rows, TPL-0001..0003) is the only `db.israTreatTemplates` seed found
// anywhere in app.html; the live reader (isra2TemplatesFor, app.html:19205) has no other
// source. OD's richer per-template shape (actions[]/evidence[]/completionCriteria[]/
// monitoring[]) is compressed losslessly into this table's frozen 3-column shape
// (action_template/mechanism/notes, migration 0061 — schema is frozen for this batch):
// actionTemplate = actions.join(" | "); mechanism = "Evidence: " + evidence.join("; ");
// notes = "Completion criteria: " + completionCriteria.join("; ") + ". Monitoring: " +
// monitoring.join("; ") + "." — every OD word is preserved, just relabeled into the
// available columns. vulnId resolves OD's free-text `vuln` name against
// isra.vulnLibrary.data.ts (case-insensitive, trimmed) — 3/3 resolved with 0 misses.
//
// Regenerate from app.html if OD's treatment-template demo seed changes.
//
// `isra_treat_templates.id` is a generated UUID (migration 0061), not a
// business-key string like the other library tables' PKs — OD's own
// TPL-0001..0003 codes are kept here as `odCode` for provenance/audit only;
// the seeder (isra.ts) upserts by the natural (vulnId, annexRef) pair, which
// is unique across these 3 demo rows.

export interface IsraTreatTemplateSeedRow {
  odCode: string;
  vulnId: string;
  annexRef: string;
  actionTemplate: string;
  mechanism: string;
  notes: string;
}

export const ISRA_TREAT_TEMPLATES_SEED: readonly IsraTreatTemplateSeedRow[] = [
  { odCode: "TPL-0001", vulnId: "VUL-0071", annexRef: "A.8.5", actionTemplate: "Deploy phishing-resistant MFA at the IdP for all customer and admin accounts | Disable legacy/basic-auth fallback paths", mechanism: "Evidence: IdP MFA policy export; MFA enrolment coverage report", notes: "Completion criteria: 100% of privileged accounts enrolled; MFA required on all external logins. Monitoring: Monthly MFA coverage review." },
  { odCode: "TPL-0002", vulnId: "VUL-0070", annexRef: "A.8.5", actionTemplate: "Adopt a strong password policy aligned to current guidance | Screen new/changed passwords against breached-password lists", mechanism: "Evidence: Password policy configuration; Breached-password screening logs", notes: "Completion criteria: Policy enforced platform-wide. Monitoring: Quarterly password-policy compliance check." },
  { odCode: "TPL-0003", vulnId: "VUL-0073", annexRef: "A.8.5", actionTemplate: "Implement progressive account lockout and rate limiting on authentication endpoints", mechanism: "Evidence: Lockout / rate-limit configuration export", notes: "Completion criteria: Lockout active on all auth endpoints. Monitoring: Alerting on lockout-threshold anomalies." },
];
