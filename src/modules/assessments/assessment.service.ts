import { Op, type WhereOptions } from "sequelize";
import {
  Organization, Site, Framework, Assessment, AssessmentAnswer, Gap,
  FrameworkElement, FrameworkRequirement, ElementRequirementXref,
  ConformanceQuestion, ConformanceResponse, RequirementCriterion,
} from "../../db/models";
import type { AssessmentRunStatus, GapSeverity } from "../../db/models/assessment.models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

// An element scoring below this (on the 0–9 maturity rubric) surfaces as a gap.
const GAP_THRESHOLD = 5;

interface ModuleRec {
  key: string;
  label: string;
  route: string;
}
const DEFAULT_MODULE: ModuleRec = { key: "documented-information", label: "Documented Information", route: "/implementation/documents" };
// Weak element → the implementation module that closes it (the gap journey exit).
const MODULE_BY_ELEMENT: Record<string, ModuleRec> = {
  "Internal Audit": { key: "internal-audit", label: "Internal Audit", route: "/internal-audit" },
  "Risk Assessment": { key: "risk-management", label: "Risk Management", route: "/implementation/risks" },
  "Risk Treatment": { key: "risk-management", label: "Risk Management", route: "/implementation/risks" },
  "Management Review": { key: "management-review", label: "Management Review", route: "/implementation/reviews" },
  "Objectives & Planning": { key: "objectives", label: "Objectives & Planning", route: "/implementation/objectives" },
  // OD redirects its 'tn-m-competence' gap recommendation straight into the
  // real Competence/Assessments area (index.html:8079, `tnAssessRender`) —
  // never a clause register. The FE's duplicate orphan register at
  // `/implementation/competence` was removed; route there instead.
  Competence: { key: "competence", label: "Competence", route: "/competence?tab=assessments" },
  "Nonconformity & Corrective Action": { key: "corrective-actions", label: "Corrective Actions", route: "/implementation/incidents" },
  "Continual Improvement": { key: "compliance", label: "Compliance Monitoring", route: "/implementation/compliance" },
};
function recommendModule(elementName: string): ModuleRec {
  return MODULE_BY_ELEMENT[elementName] ?? DEFAULT_MODULE;
}

