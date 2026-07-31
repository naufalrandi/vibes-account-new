import { randomUUID, createHash } from "node:crypto";
import { Op } from "sequelize";
import { User, RefreshToken, LoginHistory, Organization, DemoTenant } from "../../db/models";
import { verifyPassword, hashPassword, isPasswordValid } from "../../lib/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt";
import { getUserRoleNames } from "./access.service";
import { isDemoTenantActive } from "../demo/demo.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, UnauthorizedError } from "../../lib/errors";
import { env } from "../../config/env";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// A temporary, isolated demo-tenant session (OD `DEMO_SESS`) — present only
// when the authenticated user is one `generateDemoTenant()` provisioned. See
// fe-vibes-new's lib/api/types.ts DemoSessionInfo, which this mirrors exactly.
export interface DemoSessionInfo {
  tenantId: string;
  org: string;
  role: string;
  modules: string[];
  expiresAt: string;
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
  demoSession?: DemoSessionInfo;
}

/** Guards `demoLinkLogin` against non-UUID input reaching the DB layer. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function login(identifier: string, password: string, ip: string | null): Promise<LoginResult> {
  const user = await User.findOne({
    where: { [Op.or]: [{ username: identifier }, { email: identifier }] },
    include: [Organization],
  });

  // A distinct message/code for the demo-expired case would let an
  // unauthenticated caller confirm a guessed identifier+password pair is
  // cryptographically correct (just temporarily blocked) — always fail with
  // the same generic "Invalid credentials"/AUTH_FAILED the API returns for
  // everything else; the specific reason still lands in the audit trail via
  // `metadata` for internal visibility.
  const failAndThrow = async (metadata?: Record<string, unknown>) => {
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
      metadata,
    });
    throw new UnauthorizedError("Invalid credentials", "AUTH_FAILED");
  };

  if (!user || !user.passwordHash) return failAndThrow();
  if (user.status !== "Active") return failAndThrow();
  if (!(await verifyPassword(password, user.passwordHash))) return failAndThrow();

  // A demo-provisioned user (see demo.service.ts's generateDemoTenant) must
  // still be within its approved/active/unexpired window — checked here,
  // before any token is issued, so an expired demo can never walk away with a
  // valid JWT regardless of what the frontend does with the response.
  const demo = await DemoTenant.findOne({ where: { provisionedUserId: user.id } });
  if (demo && !isDemoTenantActive(demo)) return failAndThrow({ reason: "demo_expired" });

  return establishSession(user, ip, "auth.login.succeeded");
}

/**
 * Everything a successful sign-in does once the caller has been proven: issue
 * the token pair, record the login, and shape the session payload. Shared by
 * password login and demo-link login so the two can never drift apart.
 */
