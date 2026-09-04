import { PersonnelProfile, User } from "../../db/models";
import type { EmploymentStatus, ContractType } from "../../db/models/personnelProfile.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError } from "../../lib/errors";
import { requireManagedUser } from "./user.service";

export interface PersonalInput {
  dateOfBirth?: string | null;
  gender?: string | null;
  maritalStatus?: string | null;
  nationality?: string | null;
  idNumber?: string | null;
  religion?: string | null;
  bloodType?: string | null;
  address?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

export interface EmergencyContactInput {
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelationship?: string | null;
}

export interface EmploymentInput {
  personnelType?: string | null;
  employmentStatus?: EmploymentStatus | null;
  orgUnitId?: string | null;
  siteId?: string | null;
  department?: string | null;
  managerId?: string | null;
  employeeId?: string | null;
  contractType?: ContractType | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  probationEndDate?: string | null;
  contractDocumentRef?: string | null;
  contractSigned?: boolean;
}

/** Fetch (or lazily create) the 1:1 profile row for a managed user. */
export async function getOrCreateProfile(userId: string): Promise<PersonnelProfile> {
  const [profile] = await PersonnelProfile.findOrCreate({ where: { userId }, defaults: { userId } });
  return profile;
}

export async function getPersonnelProfile(auth: AuthContext, userId: string): Promise<PersonnelProfile> {
  await requireManagedUser(auth, userId);
  return getOrCreateProfile(userId);
}

export async function updatePersonal(
  auth: AuthContext,
  userId: string,
  input: PersonalInput,
  ip: string | null,
): Promise<PersonnelProfile> {
  const user = await requireManagedUser(auth, userId);
  const profile = await getOrCreateProfile(userId);
  Object.assign(profile, input);
  await profile.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "personnel.personal_updated",
    entityType: "User",
    entityId: userId,
    sourceIp: ip,
    result: "Success",
  });
  return profile;
}

export async function updateEmergencyContact(
  auth: AuthContext,
  userId: string,
  input: EmergencyContactInput,
  ip: string | null,
): Promise<PersonnelProfile> {
  const user = await requireManagedUser(auth, userId);
  const profile = await getOrCreateProfile(userId);
  Object.assign(profile, input);
  await profile.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "personnel.emergency_updated",
    entityType: "User",
    entityId: userId,
    sourceIp: ip,
    result: "Success",
  });
  return profile;
}

/** A manager reference must be another user in the same org as the subject. */
async function assertManagerInOrg(managerId: string, orgId: string): Promise<void> {
  const manager = await User.findOne({ where: { id: managerId, orgId } });
  if (!manager) throw new BadRequestError("Manager does not belong to this organization", "MANAGER_NOT_FOUND");
}

export async function updateEmployment(
  auth: AuthContext,
  userId: string,
  input: EmploymentInput,
  ip: string | null,
): Promise<PersonnelProfile> {
  const user = await requireManagedUser(auth, userId);
  if (input.managerId) await assertManagerInOrg(input.managerId, user.orgId);

  // personnelType/orgUnitId/siteId/department already live on User (OD tn-team
  // fields); everything else in the modal is new, profile-owned employment data.
  if (input.personnelType !== undefined) user.personnelType = input.personnelType;
  if (input.orgUnitId !== undefined) user.orgUnitId = input.orgUnitId;
  if (input.siteId !== undefined) user.siteId = input.siteId;
  if (input.department !== undefined) user.department = input.department;
  await user.save();

  const profile = await getOrCreateProfile(userId);
  const { personnelType: _pt, orgUnitId: _ou, siteId: _sid, department: _dept, ...employmentFields } = input;
  Object.assign(profile, employmentFields);
  await profile.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "personnel.employment_updated",
    entityType: "User",
    entityId: userId,
    sourceIp: ip,
    result: "Success",
  });
  return profile;
}

/** Extend an active contract by moving its end date out (contract-renewal lifecycle action). */
export async function renewContract(
  auth: AuthContext,
  userId: string,
  contractEndDate: string,
  ip: string | null,
): Promise<PersonnelProfile> {
  const user = await requireManagedUser(auth, userId);
  const profile = await getOrCreateProfile(userId);
  if (profile.contractEndDate && contractEndDate <= profile.contractEndDate) {
    throw new BadRequestError("Renewed end date must be after the current contract end date", "INVALID_RENEWAL_DATE");
  }
  profile.contractEndDate = contractEndDate;
  profile.employmentStatus = "Active";
  await profile.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "personnel.contract_renewed",
    entityType: "User",
    entityId: userId,
    sourceIp: ip,
    result: "Success",
  });
  return profile;
}

/** Convert a fixed-term/probation contract to a new contract type (e.g. Permanent). */
export async function convertContract(
  auth: AuthContext,
  userId: string,
  contractType: ContractType,
  ip: string | null,
): Promise<PersonnelProfile> {
  const user = await requireManagedUser(auth, userId);
  const profile = await getOrCreateProfile(userId);
  profile.contractType = contractType;
  profile.employmentStatus = "Active";
  await profile.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "personnel.contract_converted",
    entityType: "User",
    entityId: userId,
    sourceIp: ip,
    result: "Success",
  });
  return profile;
}

/**
 * Confirm a completed probation period.
 *
 * Probation is a property of the CONTRACT, not of employment status — OD keeps
 * it on `contractType`/`probationEnd` and never had a "Probation" employment
 * status (`PERSON_EMP_STATUS`). Someone on probation is employed and Active.
 * So this gates on the contract type and converts the contract to Permanent,
 * rather than moving an employment status that was never the right home for it.
 */
export async function confirmProbation(auth: AuthContext, userId: string, ip: string | null): Promise<PersonnelProfile> {
  const user = await requireManagedUser(auth, userId);
  const profile = await getOrCreateProfile(userId);
  if (profile.contractType !== "Probation") {
    throw new BadRequestError("User is not currently on probation", "NOT_ON_PROBATION");
  }
  profile.contractType = "Permanent";
  // Confirming probation also brings anyone still mid-onboarding fully on.
  if (profile.employmentStatus !== "Active") profile.employmentStatus = "Active";
  await profile.save();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "personnel.probation_confirmed",
    entityType: "User",
    entityId: userId,
    sourceIp: ip,
    result: "Success",
  });
  return profile;
}
