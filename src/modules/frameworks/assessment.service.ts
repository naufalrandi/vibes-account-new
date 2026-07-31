import {
  Framework, FrameworkElement, FrameworkRequirement, RequirementCriterion,
  ConformanceQuestion, ConformanceResponse, ElementAssessmentAnswer,
} from "../../db/models";
import type { AssessmentStatus, QuestionDimension } from "../../db/models/frameworkMeta.models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner authors assessments");
}

interface CriterionView {
  criterionId: string;
  score: number;
  description: string;
  requirementCode: string;
  frameworkName: string;
}

/** Resolve a criterion to its display view (score + requirement code + framework). */
async function criterionView(criterionId: string | null): Promise<CriterionView | null> {
  if (!criterionId) return null;
  const c = await RequirementCriterion.findByPk(criterionId);
  if (!c) return null;
  const req = await FrameworkRequirement.findByPk(c.requirementId);
  const fw = req ? await Framework.findByPk(req.frameworkId) : null;
  return { criterionId: c.id, score: c.score, description: c.description, requirementCode: req?.code ?? "", frameworkName: fw?.name ?? "" };
}

async function responseView(r: ConformanceResponse) {
  return {
    id: r.id, questionId: r.questionId, text: r.text, sortOrder: r.sortOrder, status: r.status,
    code: r.code, child: r.child,
    criterion: await criterionView(r.criterionId),
  };
}

async function questionView(q: ConformanceQuestion) {
  const responses = await ConformanceResponse.findAll({ where: { questionId: q.id }, order: [["sortOrder", "ASC"]] });
  return {
    id: q.id, elementId: q.elementId, text: q.text, sortOrder: q.sortOrder, status: q.status,
    dimension: q.dimension, category: q.category, code: q.code, title: q.title,
    responses: await Promise.all(responses.map(responseView)),
  };
}

export async function getElementAssessment(auth: AuthContext, elementId: string) {
  assertServiceOwner(auth);
  const element = await FrameworkElement.findByPk(elementId);
  if (!element) throw new NotFoundError("Framework element does not exist", "ELEMENT_NOT_FOUND");
  const questions = await ConformanceQuestion.findAll({ where: { elementId }, order: [["sortOrder", "ASC"]] });
  return { elementId, elementName: element.name, questions: await Promise.all(questions.map(questionView)) };
}

// --- Questions -----------------------------------------------------------
export interface CreateQuestionInput {
  elementId: string; text: string; sortOrder?: number; status?: AssessmentStatus;
  dimension?: QuestionDimension; category?: string | null; code?: string | null; title?: string | null;
}
export interface UpdateQuestionInput {
  text?: string; sortOrder?: number; status?: AssessmentStatus;
  dimension?: QuestionDimension; category?: string | null; code?: string | null; title?: string | null;
}

