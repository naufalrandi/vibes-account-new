import {
  Criterion,
  Element,
  Framework,
  Question,
  Requirement,
  AssessmentResponse,
  ResponseCriterion,
} from "../../db/models";
import type { QuestionStatus } from "../../db/models/question.model";
import type { ResponseStatus } from "../../db/models/response.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can manage assessments");
  }
}

// ---- Views -------------------------------------------------------------------
export interface ResponseCriterionView {
  criterionId: string;
  score: number;
  description: string;
  requirementCode: string;
  frameworkName: string;
}
export interface ResponseView {
  id: string;
  questionId: string;
  text: string;
  sortOrder: number;
  status: ResponseStatus;
  criterion: ResponseCriterionView | null;
}
export interface QuestionView {
  id: string;
  elementId: string;
  text: string;
  sortOrder: number;
  status: QuestionStatus;
  responses: ResponseView[];
}
export interface ElementAssessment {
  elementId: string;
  elementName: string;
  questions: QuestionView[];
}

async function criterionViewFor(responseIds: string[]): Promise<Map<string, ResponseCriterionView>> {
  if (!responseIds.length) return new Map();
  const links = await ResponseCriterion.findAll({ where: { responseId: responseIds } });
  const critIds = [...new Set(links.map((l) => l.criterionId))];
  const criteria = critIds.length
    ? await Criterion.findAll({ where: { id: critIds }, include: [{ model: Requirement, include: [{ model: Framework }] }] })
    : [];
  const critById = new Map(criteria.map((c) => [c.id, c]));
  const out = new Map<string, ResponseCriterionView>();
  for (const link of links) {
    const c = critById.get(link.criterionId);
    if (!c) continue;
    const req = c.get("Requirement") as Requirement | undefined;
    const fw = req?.get("Framework") as Framework | undefined;
    out.set(link.responseId, {
      criterionId: c.id,
      score: c.score,
      description: c.description,
      requirementCode: req?.code ?? "",
      frameworkName: fw?.name ?? "",
    });
  }
  return out;
}

export async function getElementAssessment(auth: AuthContext, elementId: string): Promise<ElementAssessment> {
  assertServiceOwner(auth);
  const element = await Element.findByPk(elementId);
  if (!element) throw new NotFoundError("Framework element does not exist", "ELEMENT_NOT_FOUND");
  const questions = await Question.findAll({ where: { elementId }, order: [["sortOrder", "ASC"], ["createdAt", "ASC"]] });
  const responses = await AssessmentResponse.findAll({
    where: { questionId: questions.map((q) => q.id) },
    order: [["sortOrder", "ASC"], ["createdAt", "ASC"]],
  });
  const critByResponse = await criterionViewFor(responses.map((r) => r.id));
  const respByQuestion = new Map<string, ResponseView[]>();
  for (const r of responses) {
    const list = respByQuestion.get(r.questionId) ?? [];
    list.push({
      id: r.id,
      questionId: r.questionId,
      text: r.text,
      sortOrder: r.sortOrder,
      status: r.status,
      criterion: critByResponse.get(r.id) ?? null,
    });
    respByQuestion.set(r.questionId, list);
  }
  return {
    elementId: element.id,
    elementName: element.name,
    questions: questions.map((q) => ({
      id: q.id,
      elementId: q.elementId,
      text: q.text,
      sortOrder: q.sortOrder,
      status: q.status,
      responses: respByQuestion.get(q.id) ?? [],
    })),
  };
}

// ---- Questions ---------------------------------------------------------------
export interface CreateQuestionInput {
  elementId: string;
  text: string;
  sortOrder?: number;
  status?: QuestionStatus;
}
export async function createQuestion(auth: AuthContext, input: CreateQuestionInput, ip: string | null): Promise<QuestionView> {
  assertServiceOwner(auth);
  const element = await Element.findByPk(input.elementId);
  if (!element) throw new BadRequestError("Framework element does not exist", "ELEMENT_NOT_FOUND");
  const q = await Question.create({
    elementId: input.elementId,
    text: input.text,
    sortOrder: input.sortOrder ?? 0,
    status: input.status ?? "Active",
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, tenantId: auth.tenantId, action: "assessmentQuestion.created", entityType: "Question", entityId: q.id, sourceIp: ip, result: "Success" });
  return { id: q.id, elementId: q.elementId, text: q.text, sortOrder: q.sortOrder, status: q.status, responses: [] };
}
export async function updateQuestion(auth: AuthContext, id: string, input: Partial<Omit<CreateQuestionInput, "elementId">>, ip: string | null): Promise<QuestionView> {
  assertServiceOwner(auth);
  const q = await Question.findByPk(id);
  if (!q) throw new NotFoundError("Question does not exist", "QUESTION_NOT_FOUND");
  if (input.text !== undefined) q.text = input.text;
  if (input.sortOrder !== undefined) q.sortOrder = input.sortOrder;
  if (input.status !== undefined) q.status = input.status;
  await q.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, tenantId: auth.tenantId, action: "assessmentQuestion.updated", entityType: "Question", entityId: q.id, sourceIp: ip, result: "Success" });
  const full = await getElementAssessment(auth, q.elementId);
  return full.questions.find((x) => x.id === q.id)!;
}
export async function deleteQuestion(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const q = await Question.findByPk(id);
  if (!q) throw new NotFoundError("Question does not exist", "QUESTION_NOT_FOUND");
  await q.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, tenantId: auth.tenantId, action: "assessmentQuestion.deleted", entityType: "Question", entityId: id, sourceIp: ip, result: "Success" });
}

