import {
  Framework, FrameworkElement, FrameworkRequirement, ElementRequirementXref,
} from "../../db/models";
import type { LibraryStatus, ElementCategory } from "../../db/models/frameworkMeta.models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner manages framework elements");
}

export interface CreateElementInput {
  name: string;
  description?: string | null;
  status?: LibraryStatus;
  category?: ElementCategory;
}
export type UpdateElementInput = Partial<CreateElementInput>;

async function nextElementCode(): Promise<string> {
  const rows = await FrameworkElement.findAll({ attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const m = r.code.match(/^FWE-(\d+)$/);
    if (m) { const v = Number.parseInt(m[1], 10); if (v > max) max = v; }
  }
  return `FWE-${String(max + 1).padStart(3, "0")}`;
}

function summary(e: FrameworkElement, mappedRequirementCount: number) {
  return {
    id: e.id, name: e.name, description: e.description, status: e.status,
    mappedRequirementCount, createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}

async function mappedRequirements(elementId: string) {
  const links = await ElementRequirementXref.findAll({ where: { elementId }, attributes: ["requirementId"] });
  if (links.length === 0) return [];
  const reqs = await FrameworkRequirement.findAll({ where: { id: links.map((l) => l.requirementId) }, order: [["code", "ASC"]] });
  const names = new Map((await Framework.findAll({ where: { id: [...new Set(reqs.map((r) => r.frameworkId))] }, attributes: ["id", "name"] })).map((f) => [f.id, f.name]));
  return reqs.map((r) => ({ id: r.id, code: r.code, subject: r.subject, description: r.description, frameworkId: r.frameworkId, frameworkName: names.get(r.frameworkId) ?? "" }));
}

async function detail(e: FrameworkElement) {
  const reqs = await mappedRequirements(e.id);
  return { ...summary(e, reqs.length), mappedRequirements: reqs };
}

export async function listElements(auth: AuthContext) {
  assertServiceOwner(auth);
  const rows = await FrameworkElement.findAll({ order: [["code", "ASC"]] });
  return Promise.all(rows.map(async (e) => summary(e, await ElementRequirementXref.count({ where: { elementId: e.id } }))));
}

async function require(id: string): Promise<FrameworkElement> {
  const e = await FrameworkElement.findByPk(id);
  if (!e) throw new NotFoundError("Framework element does not exist", "ELEMENT_NOT_FOUND");
  return e;
}

export async function getElement(auth: AuthContext, id: string) {
  assertServiceOwner(auth);
  return detail(await require(id));
}

export async function createElement(auth: AuthContext, input: CreateElementInput, ip: string | null) {
  assertServiceOwner(auth);
  const e = await FrameworkElement.create({
    code: await nextElementCode(), name: input.name, description: input.description ?? null,
    category: input.category ?? "Core", status: input.status ?? "Active",
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "element.created", entityType: "FrameworkElement", entityId: e.id, sourceIp: ip, result: "Success" });
  return detail(e);
}

export async function updateElement(auth: AuthContext, id: string, input: UpdateElementInput, ip: string | null) {
  assertServiceOwner(auth);
  const e = await require(id);
  if (input.name !== undefined) e.name = input.name;
  if (input.description !== undefined) e.description = input.description ?? null;
  if (input.status !== undefined) e.status = input.status;
  if (input.category !== undefined) e.category = input.category;
  await e.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "element.updated", entityType: "FrameworkElement", entityId: e.id, sourceIp: ip, result: "Success" });
  return detail(e);
}

export async function deleteElement(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth);
  const e = await require(id);
  await e.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "element.deleted", entityType: "FrameworkElement", entityId: id, sourceIp: ip, result: "Success" });
}

/** Replace the element's requirement mappings (xref) with the given set. */
export async function setMappings(auth: AuthContext, id: string, requirementIds: string[], ip: string | null) {
  assertServiceOwner(auth);
  const e = await require(id);
  const unique = [...new Set(requirementIds)];
  if (unique.length > 0) {
    const found = await FrameworkRequirement.count({ where: { id: unique } });
    if (found !== unique.length) throw new BadRequestError("One or more requirements do not exist", "REQUIREMENT_NOT_FOUND");
  }
  await ElementRequirementXref.destroy({ where: { elementId: id } });
  if (unique.length > 0) await ElementRequirementXref.bulkCreate(unique.map((requirementId) => ({ elementId: id, requirementId })));
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "element.mappings.set", entityType: "FrameworkElement", entityId: id, sourceIp: ip, result: "Success", metadata: { count: unique.length } });
  return detail(e);
}

/** The bidirectional Element↔Requirement cross-reference (xref). */
export async function getCrossReference(auth: AuthContext) {
  assertServiceOwner(auth);
  const elements = await FrameworkElement.findAll({ order: [["name", "ASC"]] });
  const requirements = await FrameworkRequirement.findAll({ order: [["code", "ASC"]] });
  const frameworks = new Map((await Framework.findAll({ attributes: ["id", "name"] })).map((f) => [f.id, f.name]));
  const links = await ElementRequirementXref.findAll();

  const reqsByElement = new Map<string, string[]>();
  const elsByReq = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const arr = m.get(k);
    if (arr) arr.push(v);
    else m.set(k, [v]);
  };
  for (const l of links) {
    push(reqsByElement, l.elementId, l.requirementId);
    push(elsByReq, l.requirementId, l.elementId);
  }
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const elById = new Map(elements.map((e) => [e.id, e]));

  const byElement = elements.map((e) => ({
    elementId: e.id, elementName: e.name, elementDescription: e.description,
    requirements: (reqsByElement.get(e.id) ?? []).map((rid) => reqById.get(rid)).filter((r): r is FrameworkRequirement => !!r)
      .map((r) => ({ id: r.id, code: r.code, subject: r.subject, description: r.description, frameworkId: r.frameworkId, frameworkName: frameworks.get(r.frameworkId) ?? "" })),
  }));
  const byRequirement = requirements
    .map((r) => ({
      requirementId: r.id, code: r.code, subject: r.subject, frameworkId: r.frameworkId, frameworkName: frameworks.get(r.frameworkId) ?? "",
      elements: (elsByReq.get(r.id) ?? []).map((eid) => elById.get(eid)).filter((e): e is FrameworkElement => !!e)
        .map((e) => ({ id: e.id, name: e.name, description: e.description }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => (a.frameworkName !== b.frameworkName ? a.frameworkName.localeCompare(b.frameworkName) : a.code.localeCompare(b.code)));
  return { byElement, byRequirement };
}
