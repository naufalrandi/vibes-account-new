import { DataTypes, type ModelAttributeColumnOptions } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Three ISRA gaps where the repo's own seed data already carries the values
 * and the schema silently dropped them.
 *
 * 1. `isra_scenarios.accepted` — OD `sc.accepted = {at, by, score}`
 *    (js/core.js:14657), seeded at :16721. It is load-bearing, not decorative:
 *    the Retain/accepted test (:14633), the overdue-review check (:14770), the
 *    band label "Accepted — within appetite" (:14853) and `isra2Adequacy`'s
 *    `{state:'Within — accepted'}` (:15304) all read it. There was no column,
 *    so every one of those states was unreachable from the database — while
 *    src/db/seeders/isra.tenantDemo.data.ts (RSC-0005) carries the object.
 *
 * 2. `isra_rtp_actions` implementation/verification lifecycle — OD writes nine
 *    fields onto an action (js/core.js:16652, seeded again at :16700, under the
 *    section header "implementation action lifecycle" at :15414, with
 *    `ISRA4_VERIFY_OUT` at :15410 supplying the outcomes). None existed, so an
 *    action could be marked 'Verified' with no record of who verified it, when,
 *    or against what evidence. The seed row ACT-B1 carries all nine.
 *
 * 3. `isra_treatments.acceptance` gains OD's own key set. The baseline is
 *    self-contradictory here: isra-spec.md:97 says {justification, approver,
 *    reviewDate} while js/core.js:15154 writes {rationale, owner, approver,
 *    acceptanceDate, reviewDate}. Rather than pick a side, the JSONB shape is
 *    widened to the union so both are representable; the running prototype's
 *    keys are the ones the app reads. Recorded as a deliberate call.
 */
const ACTION_LIFECYCLE: Array<[string, ModelAttributeColumnOptions]> = [
  ["actual_start", { type: DataTypes.DATEONLY, allowNull: true }],
  ["actual_completion", { type: DataTypes.DATEONLY, allowNull: true }],
  ["implemented_by", { type: DataTypes.STRING, allowNull: true }],
  ["implementation_notes", { type: DataTypes.TEXT, allowNull: true }],
  ["submission_date", { type: DataTypes.DATEONLY, allowNull: true }],
  ["verification_status", { type: DataTypes.STRING, allowNull: true }],
  ["verified_by", { type: DataTypes.STRING, allowNull: true }],
  ["verification_date", { type: DataTypes.DATEONLY, allowNull: true }],
  ["verification_notes", { type: DataTypes.TEXT, allowNull: true }],
];

export const up: Migration = async ({ context: q }) => {
  await q.addColumn("isra_scenarios", "accepted", { type: DataTypes.JSONB, allowNull: true });
  for (const [name, spec] of ACTION_LIFECYCLE) {
    await q.addColumn("isra_rtp_actions", name, spec);
  }
  // OD's disciplinary sub-record (js/modules.js:5525) is {date,type,severity,
  // action,note} — `note` is optional and there is no required free-text field.
  // `description NOT NULL` was a write-path constraint the design never imposes.
  await q.changeColumn("disciplinary_records", "description", { type: DataTypes.TEXT, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.sequelize.query(`UPDATE "disciplinary_records" SET "description" = '' WHERE "description" IS NULL`);
  await q.changeColumn("disciplinary_records", "description", { type: DataTypes.TEXT, allowNull: false });
  for (const [name] of ACTION_LIFECYCLE) {
    await q.removeColumn("isra_rtp_actions", name);
  }
  await q.removeColumn("isra_scenarios", "accepted");
};