// ---- Responses ---------------------------------------------------------------
export interface CreateResponseInput {
  questionId: string;
  text: string;
  sortOrder?: number;
  status?: ResponseStatus;
}
export async function createResponse(auth: AuthContext, input: CreateResponseInput, ip: string | null): Promise<ResponseView> {
  assertServiceOwner(auth);
  const question = await Question.findByPk(input.questionId);
  if (!question) throw new BadRequestError("Question does not exist", "QUESTION_NOT_FOUND");
  const r = await AssessmentResponse.create({
    questionId: input.questionId,
    text: input.text,
    sortOrder: input.sortOrder ?? 0,
    status: input.status ?? "Active",
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, tenantId: auth.tenantId, action: "assessmentResponse.created", entityType: "Response", entityId: r.id, sourceIp: ip, result: "Success" });
  return { id: r.id, questionId: r.questionId, text: r.text, sortOrder: r.sortOrder, status: r.status, criterion: null };
}
export async function updateResponse(auth: AuthContext, id: string, input: Partial<Omit<CreateResponseInput, "questionId">>, ip: string | null): Promise<ResponseView> {
  assertServiceOwner(auth);
  const r = await AssessmentResponse.findByPk(id);
  if (!r) throw new NotFoundError("Response does not exist", "RESPONSE_NOT_FOUND");
  if (input.text !== undefined) r.text = input.text;
  if (input.sortOrder !== undefined) r.sortOrder = input.sortOrder;
  if (input.status !== undefined) r.status = input.status;
  await r.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, tenantId: auth.tenantId, action: "assessmentResponse.updated", entityType: "Response", entityId: r.id, sourceIp: ip, result: "Success" });
  const crit = (await criterionViewFor([r.id])).get(r.id) ?? null;
  return { id: r.id, questionId: r.questionId, text: r.text, sortOrder: r.sortOrder, status: r.status, criterion: crit };
}
export async function deleteResponse(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  assertServiceOwner(auth);
  const r = await AssessmentResponse.findByPk(id);
  if (!r) throw new NotFoundError("Response does not exist", "RESPONSE_NOT_FOUND");
  await r.destroy();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, tenantId: auth.tenantId, action: "assessmentResponse.deleted", entityType: "Response", entityId: id, sourceIp: ip, result: "Success" });
}

/** Map a response to a criterion (1:1), or unmap when criterionId is null. */
export async function setResponseCriterion(auth: AuthContext, responseId: string, criterionId: string | null, ip: string | null): Promise<ResponseView> {
  assertServiceOwner(auth);
  const r = await AssessmentResponse.findByPk(responseId);
  if (!r) throw new NotFoundError("Response does not exist", "RESPONSE_NOT_FOUND");
  await ResponseCriterion.destroy({ where: { responseId } });
  if (criterionId) {
    const crit = await Criterion.findByPk(criterionId);
    if (!crit) throw new BadRequestError("Criterion does not exist", "CRITERION_NOT_FOUND");
    await ResponseCriterion.create({ responseId, criterionId });
  }
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, tenantId: auth.tenantId, action: "responseCriterion.updated", entityType: "Response", entityId: responseId, sourceIp: ip, result: "Success", metadata: { criterionId } });
  const crit = (await criterionViewFor([responseId])).get(responseId) ?? null;
  return { id: r.id, questionId: r.questionId, text: r.text, sortOrder: r.sortOrder, status: r.status, criterion: crit };
}

// ---- Response → Criteria map (flattened list for the rcmap screen) -----------
export interface RcMapRow {
  responseId: string;
  responseText: string;
  questionId: string;
  questionText: string;
  elementId: string;
  elementName: string;
  criterion: ResponseCriterionView | null;
}
export async function listResponseCriteriaMap(auth: AuthContext): Promise<RcMapRow[]> {
  assertServiceOwner(auth);
  const responses = await AssessmentResponse.findAll({
    include: [{ model: Question, include: [{ model: Element }] }],
    order: [["createdAt", "ASC"]],
  });
  const critByResponse = await criterionViewFor(responses.map((r) => r.id));
  return responses.map((r) => {
    const q = r.get("Question") as Question | undefined;
    const el = q?.get("Element") as Element | undefined;
    return {
      responseId: r.id,
      responseText: r.text,
      questionId: r.questionId,
      questionText: q?.text ?? "",
      elementId: q?.elementId ?? "",
      elementName: el?.name ?? "",
      criterion: critByResponse.get(r.id) ?? null,
    };
  });
}

// ---- Criteria options (for the rcmap dropdown) -------------------------------
export interface CriterionOption {
  id: string;
  score: number;
  description: string;
  requirementCode: string;
  frameworkName: string;
}
export async function listCriterionOptions(auth: AuthContext): Promise<CriterionOption[]> {
  assertServiceOwner(auth);
  const criteria = await Criterion.findAll({ include: [{ model: Requirement, include: [{ model: Framework }] }], order: [["score", "ASC"]] });
  return criteria.map((c) => {
    const req = c.get("Requirement") as Requirement | undefined;
    const fw = req?.get("Framework") as Framework | undefined;
    return { id: c.id, score: c.score, description: c.description, requirementCode: req?.code ?? "", frameworkName: fw?.name ?? "" };
  });
}
