import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * AXIA "My Profile" alignment — the mockup's personal profile edits Full Name,
 * Phone, and Job Title, and Account Settings shows Created / Last Login. `position`
 * (Job Title), `last_login`, and `created_at` already exist on `users`; this adds
 * the two missing personal-contact columns so the profile round-trips end-to-end.
 * `photo` is TEXT to allow inline data URLs (the mockup stores uploaded avatars
 * as base64), `phone` is a plain string.
 */
export const up: Migration = async ({ context: q }) => {
  await q.addColumn("users", "phone", { type: DataTypes.STRING, allowNull: true });
  await q.addColumn("users", "photo", { type: DataTypes.TEXT, allowNull: true });
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("users", "phone");
  await q.removeColumn("users", "photo");
};