function severityFor(score: number): GapSeverity {
  if (score < 2) return "High";
  if (score < 4) return "Medium";
  return "Low";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- Views -----------------------------------------------------------------

export interface AssessmentView {
  id: string;
  code: string;
  orgId: string;
  tenantName: string;
  siteId: string | null;
  siteName: string | null;
  frameworkId: string | null;
  frameworkName: string | null;
  title: string;
  status: AssessmentRunStatus;
  version: number;
  maturityScore: number | null;
  questionCount: number;
  answeredCount: number;
  gapCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssessmentResponseView {
  id: string;
  text: string;
  score: number | null;
}
export interface AssessmentQuestionView {
  id: string;
  text: string;
  answeredResponseId: string | null;
  responses: AssessmentResponseView[];
}
export interface AssessmentElementView {
  elementId: string;
  elementName: string;
  questions: AssessmentQuestionView[];
}
export interface AssessmentDetailView extends AssessmentView {
  elements: AssessmentElementView[];
}

export interface ResultElementView {
  elementId: string;
  elementName: string;
  score: number | null;
  answeredCount: number;
  questionCount: number;
}
export interface AssessmentResultView {
  assessmentId: string;
  status: AssessmentRunStatus;
  maturityScore: number | null;
  questionCount: number;
  answeredCount: number;
  elements: ResultElementView[];
}

export interface GapView {
  id: string;
  assessmentId: string;
  elementId: string | null;
  elementName: string;
  score: number;
  severity: GapSeverity;
  recommendedModuleKey: string;
  recommendedModuleLabel: string;
  recommendedRoute: string;
}

// ---- Question set (framework scope → assessable elements/questions) --------

interface QElement {
  elementId: string;
  elementName: string;
  questions: {
    id: string;
    text: string;
    responses: { id: string; text: string; score: number | null }[];
  }[];
}

/**
 * The assessable question set for a scope: framework → its requirements → xref →
 * elements → their Active conformance questions (with Active graded responses).
 * A null framework assesses every Active element (whole-library baseline).
 */
async function buildQuestionSet(frameworkId: string | null): Promise<QElement[]> {
  let elementIds: string[] | null = null;
  if (frameworkId) {
    const reqs = await FrameworkRequirement.findAll({ where: { frameworkId, status: "Active" }, attributes: ["id"] });
    const reqIds = reqs.map((r) => r.id);
    if (reqIds.length === 0) return [];
    const xrefs = await ElementRequirementXref.findAll({ where: { requirementId: { [Op.in]: reqIds } }, attributes: ["elementId"] });
    elementIds = [...new Set(xrefs.map((x) => x.elementId))];
    if (elementIds.length === 0) return [];
  }

  const elementWhere: WhereOptions = { status: "Active" };
  if (elementIds) Object.assign(elementWhere, { id: { [Op.in]: elementIds } });
  const elements = await FrameworkElement.findAll({ where: elementWhere, order: [["code", "ASC"]] });

  const out: QElement[] = [];
  for (const el of elements) {
    const questions = await ConformanceQuestion.findAll({
      where: { elementId: el.id, status: "Active" },
      order: [["sortOrder", "ASC"]],
      include: [{
        model: ConformanceResponse,
        required: false,
        where: { status: "Active" },
        include: [{ model: RequirementCriterion, required: false }],
      }],
    });
    const qOut = questions
      .map((q) => {
        const responses = ((q.get("ConformanceResponses") as ConformanceResponse[] | undefined) ?? [])
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((r) => {
            const crit = r.get("RequirementCriterion") as RequirementCriterion | undefined;
            return { id: r.id, text: r.text, score: crit ? crit.score : null };
          });
        return { id: q.id, text: q.text, responses };
      })
      .filter((q) => q.responses.length > 0);
    if (qOut.length > 0) out.push({ elementId: el.id, elementName: el.name, questions: qOut });
  }
  return out;
}

// ---- Scoping helpers -------------------------------------------------------

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

async function requireAssessment(auth: AuthContext, id: string): Promise<Assessment> {
  const a = await Assessment.findByPk(id);
  if (!a) throw new NotFoundError("Assessment does not exist", "ASSESSMENT_NOT_FOUND");
  await assertCanSeeOrg(auth, a.orgId);
  return a;
}

async function nextCode(): Promise<string> {
  const rows = await Assessment.findAll({ attributes: ["code"] });
  let max = 1000;
  for (const r of rows) {
    const n = Number.parseInt(r.code.replace(/^ASM-/, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `ASM-${max + 1}`;
}

async function baseView(a: Assessment): Promise<AssessmentView> {
  const [org, site, fw, answers, gaps, qset] = await Promise.all([
    Organization.findByPk(a.orgId),
    a.siteId ? Site.findByPk(a.siteId) : Promise.resolve(null),
    a.frameworkId ? Framework.findByPk(a.frameworkId) : Promise.resolve(null),
    AssessmentAnswer.findAll({ where: { assessmentId: a.id } }),
    Gap.count({ where: { assessmentId: a.id } }),
    buildQuestionSet(a.frameworkId),
  ]);
  const questionCount = qset.reduce((s, e) => s + e.questions.length, 0);
  return {
    id: a.id, code: a.code, orgId: a.orgId, tenantName: org?.name ?? "—",
    siteId: a.siteId, siteName: site?.name ?? null,
    frameworkId: a.frameworkId, frameworkName: fw?.name ?? null,
    title: a.title, status: a.status, version: a.version,
    maturityScore: a.maturityScore === null ? null : Number(a.maturityScore),
    questionCount, answeredCount: answers.length, gapCount: gaps,
    startedAt: a.startedAt, completedAt: a.completedAt, createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

async function detailView(a: Assessment): Promise<AssessmentDetailView> {
  const [base, qset, answers] = await Promise.all([
    baseView(a),
    buildQuestionSet(a.frameworkId),
    AssessmentAnswer.findAll({ where: { assessmentId: a.id } }),
  ]);
  const answerByQuestion = new Map(answers.map((ans) => [ans.questionId, ans.responseId]));
  const elements: AssessmentElementView[] = qset.map((e) => ({
    elementId: e.elementId,
    elementName: e.elementName,
    questions: e.questions.map((q) => ({
      id: q.id,
      text: q.text,
      answeredResponseId: answerByQuestion.get(q.id) ?? null,
      responses: q.responses,
    })),
  }));
  return { ...base, elements };
}

// ---- Public API ------------------------------------------------------------

export interface CreateAssessmentInput {
  orgId?: string;
  siteId?: string | null;
  frameworkId?: string | null;
  title?: string;
}

export async function listAssessments(auth: AuthContext, filters: { orgId?: string } = {}): Promise<AssessmentView[]> {
  const where: WhereOptions = {};
  const ids = await visibleTenantOrgIds(auth);
  if (filters.orgId) {
    await assertCanSeeOrg(auth, filters.orgId);
    Object.assign(where, { orgId: filters.orgId });
  } else if (ids !== null) {
    Object.assign(where, { orgId: { [Op.in]: ids } });
  }
  const rows = await Assessment.findAll({ where, order: [["createdAt", "DESC"]] });
  return Promise.all(rows.map(baseView));
}

export async function getAssessment(auth: AuthContext, id: string): Promise<AssessmentDetailView> {
  const a = await requireAssessment(auth, id);
  return detailView(a);
}

export async function createAssessment(auth: AuthContext, input: CreateAssessmentInput, ip: string | null): Promise<AssessmentDetailView> {
  const orgId = input.orgId ?? auth.orgId;
  await assertCanSeeOrg(auth, orgId);
  let frameworkName = "framework";
  if (input.frameworkId) {
    const fw = await Framework.findByPk(input.frameworkId);
    if (!fw) throw new BadRequestError("Framework does not exist", "FRAMEWORK_NOT_FOUND");
    frameworkName = fw.name;
  }
  if (input.siteId) {
    const site = await Site.findOne({ where: { id: input.siteId, orgId } });
    if (!site) throw new BadRequestError("Site does not belong to this tenant", "SITE_NOT_FOUND");
  }
  const a = await Assessment.create({
    code: await nextCode(),
    orgId,
    siteId: input.siteId ?? null,
    frameworkId: input.frameworkId ?? null,
    title: input.title?.trim() || `Assessment — ${frameworkName}`,
    status: "Draft",
    version: 1,
    maturityScore: null,
    startedAt: null,
    completedAt: null,
  });
  await writeAudit({
    actorUserId: auth.userId, organizationId: orgId,
    action: "assessment.created", entityType: "Assessment", entityId: a.id, sourceIp: ip, result: "Success",
  });
  return detailView(a);
}

export interface SubmitAnswersInput {
  answers: Record<string, string>; // questionId -> responseId
}

export async function submitAnswers(auth: AuthContext, id: string, input: SubmitAnswersInput, ip: string | null): Promise<AssessmentDetailView> {
  const a = await requireAssessment(auth, id);
  if (a.status === "Completed") throw new BadRequestError("Assessment is already finalized", "ASSESSMENT_FINALIZED");

  const qset = await buildQuestionSet(a.frameworkId);
  const validQuestions = new Map<string, Set<string>>();
  for (const e of qset) for (const q of e.questions) validQuestions.set(q.id, new Set(q.responses.map((r) => r.id)));

  const entries = Object.entries(input.answers);
  if (entries.length === 0) throw new BadRequestError("No answers provided", "NO_ANSWERS");

  for (const [questionId, responseId] of entries) {
    const validResponses = validQuestions.get(questionId);
    if (!validResponses) throw new BadRequestError("Question is not part of this assessment", "QUESTION_OUT_OF_SCOPE");
    if (!validResponses.has(responseId)) throw new BadRequestError("Response does not belong to the question", "RESPONSE_INVALID");
    const response = await ConformanceResponse.findByPk(responseId);
    const criterionId = response?.criterionId ?? null;
    let score: number | null = null;
    if (criterionId) {
      const crit = await RequirementCriterion.findByPk(criterionId);
      score = crit ? crit.score : null;
    }
    const existing = await AssessmentAnswer.findOne({ where: { assessmentId: a.id, questionId } });
    if (existing) {
      existing.responseId = responseId;
      existing.criterionId = criterionId;
      existing.score = score;
      await existing.save();
    } else {
      await AssessmentAnswer.create({ assessmentId: a.id, questionId, responseId, criterionId, score });
    }
  }

  if (a.status === "Draft") {
    a.status = "In Progress";
    a.startedAt = a.startedAt ?? new Date();
    await a.save();
  }
  await writeAudit({
    actorUserId: auth.userId, organizationId: a.orgId,
    action: "assessment.answered", entityType: "Assessment", entityId: a.id, sourceIp: ip, result: "Success",
    metadata: { answered: entries.length },
  });
  return detailView(a);
}

/** Compute per-element and overall maturity from the answered questions. */
async function computeResult(a: Assessment): Promise<{ result: AssessmentResultView; elementScores: { elementId: string; elementName: string; score: number }[] }> {
  const [qset, answers] = await Promise.all([
    buildQuestionSet(a.frameworkId),
    AssessmentAnswer.findAll({ where: { assessmentId: a.id } }),
  ]);
  const scoreByQuestion = new Map(answers.map((ans) => [ans.questionId, ans.score]));

  const resultElements: ResultElementView[] = [];
  const elementScores: { elementId: string; elementName: string; score: number }[] = [];
  for (const e of qset) {
    const scores: number[] = [];
    for (const q of e.questions) {
      const s = scoreByQuestion.get(q.id);
      if (s !== undefined && s !== null) scores.push(s);
    }
    const elScore = scores.length > 0 ? round2(scores.reduce((x, y) => x + y, 0) / scores.length) : null;
    resultElements.push({
      elementId: e.elementId, elementName: e.elementName,
      score: elScore, answeredCount: scores.length, questionCount: e.questions.length,
    });
    if (elScore !== null) elementScores.push({ elementId: e.elementId, elementName: e.elementName, score: elScore });
  }
  const questionCount = qset.reduce((s, e) => s + e.questions.length, 0);
  const answeredCount = answers.length;
  const maturityScore = elementScores.length > 0
    ? round2(elementScores.reduce((x, e) => x + e.score, 0) / elementScores.length)
    : null;
  return {
    result: { assessmentId: a.id, status: a.status, maturityScore, questionCount, answeredCount, elements: resultElements },
    elementScores,
  };
}

export async function getResults(auth: AuthContext, id: string): Promise<AssessmentResultView> {
  const a = await requireAssessment(auth, id);
  const { result } = await computeResult(a);
  // On a finalized run report the stored score (stable snapshot).
  if (a.status === "Completed") result.maturityScore = a.maturityScore === null ? null : Number(a.maturityScore);
  return result;
}

export async function finalizeAssessment(auth: AuthContext, id: string, ip: string | null): Promise<AssessmentResultView> {
  const a = await requireAssessment(auth, id);
  const answerCount = await AssessmentAnswer.count({ where: { assessmentId: a.id } });
  if (answerCount === 0) throw new BadRequestError("Answer at least one question before finalizing", "NO_ANSWERS");

  const { result, elementScores } = await computeResult(a);

  // Re-derive gaps from scratch (idempotent finalize / reassessment).
  await Gap.destroy({ where: { assessmentId: a.id } });
  for (const e of elementScores) {
    if (e.score < GAP_THRESHOLD) {
      const mod = recommendModule(e.elementName);
      await Gap.create({
        assessmentId: a.id, elementId: e.elementId, elementName: e.elementName,
        score: e.score, severity: severityFor(e.score),
        recommendedModuleKey: mod.key, recommendedModuleLabel: mod.label, recommendedRoute: mod.route,
      });
    }
  }

  a.status = "Completed";
  a.completedAt = new Date();
  a.maturityScore = result.maturityScore;
  await a.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: a.orgId,
    action: "assessment.finalized", entityType: "Assessment", entityId: a.id, sourceIp: ip, result: "Success",
    metadata: { maturityScore: result.maturityScore },
  });
  result.status = "Completed";
  return result;
}

export async function listGaps(auth: AuthContext, id: string): Promise<GapView[]> {
  const a = await requireAssessment(auth, id);
  const gaps = await Gap.findAll({ where: { assessmentId: a.id }, order: [["score", "ASC"]] });
  return gaps.map((g) => ({
    id: g.id, assessmentId: g.assessmentId, elementId: g.elementId, elementName: g.elementName,
    score: Number(g.score), severity: g.severity,
    recommendedModuleKey: g.recommendedModuleKey, recommendedModuleLabel: g.recommendedModuleLabel, recommendedRoute: g.recommendedRoute,
  }));
}

/**
 * Start a new version of a finalized assessment — same scope, prior answers
 * carried over so the tenant can re-answer and compare maturity across versions.
 */
export async function reassess(auth: AuthContext, id: string, ip: string | null): Promise<AssessmentDetailView> {
  const prev = await requireAssessment(auth, id);
  const next = await Assessment.create({
    code: await nextCode(),
    orgId: prev.orgId,
    siteId: prev.siteId,
    frameworkId: prev.frameworkId,
    title: prev.title,
    status: "In Progress",
    version: prev.version + 1,
    maturityScore: null,
    startedAt: new Date(),
    completedAt: null,
  });
  const priorAnswers = await AssessmentAnswer.findAll({ where: { assessmentId: prev.id } });
  for (const ans of priorAnswers) {
    await AssessmentAnswer.create({
      assessmentId: next.id, questionId: ans.questionId, responseId: ans.responseId,
      criterionId: ans.criterionId, score: ans.score,
    });
  }
  await writeAudit({
    actorUserId: auth.userId, organizationId: next.orgId,
    action: "assessment.reassessed", entityType: "Assessment", entityId: next.id, sourceIp: ip, result: "Success",
    metadata: { fromAssessmentId: prev.id, version: next.version },
  });
  return detailView(next);
}
