import { randomUUID, createHash } from "node:crypto";
import { Op, col, fn, where as sqlWhere, type Transaction, type WhereOptions } from "sequelize";
import { User, RefreshToken, LoginHistory, Organization } from "../../db/models";
import { verifyPassword, hashPassword, isPasswordValid, PASSWORD_POLICY_MESSAGE } from "../../lib/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt";
import { hashToken, newOpaqueToken } from "../../lib/tokens";
import { getUserRoleNames, isAccountActive } from "./access.service";
import { writeAudit } from "../audit/audit.service";
import { sendPasswordReset } from "../notifications/notification.service";
import { BadRequestError, ConflictError, UnauthorizedError } from "../../lib/errors";
import { env } from "../../config/env";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// Brute-force lockout: this many failed sign-ins inside the window locks the
// account for LOCKOUT_MS. Counted from login_history, not a counter column.
const MAX_FAILED_LOGINS = 10;
const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;
const LOCKOUT_MS = 15 * 60_000;
const RESET_TOKEN_TTL_MS = 60 * 60_000;

/** Case-insensitive `lower(column) = lower(value)` predicate for identity lookups. */
export function lowerEq(column: string, value: string): WhereOptions {
  return sqlWhere(fn("lower", col(column)), value.toLowerCase());
}

/** Sign-in matches identifiers case-insensitively, so a new account's username/email must be free that way too. */
export async function assertIdentityAvailable(username: string, email: string | null | undefined, tx?: Transaction): Promise<void> {
  const clauses = [lowerEq("username", username), ...(email ? [lowerEq("email", email)] : [])];
  const existing = await User.findOne({ where: { [Op.or]: clauses }, attributes: ["id"], transaction: tx });
  if (existing) throw new ConflictError("Username or email already exists", "DUPLICATE_USER");
}

/** Revoke every live refresh token of the given users (suspension, deletion, reset). */
export async function revokeUserSessions(userIds: string[], tx?: Transaction): Promise<void> {
  if (userIds.length === 0) return;
  await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { userId: userIds, revokedAt: null }, transaction: tx },
  );
}

/** Revoke every live refresh token held by members of an organization. */
export async function revokeOrgSessions(orgId: string, tx?: Transaction): Promise<void> {
  const users = await User.findAll({ where: { orgId }, attributes: ["id"], transaction: tx });
  await revokeUserSessions(users.map((u) => u.id), tx);
}

// Unknown, locked and passwordless accounts still pay for one bcrypt compare,
// so response timing does not reveal which identifiers exist.
let dummyHash: Promise<string> | undefined;
async function dummyVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomUUID());
  await verifyPassword(password, await dummyHash);
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    email: string;
    orgId: string;
    orgType: "ServiceOwner" | "Distributor" | "Tenant";
    orgName: string;
    roles: string[];
    // Personal profile fields surfaced for the "My Profile" / "Account Settings"
    // screens (AXIA mockup parity). Nullable when not set.
    fullName: string;
    position: string | null;
    phone: string | null;
    photo: string | null;
    lastLogin: string | null;
    createdAt: string | null;
  };
}

/**
 * Resolve a sign-in identifier case-insensitively against username OR email.
 * Deterministic when several rows match: an exact username wins, then a
 * case-insensitive username, then an email; ties go to the oldest account.
 */
async function findLoginUser(identifier: string): Promise<User | null> {
  const lower = identifier.toLowerCase();
  const candidates = await User.findAll({
    where: {
      status: { [Op.ne]: "Deleted" },
      [Op.or]: [lowerEq("User.username", identifier), lowerEq("User.email", identifier)],
    },
    include: [Organization],
    order: [["createdAt", "ASC"], ["id", "ASC"]],
  });
  return (
    candidates.find((u) => u.username === identifier) ??
    candidates.find((u) => u.username.toLowerCase() === lower) ??
    candidates.find((u) => u.email.toLowerCase() === lower) ??
    null
  );
}

/** After a wrong password: lock the account once the failure budget is spent. */
async function lockIfOverBudget(user: User, ip: string | null): Promise<void> {
  const now = Date.now();
  // Count from the latest of: window start, last success, last lock — so an
  // expired lock or a successful sign-in starts a fresh budget.
  const since = Math.max(
    now - FAILED_LOGIN_WINDOW_MS,
    user.lastLogin?.getTime() ?? 0,
    user.lockedUntil ? user.lockedUntil.getTime() - LOCKOUT_MS : 0,
  );
  const failures = await LoginHistory.count({
    where: { userId: user.id, result: "Failure", at: { [Op.gt]: new Date(since) } },
  });
  if (failures < MAX_FAILED_LOGINS) return;
  user.lockedUntil = new Date(now + LOCKOUT_MS);
  await user.save();
  await writeAudit({
    actorUserId: user.id,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "auth.login.locked",
    entityType: "User",
    entityId: user.id,
    sourceIp: ip,
    result: "Failure",
    metadata: { failures, lockedUntil: user.lockedUntil.toISOString() },
  });
}