export async function createQuestion(auth: AuthContext, input: CreateQuestionInput, ip: string | null) {
  assertServiceOwner(auth);
  if (!(await FrameworkElement.findByPk(input.elementId))) throw new BadRequestError("Element does not exist", "ELEMENT_NOT_FOUND");
  const q = await ConformanceQuestion.create({
    elementId: input.elementId, text: input.text, sortOrder: input.sortOrder ?? 0, status: input.status ?? "Draft",
    dimension: input.dimension ?? "Maturity", category: input.category ?? null, code: input.code ?? null, title: input.title ?? null,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cq.created", entityType: "ConformanceQuestion", entityId: q.id, sourceIp: ip, result: "Success" });
  return questionView(q);
}

export async function updateQuestion(auth: AuthContext, id: string, input: UpdateQuestionInput, ip: string | null) {
  assertServiceOwner(auth);
  const q = await ConformanceQuestion.findByPk(id);
  if (!q) throw new NotFoundError("Question does not exist", "CQ_NOT_FOUND");
  if (input.text !== undefined) q.text = input.text;
  if (input.sortOrder !== undefined) q.sortOrder = input.sortOrder;
  if (input.status !== undefined) q.status = input.status;
  if (input.dimension !== undefined) q.dimension = input.dimension;
  if (input.category !== undefined) q.category = input.category;
  if (input.code !== undefined) q.code = input.code;
  if (input.title !== undefined) q.title = input.title;
  await q.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cq.updated", entityType: "ConformanceQuestion", entityId: q.id, sourceIp: ip, result: "Success" });
  return questionView(q);
}

export async function deleteQuestion(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth);
  const q = await ConformanceQuestion.findByPk(id);
  if (!q) throw new NotFoundError("Question does not exist", "CQ_NOT_FOUND");
  await q.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cq.deleted", entityType: "ConformanceQuestion", entityId: id, sourceIp: ip, result: "Success" });
}

// --- Responses -----------------------------------------------------------
export interface CreateResponseInput { questionId: string; text: string; sortOrder?: number; status?: AssessmentStatus; code?: string | null; child?: boolean }
export interface UpdateResponseInput { text?: string; sortOrder?: number; status?: AssessmentStatus; code?: string | null; child?: boolean }

export async function createResponse(auth: AuthContext, input: CreateResponseInput, ip: string | null) {
  assertServiceOwner(auth);
  if (!(await ConformanceQuestion.findByPk(input.questionId))) throw new BadRequestError("Question does not exist", "CQ_NOT_FOUND");
  const r = await ConformanceResponse.create({
    questionId: input.questionId, text: input.text, sortOrder: input.sortOrder ?? 0, status: input.status ?? "Draft", criterionId: null,
    code: input.code ?? null, child: input.child ?? false,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cqr.created", entityType: "ConformanceResponse", entityId: r.id, sourceIp: ip, result: "Success" });
  return responseView(r);
}

export async function updateResponse(auth: AuthContext, id: string, input: UpdateResponseInput, ip: string | null) {
  assertServiceOwner(auth);
  const r = await ConformanceResponse.findByPk(id);
  if (!r) throw new NotFoundError("Response does not exist", "CQR_NOT_FOUND");
  if (input.text !== undefined) r.text = input.text;
  if (input.sortOrder !== undefined) r.sortOrder = input.sortOrder;
  if (input.status !== undefined) r.status = input.status;
  if (input.code !== undefined) r.code = input.code;
  if (input.child !== undefined) r.child = input.child;
  await r.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cqr.updated", entityType: "ConformanceResponse", entityId: r.id, sourceIp: ip, result: "Success" });
  return responseView(r);
}

export async function deleteResponse(auth: AuthContext, id: string, ip: string | null) {
  assertServiceOwner(auth);
  const r = await ConformanceResponse.findByPk(id);
  if (!r) throw new NotFoundError("Response does not exist", "CQR_NOT_FOUND");
  await r.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cqr.deleted", entityType: "ConformanceResponse", entityId: id, sourceIp: ip, result: "Success" });
}

/** Map (or unmap) a response to a criterion — the rcmap scoring bridge. */
export async function setResponseCriterion(auth: AuthContext, id: string, criterionId: string | null, ip: string | null) {
  assertServiceOwner(auth);
  const r = await ConformanceResponse.findByPk(id);
  if (!r) throw new NotFoundError("Response does not exist", "CQR_NOT_FOUND");
  if (criterionId && !(await RequirementCriterion.findByPk(criterionId))) throw new BadRequestError("Criterion does not exist", "CRITERION_NOT_FOUND");
  r.criterionId = criterionId;
  await r.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "rcmap.set", entityType: "ConformanceResponse", entityId: r.id, sourceIp: ip, result: "Success", metadata: { criterionId } });
  return responseView(r);
}

export async function listResponseCriteria(auth: AuthContext) {
  assertServiceOwner(auth);
  const responses = await ConformanceResponse.findAll({ order: [["sortOrder", "ASC"]] });
  const questions = new Map((await ConformanceQuestion.findAll()).map((q) => [q.id, q]));
  const elements = new Map((await FrameworkElement.findAll({ attributes: ["id", "name"] })).map((e) => [e.id, e.name]));
  return Promise.all(
    responses.map(async (r) => {
      const q = questions.get(r.questionId);
      return {
        responseId: r.id, responseText: r.text, questionId: r.questionId, questionText: q?.text ?? "",
        elementId: q?.elementId ?? "", elementName: q ? elements.get(q.elementId) ?? "" : "",
        criterion: await criterionView(r.criterionId),
      };
    }),
  );
}

export async function listCriterionOptions(auth: AuthContext) {
  assertServiceOwner(auth);
  const criteria = await RequirementCriterion.findAll({ order: [["score", "ASC"]] });
  const reqs = new Map((await FrameworkRequirement.findAll()).map((r) => [r.id, r]));
  const frameworks = new Map((await Framework.findAll({ attributes: ["id", "name"] })).map((f) => [f.id, f.name]));
  return criteria.map((c) => {
    const req = reqs.get(c.requirementId);
    return { id: c.id, score: c.score, description: c.description, requirementCode: req?.code ?? "", frameworkName: req ? frameworks.get(req.frameworkId) ?? "" : "" };
  });
}

// --- Element self-assessment answers (OD `fwe-assess` / `db.fweAssess`) ---
export interface ElementAssessmentAnswerView { questionId: string; responseId: string | null; frameworks: string[] }

export async function listElementAssessmentAnswers(auth: AuthContext, elementId: string): Promise<ElementAssessmentAnswerView[]> {
  assertServiceOwner(auth);
  const rows = await ElementAssessmentAnswer.findAll({ where: { elementId } });
  return rows.map((r) => ({ questionId: r.questionId, responseId: r.responseId, frameworks: r.frameworks }));
}

/** Upserts an answer; `responseId: null` clears it (deletes the row). */
export async function setElementAssessmentAnswer(
  auth: AuthContext, elementId: string, questionId: string, responseId: string | null, frameworks: string[],
): Promise<ElementAssessmentAnswerView | null> {
  assertServiceOwner(auth);
  const question = await ConformanceQuestion.findByPk(questionId);
  if (!question || question.elementId !== elementId) throw new BadRequestError("Question does not belong to this element", "CQ_NOT_FOUND");
  if (responseId === null) {
    await ElementAssessmentAnswer.destroy({ where: { questionId } });
    return null;
  }
  const response = await ConformanceResponse.findByPk(responseId);
  if (!response || response.questionId !== questionId) throw new BadRequestError("Response does not belong to this question", "CQR_NOT_FOUND");
  const [row] = await ElementAssessmentAnswer.findOrCreate({ where: { questionId }, defaults: { elementId, questionId, responseId, frameworks } });
  row.responseId = responseId;
  row.frameworks = response.child ? frameworks : [];
  await row.save();
  return { questionId: row.questionId, responseId: row.responseId, frameworks: row.frameworks };
}

export async function resetElementAssessment(auth: AuthContext, elementId: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  await ElementAssessmentAnswer.destroy({ where: { elementId } });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "fwe-assess.reset", entityType: "FrameworkElement", entityId: elementId, sourceIp: ip, result: "Success" });
}
