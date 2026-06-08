import { randomUUID, createHash } from "node:crypto";
import { Op } from "sequelize";
import { User, RefreshToken, LoginHistory, Organization } from "../../db/models";
import { verifyPassword, hashPassword, isPasswordValid } from "../../lib/password";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt";
import { getUserRoleNames } from "./access.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, UnauthorizedError } from "../../lib/errors";
import { env } from "../../config/env";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

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

export async function login(identifier: string, password: string, ip: string | null): Promise<LoginResult> {
  const user = await User.findOne({
    where: { [Op.or]: [{ username: identifier }, { email: identifier }] },
    include: [Organization],
  });

  const failAndThrow = async () => {
    await LoginHistory.create({ userId: user?.id ?? null, sourceIp: ip, result: "Failure" });
    await writeAudit({
      actorUserId: user?.id ?? null,
      action: "auth.login.failed",
      entityType: "User",
      entityId: user?.id ?? null,
      sourceIp: ip,
      result: "Failure",
    });
    throw new UnauthorizedError("Invalid credentials", "AUTH_FAILED");
  };

  if (!user || !user.passwordHash) return failAndThrow();
  if (user.status !== "Active") return failAndThrow();
  if (!(await verifyPassword(password, user.passwordHash))) return failAndThrow();

  const org = user.get("Organization") as Organization;
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

// Refresh rotates the token: the presented token is revoked and a brand-new
// refresh token is issued. Presenting an already-revoked token is treated as
// reuse (theft signal) and revokes every active session for the user.
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