export async function login(identifier: string, password: string, ip: string | null): Promise<LoginResult> {
  const user = await findLoginUser(identifier);

  // Every refusal — unknown user, wrong password, locked, inactive user or
  // org — returns the same generic AUTH_FAILED, so a caller cannot tell a
  // correct-but-blocked credential from a wrong one. The specific reason
  // still lands in the audit trail via `metadata`.
  const recordFailure = async (reason: string) => {
    await LoginHistory.create({ userId: user?.id ?? null, sourceIp: ip, result: "Failure" });
    await writeAudit({
      actorUserId: user?.id ?? null,
      organizationId: user?.orgId,
      tenantId: user?.tenantId,
      action: "auth.login.failed",
      entityType: "User",
      entityId: user?.id ?? null,
      sourceIp: ip,
      result: "Failure",
      metadata: { reason },
    });
  };
  const authFailed = () => new UnauthorizedError("Invalid credentials", "AUTH_FAILED");

  if (!user || !user.passwordHash) {
    await dummyVerify(password);
    await recordFailure(user ? "no_password" : "unknown_identifier");
    throw authFailed();
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await dummyVerify(password);
    await recordFailure("locked");
    throw authFailed();
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordFailure("bad_password");
    await lockIfOverBudget(user, ip);
    throw authFailed();
  }
  const org = user.get("Organization") as Organization | undefined;
  if (!isAccountActive(user, org)) {
    await recordFailure("inactive");
    throw authFailed();
  }

  return establishSession(user, org!, ip);
}

/** Issue the token pair, record the login, and shape the session payload. */
async function establishSession(user: User, org: Organization, ip: string | null): Promise<LoginResult> {
  const roles = await getUserRoleNames(user.id);
  const accessToken = signAccessToken({
    sub: user.id,
    orgId: user.orgId,
    tenantId: user.tenantId,
    orgType: org.type,
    roles,
  });
  const refreshToken = signRefreshToken(user.id);
  await RefreshToken.create({
    userId: user.id,
    tokenHash: sha(refreshToken),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
    revokedAt: null,
  });

  user.lastLogin = new Date();
  user.lockedUntil = null;
  await user.save();
  await LoginHistory.create({ userId: user.id, sourceIp: ip, result: "Success" });
  await writeAudit({
    actorUserId: user.id,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "auth.login.succeeded",
    entityType: "User",
    entityId: user.id,
    sourceIp: ip,
    result: "Success",
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      orgId: user.orgId,
      orgType: org.type,
      orgName: org.name,
      roles,
      fullName: user.fullName,
      position: user.position ?? null,
      phone: user.phone ?? null,
      photo: user.photo ?? null,
      lastLogin: user.lastLogin ? user.lastLogin.toISOString() : null,
      createdAt: user.createdAt ? user.createdAt.toISOString() : null,
    },
  };
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

async function auditRefreshFailure(userId: string | null, ip: string | null, reason: string): Promise<void> {
  await writeAudit({
    actorUserId: userId,
    action: "auth.refresh.failed",
    entityType: "User",
    entityId: userId,
    sourceIp: ip,
    result: "Failure",
    metadata: { reason },
  });
}

export async function refresh(token: string, ip: string | null = null): Promise<RefreshResult> {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(token);
  } catch {
    await auditRefreshFailure(null, ip, "invalid_token");
    throw new UnauthorizedError("Invalid refresh token");
  }

  const tokenHash = sha(token);
  const stored = await RefreshToken.findOne({ where: { userId: payload.sub, tokenHash } });
  if (!stored) {
    await auditRefreshFailure(payload.sub, ip, "unknown_token");
    throw new UnauthorizedError("Invalid refresh token");
  }

  if (stored.expiresAt < new Date()) {
    await auditRefreshFailure(payload.sub, ip, "expired");
    throw new UnauthorizedError("Refresh token expired or revoked");
  }

  const user = await User.findByPk(payload.sub, { include: [Organization] });
  const org = user?.get("Organization") as Organization | undefined;
  if (!user || !isAccountActive(user, org)) {
    await auditRefreshFailure(payload.sub, ip, "user_inactive");
    throw new UnauthorizedError("User not active");
  }

  // Rotate by atomically claiming the presented token: only one request can
  // flip revoked_at from NULL. Zero rows means it was already rotated out or
  // logged out — reuse means the token leaked (or two tabs raced), so revoke
  // all of the user's live sessions and reject.
  const [claimed] = await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { id: stored.id, revokedAt: null } },
  );
  if (claimed === 0) {
    await revokeUserSessions([payload.sub]);
    await writeAudit({
      actorUserId: payload.sub,
      action: "auth.refresh.reuse_detected",
      entityType: "User",
      entityId: payload.sub,
      sourceIp: ip,
      result: "Failure",
    });
    throw new UnauthorizedError("Refresh token reuse detected");
  }

  const roles = await getUserRoleNames(user.id);
  const refreshToken = signRefreshToken(user.id);
  await RefreshToken.create({
    userId: user.id,
    tokenHash: sha(refreshToken),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86400_000),
    revokedAt: null,
  });

  const accessToken = signAccessToken({
    sub: user.id,
    orgId: user.orgId,
    tenantId: user.tenantId,
    orgType: org!.type,
    roles,
  });
  return { accessToken, refreshToken };
}

