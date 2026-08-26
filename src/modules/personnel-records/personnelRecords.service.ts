import { User, Organization, ResumeRecord, LeaveRecord, DisciplinaryRecord, PerformanceRecord } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { RESUME_RECORD_TYPES, LEAVE_TYPES, DISCIPLINARY_STATUSES, type ResumeRecordType, type DisciplinaryStatus } from "../../db/models/personnelRecords.models";

/**
 * Resolve the target personnel record's owning User, enforcing the same
 * Tenant/Distributor management scope as `requireManagedUser` in
 * user.service.ts (copied, not reinvented — see user.service.ts for the
 * canonical version).
 */
async function requireManagedUser(auth: AuthContext, userId: string): Promise<User> {
  const user = await User.findByPk(userId);
  if (!user) throw new NotFoundError("User not found");
  if (auth.orgType === "Tenant" && user.tenantId !== auth.tenantId) throw new ForbiddenError();
  if (auth.orgType === "Distributor") {
    const org = await Organization.findByPk(user.orgId);
    if (!org || (org.parentOrgId !== auth.orgId && org.id !== auth.orgId)) throw new ForbiddenError();
  }
  return user;
}

// --- Resume records (Education/Experience/Training/Certification) --------

export interface CreateResumeRecordInput {
  recordType: string;
  title: string;
  organization?: string | null;
  fieldOfStudy?: string | null;
  location?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isCurrent?: boolean;
  grade?: string | null;
  description?: string | null;
  credentialId?: string | null;
  issuer?: string | null;
  certificateNumber?: string | null;
  expiryDate?: string | null;
  attachmentUrl?: string | null;
  notes?: string | null;
}

export async function listResumeRecords(auth: AuthContext, userId: string): Promise<ResumeRecord[]> {
  await requireManagedUser(auth, userId);
  return ResumeRecord.findAll({ where: { userId }, order: [["createdAt", "DESC"]] });
}

export async function createResumeRecord(
  auth: AuthContext,
  userId: string,
  input: CreateResumeRecordInput,
  ip: string | null,
): Promise<ResumeRecord> {
  const user = await requireManagedUser(auth, userId);
  if (!RESUME_RECORD_TYPES.includes(input.recordType as ResumeRecordType)) {
    throw new BadRequestError(`recordType must be one of ${RESUME_RECORD_TYPES.join(", ")}`, "INVALID_RECORD_TYPE");
  }
  const record = await ResumeRecord.create({
    orgId: user.orgId,
    userId: user.id,
    recordType: input.recordType as ResumeRecordType,
    title: input.title,
    organization: input.organization ?? null,
    fieldOfStudy: input.fieldOfStudy ?? null,
    location: input.location ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    isCurrent: input.isCurrent ?? false,
    grade: input.grade ?? null,
    description: input.description ?? null,
    credentialId: input.credentialId ?? null,
    issuer: input.issuer ?? null,
    certificateNumber: input.certificateNumber ?? null,
    expiryDate: input.expiryDate ?? null,
    attachmentUrl: input.attachmentUrl ?? null,
    notes: input.notes ?? null,
    createdBy: auth.userId,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "resumeRecord.created",
    entityType: "ResumeRecord",
    entityId: record.id,
    sourceIp: ip,
    result: "Success",
  });
  return record;
}

export async function deleteResumeRecord(auth: AuthContext, userId: string, id: string, ip: string | null): Promise<void> {
  const user = await requireManagedUser(auth, userId);
  const record = await ResumeRecord.findOne({ where: { id, userId } });
  if (!record) throw new NotFoundError("Resume record not found");
  await record.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "resumeRecord.deleted",
    entityType: "ResumeRecord",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}

// --- Leave records ---------------------------------------------------------

export interface CreateLeaveRecordInput {
  leaveType: string;
  fromDate: string;
  toDate: string;
}

