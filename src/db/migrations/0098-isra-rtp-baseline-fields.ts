import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Baseline conformance for the ISRA treatment/RTP chain: the Group F port
 * (migration 0066) kept only the columns the first cut of the services read,
 * so the tables cannot round-trip an OD record. OD writes considerably more
 * on each of the three rows, and the missing columns are not cosmetic — they
 * carry the plan itself (title, description, dates, owner, evidence), the
 * provenance of a committed control (which snapshot version it came from,
 * which vulnerabilities it answers) and the per-step acceptance criteria.
 *
 * Four groups, all additive:
 *  1. `isra_scenario_added_controls` — the added-control row OD pushes in
 *     `isra2ApplToggle` (js/core.js:15165): snapshotVersion, relatedVulnIds,
 *     rationale, intendedEffect, targetEffectiveness, owner, status,
 *     selectionDate.
 *  2. `isra_rtps` — the RTP record OD saves in `isra2RtpForm`
 *     (js/core.js:15246): cycle, option, title, description,
 *     addedControlIds, owner, supporting, resources, startDate, targetDate,
 *     expectedEvidence, dependencies, createdBy, plus the needsReview flag
 *     that a treatment-option change raises (js/core.js:15150).
 *  3. `isra_rtp_actions` — the action step OD saves in `isra2RtpActionsMgr`
 *     and `isra2RtpCopyTemplates` (js/core.js:15267-15291): relatedVulnIds,
 *     relatedVulnNames, evidenceRequired, completionCriteria, templateId,
 *     templateVer.
 *  4. `isra_scenario_closure` — `closure.nextReview`, the second link in OD's
 *     next-review fallback chain (`isra2NextReview`, js/core.js:14762).
 *
 * Everything is nullable, or NOT NULL with the default OD itself writes, so
 * existing rows stay valid: an added control OD created is always
 * 'Committed' (js/core.js:15166) and every RTP belongs to a cycle, cycle 1
 * for a first-round plan.
 *
 * The status *vocabularies* widened alongside this (ISRA_RTP_STATUS,
 * ISRA_TREATMENT_STATUS, ISRA_RTP_ACTION_STATUS) need no migration — those
 * are DataTypes.STRING columns validated at the service layer, not Postgres
 * enums.
 */
export const up: Migration = async ({ context: q }) => {
  // ---- 1: added controls (js/core.js:15165) ----
  await q.addColumn("isra_scenario_added_controls", "snapshot_version", { type: DataTypes.INTEGER, allowNull: true });
  await q.addColumn("isra_scenario_added_controls", "related_vuln_ids", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("isra_scenario_added_controls", "rationale", { type: DataTypes.TEXT, allowNull: true });
  await q.addColumn("isra_scenario_added_controls", "intended_effect", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_scenario_added_controls", "target_effectiveness", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_scenario_added_controls", "owner", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_scenario_added_controls", "status", { type: DataTypes.STRING, allowNull: false, defaultValue: "Committed" });
  await q.addColumn("isra_scenario_added_controls", "selection_date", { type: DataTypes.DATE, allowNull: true });

  // ---- 2: RTP record (js/core.js:15246) ----
  await q.addColumn("isra_rtps", "cycle", { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 });
  await q.addColumn("isra_rtps", "option", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_rtps", "title", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_rtps", "description", { type: DataTypes.TEXT, allowNull: true });
  await q.addColumn("isra_rtps", "added_control_ids", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("isra_rtps", "owner", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_rtps", "supporting", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_rtps", "resources", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_rtps", "start_date", { type: DataTypes.DATEONLY, allowNull: true });
  await q.addColumn("isra_rtps", "target_date", { type: DataTypes.DATEONLY, allowNull: true });
  await q.addColumn("isra_rtps", "expected_evidence", { type: DataTypes.TEXT, allowNull: true });
  await q.addColumn("isra_rtps", "dependencies", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_rtps", "created_by", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_rtps", "needs_review", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  // ---- 3: RTP action steps (js/core.js:15267-15291) ----
  await q.addColumn("isra_rtp_actions", "related_vuln_ids", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("isra_rtp_actions", "related_vuln_names", { type: DataTypes.JSONB, allowNull: false, defaultValue: [] });
  await q.addColumn("isra_rtp_actions", "evidence_required", { type: DataTypes.TEXT, allowNull: true });
  await q.addColumn("isra_rtp_actions", "completion_criteria", { type: DataTypes.TEXT, allowNull: true });
  await q.addColumn("isra_rtp_actions", "template_id", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("isra_rtp_actions", "template_ver", { type: DataTypes.INTEGER, allowNull: true });

  // ---- 4: closure next review (js/core.js:14762) ----
  await q.addColumn("isra_scenario_closure", "next_review", { type: DataTypes.DATEONLY, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("isra_scenario_closure", "next_review");

  await q.removeColumn("isra_rtp_actions", "template_ver");
  await q.removeColumn("isra_rtp_actions", "template_id");
  await q.removeColumn("isra_rtp_actions", "completion_criteria");
  await q.removeColumn("isra_rtp_actions", "evidence_required");
  await q.removeColumn("isra_rtp_actions", "related_vuln_names");
  await q.removeColumn("isra_rtp_actions", "related_vuln_ids");

  await q.removeColumn("isra_rtps", "needs_review");
  await q.removeColumn("isra_rtps", "created_by");
  await q.removeColumn("isra_rtps", "dependencies");
  await q.removeColumn("isra_rtps", "expected_evidence");
  await q.removeColumn("isra_rtps", "target_date");
  await q.removeColumn("isra_rtps", "start_date");
  await q.removeColumn("isra_rtps", "resources");
  await q.removeColumn("isra_rtps", "supporting");
  await q.removeColumn("isra_rtps", "owner");
  await q.removeColumn("isra_rtps", "added_control_ids");
  await q.removeColumn("isra_rtps", "description");
  await q.removeColumn("isra_rtps", "title");
  await q.removeColumn("isra_rtps", "option");
  await q.removeColumn("isra_rtps", "cycle");

  await q.removeColumn("isra_scenario_added_controls", "selection_date");
  await q.removeColumn("isra_scenario_added_controls", "status");
  await q.removeColumn("isra_scenario_added_controls", "owner");
  await q.removeColumn("isra_scenario_added_controls", "target_effectiveness");
  await q.removeColumn("isra_scenario_added_controls", "intended_effect");
  await q.removeColumn("isra_scenario_added_controls", "rationale");
  await q.removeColumn("isra_scenario_added_controls", "related_vuln_ids");
  await q.removeColumn("isra_scenario_added_controls", "snapshot_version");
};
