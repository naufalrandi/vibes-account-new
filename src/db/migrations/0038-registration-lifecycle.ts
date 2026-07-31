import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Tenant Requests only modelled PendingApproval/Approved/Rejected, so the
 * drafting and review steps of OD's six-state lifecycle (Draft → Submitted →
 * Under Review → Approved/Rejected, plus Cancelled) had nowhere to live.
 *
 * `Submitted` replaces `PendingApproval` as the post-submission state; the old
 * value is kept in the enum so existing rows stay valid and are migrated across.
 * A nullable `submittedBy` records which org raised it, since the Service Owner
 * can now raise a Direct request rather than only reviewing partner ones.
 */
const NEW_VALUES = ["Draft", "Submitted", "Under Review", "Cancelled"];

export const up: Migration = async ({ context: q }) => {
  for (const value of NEW_VALUES) {
    await q.sequelize.query(
      `ALTER TYPE "enum_registration_requests_status" ADD VALUE IF NOT EXISTS '${value}'`,
    );
  }
  await q.addColumn("registration_requests", "submitted_by", {
    type: DataTypes.UUID, allowNull: true, references: { model: "organizations", key: "id" }, onDelete: "SET NULL",
  });
  // Existing pending rows move onto the new vocabulary.
  await q.sequelize.query(
    `UPDATE "registration_requests" SET "status" = 'Submitted' WHERE "status" = 'PendingApproval'`,
  );
};

export const down: Migration = async ({ context: q }) => {
  await q.sequelize.query(
    `UPDATE "registration_requests" SET "status" = 'PendingApproval' WHERE "status" IN ('Draft','Submitted','Under Review','Cancelled')`,
  );
  await q.removeColumn("registration_requests", "submitted_by");
  // Postgres cannot drop enum values; the added labels are left in place.
};
