import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * SOF-58 follow-up — closes the last two genuine `users` gaps in
 * `parity/backend.md` (`department`, `provisioned`). The other four fields on
 * that row resolved to a rename (`title` -> `position`, already seeded from
 * the same role name) or a documented decision — `roleGroup` mirrors the
 * user's primary role name and is already relation-reachable via UserRole ->
 * Role.name, `superAdmin` is already relation-reachable via Role.isSuperAdmin
 * (`user.service.ts`'s `isSuper` check), and `hr` is an empty object on every
 * seeded record — recorded in `build-backend-parity.js`'s SYNONYM/DESIGN_ONLY
 * maps.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("users", "department", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("users", "provisioned", { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("users", "provisioned");
  await q.removeColumn("users", "department");
};
