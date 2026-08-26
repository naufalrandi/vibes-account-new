import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Personnel sub-record logs (OD `ent-personnel` Resume/Leaves/Disciplinary/
 * Performance tabs — SOF-53/SOF-48-3, backend chunk 2/3). Each row is scoped to
 * a `User` (the personnel record — this backend has no separate
 * PersonnelProfile-as-person table, `User` IS the person). Mostly-append logs:
 * create/list/delete only, no update path.
 *
 * `resume_records` collapses OD's 4 separate add-modals (`personAddEdu` /
 * `personAddExp` / `personAddTraining` / `personAddCert`, `modules.js:5514-5517`)
 * into one table with a `record_type` discriminator (validated in the service,
 * not a Postgres ENUM) since they share materially the same field shape.
 *
 * Field NAMES below are inferred from HR-domain convention, not read off
 * `modules.js` — that source file is unavailable in this environment. Only the
 * field COUNTS were audited (`parity/frontend.md:1188-1189`, sourced from
 * `modules.js:5514-5520`): personAddEdu/Exp/Training/Cert 15 fields,
 * personAddLeave 4, personAddDisc 5, personAddPerf 4. Same documented-divergence
 * posture as SOF-36 when source is unreachable — see `parity/backend.md` for
 * the explicit callout.
 */
export const up: Migration = async ({ context: q }) => {
  await q.createTable("resume_records", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    user_id: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    // "Education" | "Experience" | "Training" | "Certification" — validated in the service.
    record_type: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    organization: { type: DataTypes.STRING, allowNull: true },
    field_of_study: { type: DataTypes.STRING, allowNull: true },
    location: { type: DataTypes.STRING, allowNull: true },
    start_date: { type: DataTypes.DATEONLY, allowNull: true },
    end_date: { type: DataTypes.DATEONLY, allowNull: true },
    is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    grade: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    credential_id: { type: DataTypes.STRING, allowNull: true },
    issuer: { type: DataTypes.STRING, allowNull: true },
    certificate_number: { type: DataTypes.STRING, allowNull: true },
    expiry_date: { type: DataTypes.DATEONLY, allowNull: true },
    attachment_url: { type: DataTypes.STRING, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("resume_records", ["org_id"]);
  await q.addIndex("resume_records", ["user_id"]);

  await q.createTable("leave_records", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    user_id: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    leave_type: { type: DataTypes.STRING, allowNull: false },
    from_date: { type: DataTypes.DATEONLY, allowNull: false },
    to_date: { type: DataTypes.DATEONLY, allowNull: false },
    // Inclusive calendar days: round((to-from)/86400000)+1 — computed in the
    // service, matches OD's own personAddLeave leaf-level behavior (which is
    // documented elsewhere as inconsistent with a separate business-days
    // calc; reconciling that is out of scope here).
    days: { type: DataTypes.INTEGER, allowNull: false },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("leave_records", ["org_id"]);
  await q.addIndex("leave_records", ["user_id"]);

  await q.createTable("disciplinary_records", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    user_id: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    discipline_type: { type: DataTypes.STRING, allowNull: false },
    incident_date: { type: DataTypes.DATEONLY, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    action_taken: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Open" },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("disciplinary_records", ["org_id"]);
  await q.addIndex("disciplinary_records", ["user_id"]);

  await q.createTable("performance_records", {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    org_id: { type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" }, onDelete: "CASCADE" },
    user_id: { type: DataTypes.UUID, allowNull: false, references: { model: "users", key: "id" }, onDelete: "CASCADE" },
    review_period: { type: DataTypes.STRING, allowNull: false },
    rating: { type: DataTypes.STRING, allowNull: false },
    reviewer_id: { type: DataTypes.UUID, allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL" },
    comments: { type: DataTypes.TEXT, allowNull: true },
    created_by: { type: DataTypes.STRING, allowNull: true },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  });
  await q.addIndex("performance_records", ["org_id"]);
  await q.addIndex("performance_records", ["user_id"]);
};

export const down: Migration = async ({ context: q }) => {
  await q.dropTable("performance_records");
  await q.dropTable("disciplinary_records");
  await q.dropTable("leave_records");
  await q.dropTable("resume_records");
};