export async function logout(token: string, ip: string | null = null): Promise<void> {
  const [affected] = await RefreshToken.update(
    { revokedAt: new Date() },
    { where: { tokenHash: sha(token), revokedAt: null } },
  );
  let actorUserId: string | null = null;
  try {
    actorUserId = verifyRefreshToken(token).sub;
  } catch {
    // best-effort: log the logout even if the token can no longer be verified
  }
  await writeAudit({
    actorUserId,
    action: "auth.logout",
    entityType: "User",
    entityId: actorUserId,
    sourceIp: ip,
    result: affected > 0 ? "Success" : "Failure",
  });
}

export async function activate(activationToken: string, password: string): Promise<void> {
  if (!isPasswordValid(password)) {
    throw new BadRequestError(PASSWORD_POLICY_MESSAGE, "WEAK_PASSWORD");
  }
  // Only the hash is stored; the link is single-use (cleared below), bound to
  // a still-pending account, and expires.
  const user = await User.findOne({ where: { activationToken: hashToken(activationToken) } });
  if (
    !user ||
    user.status !== "Pending Activation" ||
    !user.activationTokenExpiresAt ||
    user.activationTokenExpiresAt < new Date()
  ) {
    throw new BadRequestError("Invalid activation token", "INVALID_TOKEN");
  }
  user.passwordHash = await hashPassword(password);
  user.status = "Active";
  user.activationToken = null;
  user.activationTokenExpiresAt = null;
  await user.save();
  await writeAudit({
    actorUserId: user.id,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "user.activated",
    entityType: "User",
    entityId: user.id,
    result: "Success",
  });
}

/**
 * Self-service password change for a signed-in user. Distinct from the
 * token-based forgot/reset flow: it proves possession of the *current*
 * password rather than of an emailed token, so it needs no token at all.
 * Every other session is revoked on success — a password change is the
 * standard way to kick out a session you think is compromised.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  ip: string | null = null,
): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user || !user.passwordHash) throw new UnauthorizedError("Invalid credentials", "AUTH_FAILED");

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    await writeAudit({
      actorUserId: user.id, organizationId: user.orgId, tenantId: user.tenantId,
      action: "auth.password.change.failed", entityType: "User", entityId: user.id,
      sourceIp: ip, result: "Failure", metadata: { reason: "current_password_mismatch" },
    });
    throw new UnauthorizedError("Current password is incorrect", "CURRENT_PASSWORD_INVALID");
  }
  if (!isPasswordValid(newPassword)) throw new BadRequestError(PASSWORD_POLICY_MESSAGE, "WEAK_PASSWORD");
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new BadRequestError("New password must differ from the current password", "PASSWORD_UNCHANGED");
  }

  user.passwordHash = await hashPassword(newPassword);
  user.resetToken = null;
  user.resetExpires = null;
  await user.save();

  // Force every other device to re-authenticate with the new password.
  await revokeUserSessions([user.id]);

  await writeAudit({
    actorUserId: user.id, organizationId: user.orgId, tenantId: user.tenantId,
    action: "auth.password.changed", entityType: "User", entityId: user.id,
    sourceIp: ip, result: "Success",
  });
}

/**
 * Mail a one-hour, single-use reset link. The caller always gets the same
 * answer whether or not the address matches an Active account.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await User.findOne({
    where: { [Op.and]: [lowerEq("email", email), { status: "Active" }] },
    order: [["createdAt", "ASC"], ["id", "ASC"]],
  });
  if (!user) return; // do not reveal existence
  const { raw, hash } = newOpaqueToken();
  user.resetToken = hash;
  user.resetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await user.save();
  await sendPasswordReset(user.email, raw);
}

export async function resetPassword(resetToken: string, password: string): Promise<void> {
  if (!isPasswordValid(password)) throw new BadRequestError(PASSWORD_POLICY_MESSAGE, "WEAK_PASSWORD");
  const hash = hashToken(resetToken);
  const user = await User.findOne({ where: { resetToken: hash } });
  if (!user || user.status !== "Active" || !user.resetExpires || user.resetExpires < new Date()) {
    throw new BadRequestError("Invalid or expired reset token", "INVALID_TOKEN");
  }
  // Single use: the write is conditional on the token still being there, so
  // two concurrent submissions of the same link cannot both succeed.
  const [claimed] = await User.update(
    { passwordHash: await hashPassword(password), resetToken: null, resetExpires: null, lockedUntil: null },
    { where: { id: user.id, resetToken: hash } },
  );
  if (claimed === 0) throw new BadRequestError("Invalid or expired reset token", "INVALID_TOKEN");
  // Whoever held a session may be who the owner is locking out.
  await revokeUserSessions([user.id]);
  await writeAudit({
    actorUserId: user.id,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "auth.password.reset",
    entityType: "User",
    entityId: user.id,
    result: "Success",
  });
}
