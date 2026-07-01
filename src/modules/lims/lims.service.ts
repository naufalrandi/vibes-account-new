import { Op, type WhereOptions } from "sequelize";
import { TestingService } from "../../db/models";
import type { StageConfig } from "../../db/models/testingService.model";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { limsGenerate, normalizeStages } from "./limsEngine";

export interface ServiceView {
  id: string;
  orgId: string;
  code: string;
  name: string;
  description: string | null;
  status: "Active" | "Inactive";
  stages: StageConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface ServiceInput {
  name?: string;
  description?: string | null;
  status?: "Active" | "Inactive";
  stages?: Partial<StageConfig>;
}

function view(s: TestingService): ServiceView {
  return {
    id: s.id, orgId: s.orgId, code: s.code, name: s.name, description: s.description,
    status: s.status, stages: normalizeStages(s.stages), createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

async function requireService(auth: AuthContext, id: string): Promise<TestingService> {
  const s = await TestingService.findByPk(id);
  if (!s) throw new NotFoundError("Testing service does not exist", "SERVICE_NOT_FOUND");
  await assertCanSeeOrg(auth, s.orgId);
  return s;
}

async function nextCode(orgId: string): Promise<string> {
  const rows = await TestingService.findAll({ where: { orgId }, attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^TS-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `TS-${max + 1}`;
}

export async function listServices(auth: AuthContext, filters: { orgId?: string } = {}): Promise<ServiceView[]> {
  const where: WhereOptions = {};
  const ids = await visibleTenantOrgIds(auth);
  if (filters.orgId) {
    await assertCanSeeOrg(auth, filters.orgId);
    Object.assign(where, { orgId: filters.orgId });
  } else if (ids !== null) {
    Object.assign(where, { orgId: { [Op.in]: ids } });
  }
  const rows = await TestingService.findAll({ where, order: [["code", "ASC"]] });
  return rows.map(view);
}

export async function getService(auth: AuthContext, id: string): Promise<ServiceView> {
  return view(await requireService(auth, id));
}

export async function createService(auth: AuthContext, input: ServiceInput, orgId: string | undefined, ip: string | null): Promise<ServiceView> {
  const targetOrg = orgId ?? auth.orgId;
  await assertCanSeeOrg(auth, targetOrg);
  if (!input.name || !input.name.trim()) throw new BadRequestError("Service name is required", "NAME_REQUIRED");
  const s = await TestingService.create({
    orgId: targetOrg,
    code: await nextCode(targetOrg),
    name: input.name.trim(),
    description: input.description ?? null,
    status: input.status ?? "Active",
    stages: normalizeStages(input.stages),
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: targetOrg,
    action: "lims.service.created", entityType: "TestingService", entityId: s.id, sourceIp: ip, result: "Success",
  });
  return view(s);
}

export async function updateService(auth: AuthContext, id: string, input: ServiceInput, ip: string | null): Promise<ServiceView> {
  const s = await requireService(auth, id);
  if (input.name !== undefined) s.name = input.name.trim();
  if (input.description !== undefined) s.description = input.description;
  if (input.status !== undefined) s.status = input.status;
  if (input.stages !== undefined) s.stages = normalizeStages({ ...s.stages, ...input.stages });
  await s.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: s.orgId,
    action: "lims.service.updated", entityType: "TestingService", entityId: s.id, sourceIp: ip, result: "Success",
  });
  return view(s);
}

export async function deleteService(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const s = await requireService(auth, id);
  const orgId = s.orgId;
  await s.destroy();
  await writeAudit({
    actorUserId: auth.userId, organizationId: orgId,
    action: "lims.service.deleted", entityType: "TestingService", entityId: id, sourceIp: ip, result: "Success",
  });
}

export interface PreviewView {
  serviceId: string;
  serviceName: string;
  selected: string[];
  stages: string[];
}

export async function previewWorkflow(auth: AuthContext, serviceId: string, selected: string[]): Promise<PreviewView> {
  const s = await requireService(auth, serviceId);
  return { serviceId: s.id, serviceName: s.name, selected, stages: limsGenerate(normalizeStages(s.stages), selected) };
}
