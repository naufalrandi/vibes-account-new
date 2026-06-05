import { randomUUID } from "node:crypto";
import { Op, type Includeable, type WhereOptions } from "sequelize";
import { User, Organization, Role, UserRole } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { userScopeWhere } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { sendActivationInvite } from "../notifications/notification.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { isAllowedRoleForOrgType } from "../iam/role.catalog";

export interface CreateUserInput {
  orgId: string;
  fullName: string;
  username: string;
  email: string;
  role?: string;
  position?: string | null;
  workUnit?: string | null;
}

export interface UserFilters {
  orgType?: string;
  orgId?: string;
  role?: string;
  status?: string;
  email?: string;
  username?: string;
  /** Free-text term matched against email OR username. */
  search?: string;
}

export async function createUser(auth: AuthContext, input: CreateUserInput, ip: string | null): Promise<User> {
  // Precondition: organization must exist (PRD FR-1).
  const org = await Organization.findByPk(input.orgId);
  if (!org) throw new BadRequestError("Organization does not exist", "ORG_NOT_FOUND");

  // A role supplied on invite must be assignable for this org's type (PRD role
  // model). Validation is by canonical role name; the hidden "Super Admin" role
  // is never assigned this way (it is gated by tierScope in assignRole).
  if (input.role && !isAllowedRoleForOrgType(org.type, input.role)) {
    throw new BadRequestError(
      `Role "${input.role}" is not valid for organization type ${org.type}`,
      "INVALID_ROLE_FOR_ORG_TYPE",
    );
  }

  // Scope: actor must be allowed to manage this org's users.
  if (auth.orgType === "Tenant" && org.id !== auth.orgId) throw new ForbiddenError();
  if (auth.orgType === "Distributor" && org.parentOrgId !== auth.orgId && org.id !== auth.orgId) throw new ForbiddenError();

  const existing = await User.findOne({ where: { [Op.or]: [{ username: input.username }, { email: input.email }] } });
  if (existing) throw new ConflictError("Username or email already exists", "DUPLICATE_USER");

  const activationToken = randomUUID();
  const user = await User.create({
    orgId: org.id,
    tenantId: org.tenantId ?? (org.type === "Tenant" ? org.id : null),
    fullName: input.fullName,
    username: input.username,
    email: input.email,
    passwordHash: null,
    status: "PendingActivation",
    position: input.position ?? null,
    workUnit: input.workUnit ?? null,
    lastLogin: null,
    activationToken,
    resetToken: null,
    resetExpires: null,
  });

  // Optional role assignment on invite. Best-effort: a role name that does not
  // resolve to an existing role leaves the user role-less rather than failing
  // the whole invite (the role catalog is managed separately).
  if (input.role) {
    const role = await Role.findOne({ where: { name: input.role } });
    if (role) await UserRole.findOrCreate({ where: { userId: user.id, roleId: role.id } });
  }

  sendActivationInvite(user.email, activationToken);
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: org.id,
    tenantId: user.tenantId,
    action: "user.created",
    entityType: "User",
    entityId: user.id,
    sourceIp: ip,
    result: "Success",
  });
  // Reload with roles so the response carries the assigned role.
  return (await User.findByPk(user.id, { include: [Role] })) ?? user;
}

export async function resendActivation(auth: AuthContext, userId: string, ip: string | null): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user) throw new NotFoundError("User not found");
  // Same management scope as the other per-user operations.
  if (auth.orgType === "Tenant" && user.tenantId !== auth.tenantId) throw new ForbiddenError();
  if (auth.orgType === "Distributor") {
    const org = await Organization.findByPk(user.orgId);
    if (!org || (org.parentOrgId !== auth.orgId && org.id !== auth.orgId)) throw new ForbiddenError();
  }
  // Resending only makes sense while the account is awaiting activation; an
  // Active/Suspended/Inactive account has no pending invite to reissue.
  if (user.status !== "PendingActivation") {
    throw new BadRequestError("User is not pending activation", "NOT_PENDING_ACTIVATION");
  }

  // Rotate the token so the previously-mailed link is invalidated.
  const activationToken = randomUUID();
  user.activationToken = activationToken;
  await user.save();

  sendActivationInvite(user.email, activationToken);
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "user.activation_resent",
    entityType: "User",
    entityId: user.id,
    sourceIp: ip,
    result: "Success",
  });
}

