import { Fwrc, FrameworkRequirement, FrameworkElement, ConformanceQuestion, ConformanceResponse, Framework } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError();
}

export interface FwrcView {
  id: string;
  code: string;
  frameworkId: string;
  frameworkName: string;
  requirementId: string;
  requirementCode: string;
  requirementSubject: string;
  elementId: string;
  elementCode: string;
  elementName: string;
  questionId: string | null;
  questionCode: string | null;
  questionText: string | null;
  responseId: string;
  responseCode: string | null;
  responseText: string;
  statement: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateFwrcInput { requirementId: string; responseId: string; statement: string }
export interface UpdateFwrcInput { statement?: string; responseId?: string }

async function toView(f: Fwrc): Promise<FwrcView> {
  const [fw, req, el, q, resp] = await Promise.all([
    Framework.findByPk(f.frameworkId),
    FrameworkRequirement.findByPk(f.requirementId),
    FrameworkElement.findByPk(f.elementId),
    f.questionId ? ConformanceQuestion.findByPk(f.questionId) : Promise.resolve(null),
    ConformanceResponse.findByPk(f.responseId),
  ]);
  return {
    id: f.id, code: f.code, frameworkId: f.frameworkId, frameworkName: fw?.name ?? "",
    requirementId: f.requirementId, requirementCode: req?.code ?? "", requirementSubject: req?.subject ?? "",
    elementId: f.elementId, elementCode: el?.code ?? "", elementName: el?.name ?? "",
    questionId: f.questionId, questionCode: q?.code ?? null, questionText: q?.text ?? null,
    responseId: f.responseId, responseCode: resp?.code ?? null, responseText: resp?.text ?? "",
    statement: f.statement, createdAt: f.createdAt, updatedAt: f.updatedAt,
  };
}

async function nextCode(): Promise<string> {
  const rows = await Fwrc.findAll({ attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^FWRC-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `FWRC-${String(max + 1).padStart(4, "0")}`;
}

export async function listFwrc(
  auth: AuthContext,
  filters: { requirementId?: string; elementId?: string; frameworkId?: string; responseId?: string },
): Promise<FwrcView[]> {
  assertServiceOwner(auth);
  const where: Record<string, string> = {};
  if (filters.requirementId) where.requirementId = filters.requirementId;
  if (filters.elementId) where.elementId = filters.elementId;
  if (filters.frameworkId) where.frameworkId = filters.frameworkId;
  if (filters.responseId) where.responseId = filters.responseId;
  const rows = await Fwrc.findAll({ where, order: [["code", "ASC"]] });
  return Promise.all(rows.map(toView));
}

export async function createFwrc(auth: AuthContext, input: CreateFwrcInput, ip: string | null): Promise<FwrcView> {
  assertServiceOwner(auth);
  if (!input.statement || !input.statement.trim()) throw new BadRequestError("A maturity statement is required", "STATEMENT_REQUIRED");
  const req = await FrameworkRequirement.findByPk(input.requirementId);
  if (!req) throw new BadRequestError("Requirement does not exist", "REQUIREMENT_NOT_FOUND");
  const resp = await ConformanceResponse.findByPk(input.responseId);
  if (!resp) throw new BadRequestError("Conformance response does not exist", "RESPONSE_NOT_FOUND");
  const question = await ConformanceQuestion.findByPk(resp.questionId);
  if (!question) throw new BadRequestError("Conformance question does not exist", "QUESTION_NOT_FOUND");
  const f = await Fwrc.create({
    code: await nextCode(),
    frameworkId: req.frameworkId,
    requirementId: req.id,
    elementId: question.elementId,
    questionId: question.id,
    responseId: resp.id,
    statement: input.statement.trim(),
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "fwrc.created", entityType: "Fwrc", entityId: f.id, sourceIp: ip, result: "Success" });
  return toView(f);
}

async function requireFwrc(id: string): Promise<Fwrc> {
  const f = await Fwrc.findByPk(id);
  if (!f) throw new NotFoundError("FWRC link does not exist", "FWRC_NOT_FOUND");
  return f;
}

export async function updateFwrc(auth: AuthContext, id: string, input: UpdateFwrcInput, ip: string | null): Promise<FwrcView> {
  assertServiceOwner(auth);
  const f = await requireFwrc(id);
  if (input.responseId !== undefined) {
    const resp = await ConformanceResponse.findByPk(input.responseId);
    if (!resp) throw new BadRequestError("Conformance response does not exist", "RESPONSE_NOT_FOUND");
    const question = await ConformanceQuestion.findByPk(resp.questionId);
    if (!question) throw new BadRequestError("Conformance question does not exist", "QUESTION_NOT_FOUND");
    f.responseId = resp.id; f.questionId = question.id; f.elementId = question.elementId;
  }
  if (input.statement !== undefined) {
    if (!input.statement.trim()) throw new BadRequestError("A maturity statement is required", "STATEMENT_REQUIRED");
    f.statement = input.statement.trim();
  }
  await f.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "fwrc.updated", entityType: "Fwrc", entityId: f.id, sourceIp: ip, result: "Success" });
  return toView(f);
}

export async function deleteFwrc(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const f = await requireFwrc(id);
  await f.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "fwrc.deleted", entityType: "Fwrc", entityId: id, sourceIp: ip, result: "Success" });
}
