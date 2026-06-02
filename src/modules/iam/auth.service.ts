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
  user: { id: string; username: string; email: string; orgId: string };
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

  return { accessToken, refreshToken, user: { id: user.id, username: user.username, email: user.email, orgId: user.orgId } };
}

export async function refresh(token: string): Promise<{ accessToken: string }> {
  let payload: { sub: string };
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw new UnauthorizedError("Invalid refresh token");
  }
  const stored = await RefreshToken.findOne({ where: { userId: payload.sub, tokenHash: sha(token), revokedAt: null } });
  if (!stored || stored.expiresAt < new Date()) throw new UnauthorizedError("Refresh token expired or revoked");

  const user = await User.findByPk(payload.sub, { include: [Organization] });
  if (!user || user.status !== "Active") throw new UnauthorizedError("User not active");
  const org = user.get("Organization") as Organization;
  const roles = await getUserRoleNames(user.id);
  return {
    accessToken: signAccessToken({ sub: user.id, orgId: user.orgId, tenantId: user.tenantId, orgType: org.type, roles }),
  };
}

export async function logout(token: string): Promise<void> {
  await RefreshToken.update({ revokedAt: new Date() }, { where: { tokenHash: sha(token) } });
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
