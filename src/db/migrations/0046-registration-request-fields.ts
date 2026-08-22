import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * OD's tenant-request entity (`db.tenantRequests`, index.html:7654+) carries
 * three things `registration_requests` never modelled:
 *
 * 1. A request-level `code` ("TRQ-1001", `nextSeqId`) shown as its own column
 *    and in the `treqDetail` header — distinct from the proposed tenant's own
 *    org code, which already lives inside `proposed_tenant` JSONB.
 * 2. A `partnerId` that can be **absent** ("Direct (Service Provider
 *    acquisition)", 7713) rather than always equal to the submitting org.
 *    `distributor_org_id` was NOT NULL, so a Service-Owner-raised request had
 *    no way to represent Direct — it silently stamped the SP's own org id.
 * 3. `rq.tenantId` (7647), set once a request is provisioned, backing the
 *    "Provisioned Tenant" link and "Open tenant" row action (7740, 7665).
 *
 * `industry` and `contactPhone` (7711, 7716) need no schema change — they
 * join `proposed_tenant` JSONB the same way `name`/`country`/admin fields
 * already do (see 0039's identical reasoning for `site_requests.proposed`).
 */
export const up: Migration = async ({ context: q }) => {
  await q.changeColumn("registration_requests", "distributor_org_id", {
    type: DataTypes.UUID, allowNull: true, references: { model: "organizations", key: "id" },
  });
  await q.sequelize.query('ALTER TABLE "registration_requests" ALTER COLUMN "distributor_org_id" DROP NOT NULL');


  await q.addColumn("registration_requests", "tenant_id", {
    type: DataTypes.UUID, allowNull: true, references: { model: "organizations", key: "id" }, onDelete: "SET NULL",
  });

  await q.addColumn("registration_requests", "code", { type: DataTypes.STRING, allowNull: true });
  // Backfill existing rows with a sequential TRQ-#### code ordered by creation,
  // then close the column off — every row created from here on supplies one.
  const [rows] = await q.sequelize.query(
    `SELECT id FROM "registration_requests" ORDER BY "created_at" ASC`,
  );
  let seq = 1000;
  for (const row of rows as { id: string }[]) {
    seq += 1;
    await q.sequelize.query(`UPDATE "registration_requests" SET "code" = :code WHERE "id" = :id`, {
      replacements: { code: `TRQ-${seq}`, id: row.id },
    });
  }
  await q.changeColumn("registration_requests", "code", { type: DataTypes.STRING, allowNull: false });
  await q.sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS "registration_requests_code_unique" ON "registration_requests" ("code")');
};

export const down: Migration = async ({ context: q }) => {
  await q.removeIndex("registration_requests", "registration_requests_code_unique");
  await q.removeColumn("registration_requests", "code");
  await q.removeColumn("registration_requests", "tenant_id");
  await q.changeColumn("registration_requests", "distributor_org_id", {
    type: DataTypes.UUID, allowNull: false, references: { model: "organizations", key: "id" },
  });
};