async function establishSession(user: User, ip: string | null, action: string): Promise<LoginResult> {
  const org = user.get("Organization") as Organization;
  const demo = await DemoTenant.findOne({ where: { provisionedUserId: user.id } });
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
  await user.save();
  await LoginHistory.create({ userId: user.id, sourceIp: ip, result: "Success" });
  await writeAudit({
    actorUserId: user.id,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action,
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
    demoSession: demo
      ? { tenantId: demo.tenantId, org: demo.org, role: demo.role, modules: demo.modules, expiresAt: demo.expiresAt!.toISOString() }
      : undefined,
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

/**
 * OD's `#demo=<id>` deep link signs the visitor straight in. Ported, because
 * the demo id is a v4 UUID: possession of the link *is* the credential, which
 * makes this a magic link rather than a credential-free bypass. The window is
 * still enforced — an unapproved, disabled or expired demo gets nothing, and
 * every attempt is audited.
 *
 * Failures are deliberately uniform: a distinct "expired" vs "unknown" reply
 * would let a caller probe which demo ids exist.
 */
export async function demoLinkLogin(demoId: string, ip: string | null): Promise<LoginResult> {
  const reject = async (reason: string, userId: string | null = null) => {
    await writeAudit({
      actorUserId: userId, action: "auth.demoLink.failed", entityType: "DemoTenant",
      // `entityId` is a UUID column, so a malformed id goes to metadata instead
      // of blowing up the audit write we are in the middle of recording.
      entityId: UUID_RE.test(demoId) ? demoId : null,
      sourceIp: ip, result: "Failure", metadata: { reason, demoId },
    });
    throw new UnauthorizedError("This demo link is not valid", "DEMO_LINK_INVALID");
  };

  if (!UUID_RE.test(demoId)) return reject("malformed_id");

  const demo = await DemoTenant.findByPk(demoId);
  if (!demo) return reject("not_found");
  if (!demo.provisionedUserId) return reject("not_provisioned");
  if (!isDemoTenantActive(demo)) return reject("expired", demo.provisionedUserId);

  const user = await User.findByPk(demo.provisionedUserId, { include: [Organization] });
  if (!user || user.status !== "Active") return reject("user_inactive", demo.provisionedUserId);

  return establishSession(user, ip, "auth.demoLink.succeeded");
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

  if (stored.revokedAt) {
    // The token verified and matched a stored hash but was already revoked:
    // it was rotated out or logged out. Reuse means the token leaked — revoke
    // all of the user's live sessions and reject.
    await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: payload.sub, revokedAt: null } });
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

  if (stored.expiresAt < new Date()) {
    await auditRefreshFailure(payload.sub, ip, "expired");
    throw new UnauthorizedError("Refresh token expired or revoked");
  }

  const user = await User.findByPk(payload.sub, { include: [Organization] });
  if (!user || user.status !== "Active") {
    await auditRefreshFailure(payload.sub, ip, "user_inactive");
    throw new UnauthorizedError("User not active");
  }

  // Independent of the User.status check above (which a demo-lifecycle change
  // should already have flipped) — a demo session's refresh token must die the
  // moment the workspace is no longer active, not just at its next login.
  const demo = await DemoTenant.findOne({ where: { provisionedUserId: user.id } });
  if (demo && !isDemoTenantActive(demo)) {
    await auditRefreshFailure(user.id, ip, "demo_expired");
    throw new UnauthorizedError("This demo workspace has expired or been disabled and can no longer sign in.", "DEMO_EXPIRED");
  }

  const org = user.get("Organization") as Organization;
  const roles = await getUserRoleNames(user.id);

  // Rotate: revoke the presented token, mint and persist a fresh one.
  stored.revokedAt = new Date();
  await stored.save();
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
    orgType: org.type,
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
    throw new BadRequestError("Password does not meet policy", "WEAK_PASSWORD");
  }
  const user = await User.findOne({ where: { activationToken } });
  if (!user) throw new BadRequestError("Invalid activation token", "INVALID_TOKEN");
  user.passwordHash = await hashPassword(password);
  user.status = "Active";
  user.activationToken = null;
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
  if (!isPasswordValid(newPassword)) throw new BadRequestError("Password does not meet policy", "WEAK_PASSWORD");
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new BadRequestError("New password must differ from the current password", "PASSWORD_UNCHANGED");
  }

  user.passwordHash = await hashPassword(newPassword);
  user.resetToken = null;
  user.resetExpires = null;
  await user.save();

  // Force every other device to re-authenticate with the new password.
  await RefreshToken.update({ revokedAt: new Date() }, { where: { userId: user.id, revokedAt: null } });

  await writeAudit({
    actorUserId: user.id, organizationId: user.orgId, tenantId: user.tenantId,
    action: "auth.password.changed", entityType: "User", entityId: user.id,
    sourceIp: ip, result: "Success",
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await User.findOne({ where: { email } });
  if (!user) return; // do not reveal existence
  user.resetToken = randomUUID();
  user.resetExpires = new Date(Date.now() + 3600_000);
  await user.save();
}

export async function resetPassword(resetToken: string, password: string): Promise<void> {
  if (!isPasswordValid(password)) throw new BadRequestError("Password does not meet policy", "WEAK_PASSWORD");
  const user = await User.findOne({ where: { resetToken } });
  if (!user || !user.resetExpires || user.resetExpires < new Date()) {
    throw new BadRequestError("Invalid or expired reset token", "INVALID_TOKEN");
  }
  user.passwordHash = await hashPassword(password);
  user.resetToken = null;
  user.resetExpires = null;
  await user.save();
  await writeAudit({
    actorUserId: user.id,
    action: "auth.password.reset",
    entityType: "User",
    entityId: user.id,
    result: "Success",
  });
}
