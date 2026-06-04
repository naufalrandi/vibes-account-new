import { Op, type WhereOptions } from "sequelize";
import { Profile } from "../../db/models";
import type { ProfileStatus } from "../../db/models/profile.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { NotFoundError } from "../../lib/errors";

export interface CreateProfileInput {
  name: string;
  description?: string | null;
  status?: ProfileStatus;
}

export type UpdateProfileInput = Partial<CreateProfileInput>;

export interface ListProfileFilters {
  search?: string;
  status?: ProfileStatus;
}

export interface ListProfilesResult {
  rows: Profile[];
  total: number;
}

/**
 * Build the WHERE clause for a list query. The org filter is always taken from
 * the authenticated context — never from request input — so a caller can only
 * ever see its own organization's profiles. `search` matches name OR
 * description case-insensitively; `status` filters on the Active/Inactive enum.
 */
function listWhere(auth: AuthContext, filters: ListProfileFilters): WhereOptions {
  const and: WhereOptions[] = [{ orgId: auth.orgId }];
  if (filters.status) and.push({ status: filters.status });
  if (filters.search) {
    const term = `%${filters.search}%`;
    and.push({
      [Op.or]: [{ name: { [Op.iLike]: term } }, { description: { [Op.iLike]: term } }],
    });
  }
  return { [Op.and]: and };
}

export async function listProfiles(
  auth: AuthContext,
  filters: ListProfileFilters = {},
): Promise<ListProfilesResult> {
  const { rows, count } = await Profile.findAndCountAll({
    where: listWhere(auth, filters),
    order: [["createdAt", "DESC"]],
  });
  return { rows, total: count };
}

/** Resolve a single profile owned by the actor's org, or 404. */
async function requireOwnedProfile(auth: AuthContext, id: string): Promise<Profile> {
  const profile = await Profile.findOne({ where: { id, orgId: auth.orgId } });
  if (!profile) throw new NotFoundError("Profile does not exist", "PROFILE_NOT_FOUND");
  return profile;
}

export async function createProfile(
  auth: AuthContext,
  input: CreateProfileInput,
  ip: string | null,
): Promise<Profile> {
  const profile = await Profile.create({
    orgId: auth.orgId,
    name: input.name,
    description: input.description ?? null,
    status: input.status ?? "Active",
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "profile.created",
    entityType: "Profile",
    entityId: profile.id,
    sourceIp: ip,
    result: "Success",
  });
  return profile;
}

export async function updateProfile(
  auth: AuthContext,
  id: string,
  input: UpdateProfileInput,
  ip: string | null,
): Promise<Profile> {
  const profile = await requireOwnedProfile(auth, id);
  if (input.name !== undefined) profile.name = input.name;
  if (input.description !== undefined) profile.description = input.description ?? null;
  if (input.status !== undefined) profile.status = input.status;
  await profile.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "profile.updated",
    entityType: "Profile",
    entityId: profile.id,
    sourceIp: ip,
    result: "Success",
  });
  return profile;
}

export async function deleteProfile(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const profile = await requireOwnedProfile(auth, id);
  await profile.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "profile.deleted",
    entityType: "Profile",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