/** Inclusive calendar days — matches OD's own `personAddLeave` leaf-level behavior. */
function inclusiveCalendarDays(fromDate: string, toDate: string): number {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

export async function listLeaveRecords(auth: AuthContext, userId: string): Promise<LeaveRecord[]> {
  await requireManagedUser(auth, userId);
  return LeaveRecord.findAll({ where: { userId }, order: [["createdAt", "DESC"]] });
}

export async function createLeaveRecord(
  auth: AuthContext,
  userId: string,
  input: CreateLeaveRecordInput,
  ip: string | null,
): Promise<LeaveRecord> {
  const user = await requireManagedUser(auth, userId);
  if (!LEAVE_TYPES.includes(input.leaveType as (typeof LEAVE_TYPES)[number])) {
    throw new BadRequestError(`leaveType must be one of ${LEAVE_TYPES.join(", ")}`, "INVALID_LEAVE_TYPE");
  }
  const days = inclusiveCalendarDays(input.fromDate, input.toDate);
  if (days < 1) throw new BadRequestError("toDate must be on or after fromDate", "INVALID_DATE_RANGE");
  const record = await LeaveRecord.create({
    orgId: user.orgId,
    userId: user.id,
    leaveType: input.leaveType,
    fromDate: input.fromDate,
    toDate: input.toDate,
    days,
    createdBy: auth.userId,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "leaveRecord.created",
    entityType: "LeaveRecord",
    entityId: record.id,
    sourceIp: ip,
    result: "Success",
  });
  return record;
}

export async function deleteLeaveRecord(auth: AuthContext, userId: string, id: string, ip: string | null): Promise<void> {
  const user = await requireManagedUser(auth, userId);
  const record = await LeaveRecord.findOne({ where: { id, userId } });
  if (!record) throw new NotFoundError("Leave record not found");
  await record.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "leaveRecord.deleted",
    entityType: "LeaveRecord",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}

// --- Disciplinary records ---------------------------------------------------

export interface CreateDisciplinaryRecordInput {
  disciplineType: string;
  incidentDate: string;
  description: string;
  actionTaken?: string | null;
  status?: string;
}

export async function listDisciplinaryRecords(auth: AuthContext, userId: string): Promise<DisciplinaryRecord[]> {
  await requireManagedUser(auth, userId);
  return DisciplinaryRecord.findAll({ where: { userId }, order: [["createdAt", "DESC"]] });
}

export async function createDisciplinaryRecord(
  auth: AuthContext,
  userId: string,
  input: CreateDisciplinaryRecordInput,
  ip: string | null,
): Promise<DisciplinaryRecord> {
  const user = await requireManagedUser(auth, userId);
  const status = input.status ?? "Open";
  if (!DISCIPLINARY_STATUSES.includes(status as DisciplinaryStatus)) {
    throw new BadRequestError(`status must be one of ${DISCIPLINARY_STATUSES.join(", ")}`, "INVALID_STATUS");
  }
  const record = await DisciplinaryRecord.create({
    orgId: user.orgId,
    userId: user.id,
    disciplineType: input.disciplineType,
    incidentDate: input.incidentDate,
    description: input.description,
    actionTaken: input.actionTaken ?? null,
    status: status as DisciplinaryStatus,
    createdBy: auth.userId,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "disciplinaryRecord.created",
    entityType: "DisciplinaryRecord",
    entityId: record.id,
    sourceIp: ip,
    result: "Success",
  });
  return record;
}

export async function deleteDisciplinaryRecord(auth: AuthContext, userId: string, id: string, ip: string | null): Promise<void> {
  const user = await requireManagedUser(auth, userId);
  const record = await DisciplinaryRecord.findOne({ where: { id, userId } });
  if (!record) throw new NotFoundError("Disciplinary record not found");
  await record.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "disciplinaryRecord.deleted",
    entityType: "DisciplinaryRecord",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}

// --- Performance records -----------------------------------------------------

export interface CreatePerformanceRecordInput {
  reviewPeriod: string;
  rating: string;
  reviewerId?: string | null;
  comments?: string | null;
}

export async function listPerformanceRecords(auth: AuthContext, userId: string): Promise<PerformanceRecord[]> {
  await requireManagedUser(auth, userId);
  return PerformanceRecord.findAll({ where: { userId }, order: [["createdAt", "DESC"]] });
}

export async function createPerformanceRecord(
  auth: AuthContext,
  userId: string,
  input: CreatePerformanceRecordInput,
  ip: string | null,
): Promise<PerformanceRecord> {
  const user = await requireManagedUser(auth, userId);
  const record = await PerformanceRecord.create({
    orgId: user.orgId,
    userId: user.id,
    reviewPeriod: input.reviewPeriod,
    rating: input.rating,
    reviewerId: input.reviewerId ?? null,
    comments: input.comments ?? null,
    createdBy: auth.userId,
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "performanceRecord.created",
    entityType: "PerformanceRecord",
    entityId: record.id,
    sourceIp: ip,
    result: "Success",
  });
  return record;
}

export async function deletePerformanceRecord(auth: AuthContext, userId: string, id: string, ip: string | null): Promise<void> {
  const user = await requireManagedUser(auth, userId);
  const record = await PerformanceRecord.findOne({ where: { id, userId } });
  if (!record) throw new NotFoundError("Performance record not found");
  await record.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: user.orgId,
    tenantId: user.tenantId,
    action: "performanceRecord.deleted",
    entityType: "PerformanceRecord",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