export async function listUsers(auth: AuthContext, filters: UserFilters): Promise<User[]> {
  const where: WhereOptions = { ...userScopeWhere(auth) };
  if (filters.orgId) Object.assign(where, { orgId: filters.orgId });
  if (filters.status) Object.assign(where, { status: filters.status });
  if (filters.email) Object.assign(where, { email: { [Op.iLike]: `%${filters.email}%` } });
  if (filters.username) Object.assign(where, { username: { [Op.iLike]: `%${filters.username}%` } });
  // Free-text search matches email OR username. Wrapped in Op.and so it composes
  // with any Op.or the scope clause already contributes (Distributor scope).
  if (filters.search) {
    const term = `%${filters.search}%`;
    Object.assign(where, {
      [Op.and]: [{ [Op.or]: [{ email: { [Op.iLike]: term } }, { username: { [Op.iLike]: term } }] }],
    });
  }

  const orgWhere = filters.orgType ? { type: filters.orgType } : undefined;
  const include: Includeable[] = [{ model: Organization, where: orgWhere, required: !!orgWhere }];
  // Always include roles so the response carries the role name; when a role
  // filter is set, the join becomes required and narrows the result set.
  include.push(
    filters.role
      ? { model: Role, where: { name: filters.role }, required: true, through: { attributes: [] } }
      : { model: Role, required: false, through: { attributes: [] } },
  );

  return User.findAll({ where, include, order: [["createdAt", "DESC"]] });
}

export async function setUserStatus(
  auth: AuthContext,
  userId: string,
  status: "Active" | "Suspended" | "Inactive",
  ip: string | null,
): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw new NotFoundError("User not found");
  if (auth.orgType === "Tenant" && user.tenantId !== auth.tenantId) throw new ForbiddenError();
  user.status = status;
  await user.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: status === "Suspended" ? "user.suspended" : "user.modified",
    entityType: "User",
    entityId: user.id,
    sourceIp: ip,
    result: "Success",
  });
  return user;
}

export async function removeUser(auth: AuthContext, userId: string, ip: string | null): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user) throw new NotFoundError("User not found");
  if (auth.orgType === "Tenant" && user.tenantId !== auth.tenantId) throw new ForbiddenError();
  if (auth.orgType === "Distributor") {
    const org = await Organization.findByPk(user.orgId);
    if (!org || (org.parentOrgId !== auth.orgId && org.id !== auth.orgId)) throw new ForbiddenError();
  }
  const { orgId, tenantId } = user;
  // Drop role memberships first to satisfy the join-table FK, then the user.
  await UserRole.destroy({ where: { userId } });
  await user.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: orgId,
    tenantId,
    action: "user.removed",
    entityType: "User",
    entityId: userId,
    sourceIp: ip,
    result: "Success",
  });
}

export async function assignRole(auth: AuthContext, userId: string, roleId: string, ip: string | null): Promise<void> {
  const user = await User.findByPk(userId);
  const role = await Role.findByPk(roleId);
  if (!user || !role) throw new NotFoundError("User or role not found");
  if (auth.orgType === "Tenant" && user.tenantId !== auth.tenantId) throw new ForbiddenError();

  // The role's tier must match the user's organization type. This naturally
  // permits the ServiceOwner-only "Super Admin" (tierScope ServiceOwner) and
  // rejects cross-tier assignments.
  const org = await Organization.findByPk(user.orgId);
  if (!org) throw new BadRequestError("Organization does not exist", "ORG_NOT_FOUND");
  if (role.tierScope !== org.type) {
    throw new BadRequestError(
      `Role "${role.name}" is not valid for organization type ${org.type}`,
      "INVALID_ROLE_FOR_ORG_TYPE",
    );
  }

  await UserRole.findOrCreate({ where: { userId, roleId } });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "role.assigned",
    entityType: "User",
    entityId: user.id,
    sourceIp: ip,
    result: "Success",
    metadata: { roleId },
  });
}

export async function removeRole(auth: AuthContext, userId: string, roleId: string, ip: string | null): Promise<void> {
  const user = await User.findByPk(userId);
  if (!user) throw new NotFoundError("User not found");
  if (auth.orgType === "Tenant" && user.tenantId !== auth.tenantId) throw new ForbiddenError();
  await UserRole.destroy({ where: { userId, roleId } });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "role.removed",
    entityType: "User",
    entityId: user.id,
    sourceIp: ip,
    result: "Success",
    metadata: { roleId },
  });
}
