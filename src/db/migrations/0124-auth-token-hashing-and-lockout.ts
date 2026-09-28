import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Auth hardening.
 *
 * a) `activation_token_expires_at` — activation links now expire (7 days from
 *    issue, `issueActivationToken`); `locked_until` — brute-force lockout.
 * b) Activation/reset tokens are now stored as SHA-256 hashes and looked up by
 *    `hashToken(raw)` (src/lib/tokens.ts). Existing plaintext values are hashed
 *    in place with the same function, so links already in inboxes keep working.
 *    Rows already holding 64 hex chars are left alone (re-run safe).
 * c) Outstanding activation tokens had no expiry; they get seven days from now.
 */
const HASH = (col: string) => `encode(sha256(convert_to(${col}, 'UTF8')), 'hex')`;
const NOT_HASHED = (col: string) => `${col} IS NOT NULL AND ${col} !~ '^[0-9a-f]{64}$'`;

export const up: Migration = async ({ context: q }) => {
  const cols = await q.describeTable("users");
  if (!("activation_token_expires_at" in cols)) {
    await q.addColumn("users", "activation_token_expires_at", { type: DataTypes.DATE, allowNull: true });
  }
  if (!("locked_until" in cols)) {
    await q.addColumn("users", "locked_until", { type: DataTypes.DATE, allowNull: true });
  }
  await q.sequelize.query(
    `UPDATE users SET activation_token = ${HASH("activation_token")} WHERE ${NOT_HASHED("activation_token")}`,
  );
  await q.sequelize.query(`UPDATE users SET reset_token = ${HASH("reset_token")} WHERE ${NOT_HASHED("reset_token")}`);
  await q.sequelize.query(
    `UPDATE users SET activation_token_expires_at = now() + interval '7 days'
     WHERE activation_token IS NOT NULL AND activation_token_expires_at IS NULL`,
  );
};

// Hashing is one-way: down only drops the columns; hashed tokens stay hashed.
export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("users", "locked_until");
  await q.removeColumn("users", "activation_token_expires_at");
};
