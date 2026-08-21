import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * ISRA + SoA (F-1-impl), Group F part 1 — Treatment decisions, recommendation
 * snapshot/disposition, added controls, and the RTP + actions + Annex A
 * junction (design doc §2.8 rows 1–7).
 *
 * `isra_rtps.status` is intentionally restricted to Draft/Approved — ISRA's
 * own RTP approval is a single-step transition, NOT the seven-function
 * generic-risk-register propose/MS/TM/escalate/reject chain the original
 * plan mischaracterized as ISRA's (design doc §3.9).
 */
export const ISRA_RTP_STATUS = ["Draft", "Approved"] as const;
export const ISRA_RTP_ACTION_STATUS = ["Planned", "In Progress", "Implemented", "Awaiting Verification", "Verified", "Rework", "Cancelled"] as const;

export const up: Migration = async ({ context: q }) => {
  const ts = {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  };

  await q.createTable("isra_scenario_treatment_decisions", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenario_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    cycle: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    option: { type: DataTypes.STRING, allowNull: false },
    rationale: { type: DataTypes.TEXT, allowNull: true },
    decided_by: { type: DataTypes.STRING, allowNull: true },
    decision_date: { type: DataTypes.DATEONLY, allowNull: true },
    approval_status: { type: DataTypes.STRING, allowNull: true },
    approved_by: { type: DataTypes.STRING, allowNull: true },
    approval_date: { type: DataTypes.DATEONLY, allowNull: true },
    review_date: { type: DataTypes.DATEONLY, allowNull: true },
    // Only populated for option='Retain' — {justification, approver, reviewDate}.
    acceptance: { type: DataTypes.JSONB, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    needs_review: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ...ts,
  });
  await q.addIndex("isra_scenario_treatment_decisions", ["scenario_id"]);
  await q.addIndex("isra_scenario_treatment_decisions", ["scenario_id", "is_current"]);

  await q.createTable("isra_scenario_recommendation_snapshots", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenario_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    controls: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    map_version: { type: DataTypes.INTEGER, allowNull: true },
    generated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ...ts,
  });
  await q.addIndex("isra_scenario_recommendation_snapshots", ["scenario_id"]);
  await q.addIndex("isra_scenario_recommendation_snapshots", ["scenario_id", "is_current"]);

  await q.createTable("isra_scenario_recommendation_dispositions", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenario_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    annex_ref: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_annex_a_controls", key: "ref" }, onDelete: "RESTRICT" },
    disposition: { type: DataTypes.STRING, allowNull: false },
    rationale: { type: DataTypes.TEXT, allowNull: true },
    existing_control_id: { type: DataTypes.UUID, allowNull: true, references: { model: "isra_existing_controls", key: "id" }, onDelete: "SET NULL" },
    ...ts,
  });
  await q.addIndex("isra_scenario_recommendation_dispositions", ["scenario_id"]);
  await q.addIndex("isra_scenario_recommendation_dispositions", ["annex_ref"]);

  await q.createTable("isra_scenario_added_controls", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenario_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    annex_ref: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_annex_a_controls", key: "ref" }, onDelete: "RESTRICT" },
    related_vuln_names: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    source: { type: DataTypes.STRING, allowNull: true },
    ...ts,
  });
  await q.addIndex("isra_scenario_added_controls", ["scenario_id"]);
  await q.addIndex("isra_scenario_added_controls", ["annex_ref"]);

  await q.createTable("isra_rtps", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    scenario_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_scenarios", key: "id" }, onDelete: "CASCADE" },
    version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    approved_by: { type: DataTypes.STRING, allowNull: true },
    approved_at: { type: DataTypes.DATE, allowNull: true },
    funding: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    monitoring: { type: DataTypes.TEXT, allowNull: true },
    completion_criteria: { type: DataTypes.TEXT, allowNull: true },
    is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    ...ts,
  });
  await q.addIndex("isra_rtps", ["scenario_id"]);
  await q.addIndex("isra_rtps", ["scenario_id", "is_current"]);

  await q.createTable("isra_rtp_actions", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    rtp_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_rtps", key: "id" }, onDelete: "CASCADE" },
    action: { type: DataTypes.TEXT, allowNull: false },
    owners: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    target_date: { type: DataTypes.DATEONLY, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Planned" },
    evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    ...ts,
  });
  await q.addIndex("isra_rtp_actions", ["rtp_id"]);

  // Pure junction — normalizes action.addedControlRefs[] so SoA's third
  // union term is a real join, not a JSONB scan (design doc §2.1/§2.8).
  await q.createTable("isra_rtp_action_controls", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    rtp_action_id: { type: DataTypes.UUID, allowNull: false, references: { model: "isra_rtp_actions", key: "id" }, onDelete: "CASCADE" },
    annex_ref: { type: DataTypes.STRING, allowNull: false, references: { model: "isra_annex_a_controls", key: "ref" }, onDelete: "RESTRICT" },
  });
  await q.addIndex("isra_rtp_action_controls", ["rtp_action_id", "annex_ref"], { unique: true });
  await q.addIndex("isra_rtp_action_controls", ["annex_ref"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("isra_rtp_action_controls");
  await q.dropTable("isra_rtp_actions");
  await q.dropTable("isra_rtps");
  await q.dropTable("isra_scenario_added_controls");
  await q.dropTable("isra_scenario_recommendation_dispositions");
  await q.dropTable("isra_scenario_recommendation_snapshots");
  await q.dropTable("isra_scenario_treatment_decisions");
};
