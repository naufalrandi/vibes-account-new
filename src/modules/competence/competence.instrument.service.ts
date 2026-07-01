import { Op } from "sequelize";
import {
  CompetenceExamInstrument, CompetencePracticalInstrument,
  CompetenceExamAttempt, CompetencePracticalAttempt, CompetenceSkill,
} from "../../db/models";
import { INSTRUMENT_STATUS, type ExamQuestion, type PracticalCriterion } from "../../db/models/competence.models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v == null || v === "" ? null : String(v));
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function audit(auth: AuthContext, action: string, entityType: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}

// ---------------- Exam instruments (L1–L3 ladder) ----------------
export async function listExamInstruments(filters: { skillId?: string } = {}) {
  const where = filters.skillId ? { skillId: filters.skillId } : {};
  return (await CompetenceExamInstrument.findAll({ where, order: [["level", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createExamInstrument(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const skillId = str(input.skillId);
  const level = num(input.level);
  if (!skillId) throw new BadRequestError("Skill is required", "SKILL_REQUIRED");
  if (![1, 2, 3].includes(level)) throw new BadRequestError("Exam level must be 1, 2 or 3", "INVALID_LEVEL");
  const skill = await CompetenceSkill.findByPk(skillId);
  if (!skill) throw new NotFoundError("Skill not found", "SKILL_NOT_FOUND");
  const row = await CompetenceExamInstrument.create({
    skillId, level, name: str(input.name) ?? `${skill.name} — L${level} Exam`, status: "Draft",
    passMark: input.passMark !== undefined ? num(input.passMark) : 70, durationMin: input.durationMin !== undefined ? num(input.durationMin) : 30,
    attempts: num(input.attempts), shuffleQ: input.shuffleQ === true, drawCount: num(input.drawCount),
    questions: (Array.isArray(input.questions) ? input.questions : []) as ExamQuestion[],
  });
  await audit(auth, "competence.exam.created", "CompetenceExamInstrument", row.id, ip);
  return row.get({ plain: true });
}
export async function updateExamInstrument(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await CompetenceExamInstrument.findByPk(id);
  if (!row) throw new NotFoundError("Exam not found", "EXAM_NOT_FOUND");
  if (input.name !== undefined) row.name = str(input.name) ?? row.name;
  if (input.passMark !== undefined) row.passMark = num(input.passMark);
  if (input.durationMin !== undefined) row.durationMin = num(input.durationMin);
  if (input.attempts !== undefined) row.attempts = num(input.attempts);
  if (input.shuffleQ !== undefined) row.shuffleQ = input.shuffleQ === true;
  if (input.drawCount !== undefined) row.drawCount = num(input.drawCount);
  if (input.questions !== undefined) row.questions = (Array.isArray(input.questions) ? input.questions : []) as ExamQuestion[];
  await row.save();
  await audit(auth, "competence.exam.updated", "CompetenceExamInstrument", row.id, ip);
  return row.get({ plain: true });
}
export async function setExamStatus(auth: AuthContext, id: string, status: string, ip: string | null) {
  if (!INSTRUMENT_STATUS.includes(status as never)) throw new BadRequestError("Invalid status", "INVALID_STATUS");
  const row = await CompetenceExamInstrument.findByPk(id);
  if (!row) throw new NotFoundError("Exam not found", "EXAM_NOT_FOUND");
  row.status = status;
  await row.save();
  await audit(auth, "competence.exam.status", "CompetenceExamInstrument", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteExamInstrument(auth: AuthContext, id: string, ip: string | null) {
  const row = await CompetenceExamInstrument.findByPk(id);
  if (!row) throw new NotFoundError("Exam not found", "EXAM_NOT_FOUND");
  await row.destroy();
  await audit(auth, "competence.exam.deleted", "CompetenceExamInstrument", id, ip);
}

// ---------------- Practical instruments (L4) ----------------
export async function listPracticalInstruments(filters: { skillId?: string } = {}) {
  const where = filters.skillId ? { skillId: filters.skillId } : {};
  return (await CompetencePracticalInstrument.findAll({ where, order: [["createdAt", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createPracticalInstrument(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const skillId = str(input.skillId);
  if (!skillId) throw new BadRequestError("Skill is required", "SKILL_REQUIRED");
  const skill = await CompetenceSkill.findByPk(skillId);
  if (!skill) throw new NotFoundError("Skill not found", "SKILL_NOT_FOUND");
  const row = await CompetencePracticalInstrument.create({
    skillId, level: 4, name: str(input.name) ?? `${skill.name} — L4 Expert Practical Assessment`, status: "Draft",
    passMark: input.passMark !== undefined ? num(input.passMark) : 75,
    criteria: (Array.isArray(input.criteria) ? input.criteria : []) as PracticalCriterion[],
  });
  await audit(auth, "competence.practical.created", "CompetencePracticalInstrument", row.id, ip);
  return row.get({ plain: true });
}
export async function updatePracticalInstrument(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await CompetencePracticalInstrument.findByPk(id);
  if (!row) throw new NotFoundError("Practical not found", "PRACTICAL_NOT_FOUND");
  if (input.name !== undefined) row.name = str(input.name) ?? row.name;
  if (input.passMark !== undefined) row.passMark = num(input.passMark);
  if (input.criteria !== undefined) row.criteria = (Array.isArray(input.criteria) ? input.criteria : []) as PracticalCriterion[];
  await row.save();
  await audit(auth, "competence.practical.updated", "CompetencePracticalInstrument", row.id, ip);
  return row.get({ plain: true });
}
export async function setPracticalStatus(auth: AuthContext, id: string, status: string, ip: string | null) {
  if (!INSTRUMENT_STATUS.includes(status as never)) throw new BadRequestError("Invalid status", "INVALID_STATUS");
  const row = await CompetencePracticalInstrument.findByPk(id);
  if (!row) throw new NotFoundError("Practical not found", "PRACTICAL_NOT_FOUND");
  row.status = status;
  await row.save();
  await audit(auth, "competence.practical.status", "CompetencePracticalInstrument", row.id, ip);
  return row.get({ plain: true });
}
export async function deletePracticalInstrument(auth: AuthContext, id: string, ip: string | null) {
  const row = await CompetencePracticalInstrument.findByPk(id);
  if (!row) throw new NotFoundError("Practical not found", "PRACTICAL_NOT_FOUND");
  await row.destroy();
  await audit(auth, "competence.practical.deleted", "CompetencePracticalInstrument", id, ip);
}

// ---------------- Scoring ----------------
/** Auto-score a written exam attempt (single/multi/true-false auto; short = assessor points). */
export function gradeExam(questions: ExamQuestion[], answers: Record<string, unknown>): { earned: number; total: number; score: number } {
  let earned = 0, total = 0;
  for (const q of questions) {
    total += q.points;
    const a = answers[q.id];
    if (q.type === "short") {
      const awarded = typeof a === "number" ? a : a && typeof a === "object" && "points" in (a as object) ? num((a as { points: unknown }).points) : 0;
      earned += Math.max(0, Math.min(q.points, awarded));
      continue;
    }
    let ok = false;
    if (q.type === "single") { const c = (q.options ?? []).find((o) => o.correct); ok = Boolean(c) && a === c!.id; }
    else if (q.type === "truefalse") ok = String(a) === String(Boolean(q.answerTrue));
    else if (q.type === "multi") {
      const correct = (q.options ?? []).filter((o) => o.correct).map((o) => o.id).sort();
      const sel = Array.isArray(a) ? a.map(String).sort() : [];
      ok = correct.length === sel.length && correct.every((x, i) => x === sel[i]);
    }
    if (ok) earned += q.points;
  }
  const score = total ? Math.round((earned / total) * 100) : 0;
  return { earned, total, score };
}

export function gradePractical(criteria: PracticalCriterion[], scores: Record<string, unknown>): { earned: number; total: number; score: number } {
  let earned = 0, total = 0;
  for (const c of criteria) { total += c.points; earned += Math.max(0, Math.min(c.points, num(scores[c.id]))); }
  const score = total ? Math.round((earned / total) * 100) : 0;
  return { earned, total, score };
}

export async function takeExam(auth: AuthContext, instrumentId: string, input: Record<string, unknown>, ip: string | null) {
  const inst = await CompetenceExamInstrument.findByPk(instrumentId);
  if (!inst) throw new NotFoundError("Exam not found", "EXAM_NOT_FOUND");
  const personId = str(input.personId);
  if (!personId) throw new BadRequestError("Person is required", "PERSON_REQUIRED");
  const answers = (input.answers && typeof input.answers === "object" ? input.answers : {}) as Record<string, unknown>;
  const { earned, total, score } = gradeExam(inst.questions, answers);
  const passed = score >= inst.passMark;
  const preview = input.preview === true;
  const result = { instrumentId, skillId: inst.skillId, level: inst.level, personId, personName: str(input.personName), score, earned, total, passed, preview };
  if (preview) return { ...result, id: null, takenAt: new Date().toISOString() };
  const row = await CompetenceExamAttempt.create({ orgId: auth.orgId, ...result });
  await audit(auth, "competence.exam.attempt", "CompetenceExamAttempt", row.id, ip);
  return row.get({ plain: true });
}

export async function runPractical(auth: AuthContext, instrumentId: string, input: Record<string, unknown>, ip: string | null) {
  const inst = await CompetencePracticalInstrument.findByPk(instrumentId);
  if (!inst) throw new NotFoundError("Practical not found", "PRACTICAL_NOT_FOUND");
  const personId = str(input.personId);
  if (!personId) throw new BadRequestError("Person is required", "PERSON_REQUIRED");
  const scores = (input.scores && typeof input.scores === "object" ? input.scores : {}) as Record<string, unknown>;
  const { earned, total, score } = gradePractical(inst.criteria, scores);
  const passed = score >= inst.passMark;
  const preview = input.preview === true;
  const result = { instrumentId, skillId: inst.skillId, level: 4, personId, personName: str(input.personName), assessor: str(input.assessor), evidence: str(input.evidence), score, earned, total, passed, preview };
  if (preview) return { ...result, id: null, takenAt: new Date().toISOString() };
  const row = await CompetencePracticalAttempt.create({ orgId: auth.orgId, ...result });
  await audit(auth, "competence.practical.attempt", "CompetencePracticalAttempt", row.id, ip);
  return row.get({ plain: true });
}

export async function listAttempts(auth: AuthContext, filters: { personId?: string; skillId?: string } = {}) {
  const ids = await visibleTenantOrgIds(auth);
  const scope: Record<string, unknown> = ids === null ? {} : { orgId: { [Op.in]: ids } };
  if (filters.personId) scope.personId = filters.personId;
  if (filters.skillId) scope.skillId = filters.skillId;
  const [exams, practicals] = await Promise.all([
    CompetenceExamAttempt.findAll({ where: scope, order: [["takenAt", "DESC"]] }),
    CompetencePracticalAttempt.findAll({ where: scope, order: [["takenAt", "DESC"]] }),
  ]);
  return { exams: exams.map((r) => r.get({ plain: true })), practicals: practicals.map((r) => r.get({ plain: true })) };
}

/** The ladder: highest consecutive passed exam level (L1→L3), practical pass, and
 * the effective competence proficiency level fed to assessments. */
export async function skillLevel(auth: AuthContext, skillId: string, personId: string) {
  const ids = await visibleTenantOrgIds(auth);
  const scope: Record<string, unknown> = { skillId, personId, passed: true, preview: false };
  if (ids !== null) scope.orgId = { [Op.in]: ids };
  const exams = await CompetenceExamAttempt.findAll({ where: scope, attributes: ["level"] });
  const passedLevels = new Set(exams.map((e) => e.level));
  let achieved = 0;
  for (let l = 1; l <= 3; l++) { if (passedLevels.has(l)) achieved = l; else break; }
  const prac = await CompetencePracticalAttempt.findOne({ where: scope });
  const practicalPassed = Boolean(prac);
  const compInstrLevel = achieved >= 3 && practicalPassed ? 4 : achieved;
  // Next unlocked level requires a Published exam at that level.
  let nextLevel = 0;
  if (achieved < 3) {
    const n = achieved + 1;
    const published = await CompetenceExamInstrument.findOne({ where: { skillId, level: n, status: "Published" } });
    if (published) nextLevel = n;
  }
  return { skillId, personId, examAchievedLevel: achieved, practicalPassed, compInstrLevel, nextLevel };
}
