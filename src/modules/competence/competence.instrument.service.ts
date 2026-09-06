import { randomUUID } from "node:crypto";
import { Op } from "sequelize";
import {
  CompetenceExamInstrument, CompetencePracticalInstrument,
  CompetenceExamAttempt, CompetencePracticalAttempt, CompetenceSkill,
} from "../../db/models";
import { INSTRUMENT_STATUS, PROF_LEVELS, type ExamQuestion, type PracticalCriterion } from "../../db/models/competence.models";
import { EXAM_BANK, type ExamQuestion as BankQuestion } from "../reference/reference.data";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : v == null || v === "" ? null : String(v));
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function audit(auth: AuthContext, action: string, entityType: string, entityId: string, ip: string | null) {
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action, entityType, entityId, sourceIp: ip, result: "Success" });
}

// ---------------- Org scoping (OD dual model: global SP library + tenant rows) ----------------
/** Global (org_id NULL) instruments are visible to everyone; tenant rows to their owner. */
async function orgClause(auth: AuthContext): Promise<Record<string, unknown>> {
  const ids = await visibleTenantOrgIds(auth);
  return ids === null ? {} : { [Op.or]: [{ orgId: null }, { orgId: { [Op.in]: ids } }] };
}
function ownerOrgId(auth: AuthContext): string | null {
  return auth.orgType === "ServiceOwner" ? null : auth.orgId;
}
/** SP may mutate global rows; a tenant only its own (scopeDataset `requireOwned` pattern). */
function assertOwned(auth: AuthContext, rowOrgId: string | null): void {
  const ownGlobal = rowOrgId === null && auth.orgType === "ServiceOwner";
  if (!ownGlobal && rowOrgId !== auth.orgId) throw new ForbiddenError();
}
/** Reads/attempts may reach global rows and rows in the caller's visible set. */
async function assertVisible(auth: AuthContext, rowOrgId: string | null): Promise<void> {
  if (rowOrgId === null) return;
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(rowOrgId) && rowOrgId !== auth.orgId) throw new ForbiddenError();
}

// ---------------- Publish validation (OD examValidate 18017 / pracValidate 18271) ----------------
export function validateExamPublish(inst: { name: string; questions: ExamQuestion[] }): string | null {
  if (!inst.name || !inst.name.trim()) return "Exam name is required.";
  if (!inst.questions || !inst.questions.length) return "Add at least one question before publishing.";
  for (let i = 0; i < inst.questions.length; i++) {
    const q = inst.questions[i];
    const n = i + 1;
    if (!q.text || !q.text.trim()) return `Q${n} needs question text.`;
    if (q.type === "single" || q.type === "multi") {
      if ((q.options ?? []).some((o) => !o.text || !o.text.trim())) return `Q${n}: every option needs text.`;
      const c = (q.options ?? []).filter((o) => o.correct).length;
      if (q.type === "single" && c !== 1) return `Q${n}: mark exactly one correct option.`;
      if (q.type === "multi" && c < 1) return `Q${n}: mark at least one correct option.`;
    }
  }
  return null;
}
export function validatePracticalPublish(inst: { name: string; criteria: PracticalCriterion[] }): string | null {
  if (!inst.name || !inst.name.trim()) return "Name is required.";
  if (!inst.criteria || !inst.criteria.length) return "Add at least one assessment criterion before publishing.";
  for (let i = 0; i < inst.criteria.length; i++) {
    if (!inst.criteria[i].text || !inst.criteria[i].text.trim()) return `Criterion ${i + 1} needs a description.`;
  }
  return null;
}

// ---------------- Bank-driven global seed (OD examSeedIfNeeded 17964 / pracSeedIfNeeded 18244) ----------------
// The 15-hard-skill / 1,194-question exam bank (BE `reference/data/examBank.ts`, served
// read-only at GET /v1/reference/exam-bank) seeds Published L1–L3 written exams the first
// time any org reads the instrument ladder. OD keys a seeded exam to an existing
// `db.compSkills` hard skill by exact name match (16740/16750 top-up); this BE has no
// pre-seeded skill library at all, so the seed also creates the 15 matching hard-skill rows
// (global, org_id NULL — the SP library half of the dual model) as a prerequisite.
//
// Global-once, not per-org: OD's exam/practical instrument arrays (`db.examInstruments`,
// `db.practicalInstruments`) are themselves a single shared library, not per-tenant data —
// re-running the bank seed per org would fragment one shared ladder into N duplicate
// copies and multiply 1,194 questions × orgs for no product benefit. Every org already sees
// global (org_id NULL) instrument rows via `orgClause` (dual model, migration 0040), so
// seeding once under org_id NULL is the closer match to OD and is idempotent — guarded by
// a single count check, mirroring `scopeDataset.ensureGlobalSeed`.
//
// Practicals: OD's `pracSeedIfNeeded` hardcodes exactly one L4 rubric, for "Internal
// Auditing" — the bank itself carries no practical-assessment section for any skill (only
// `levels` 1–3). Ported verbatim; the other 14 skills stay exam-only, exactly like OD.
const EXAM_DURATIONS: Record<number, number> = { 1: 25, 2: 30, 3: 40 };

/** OD `examNormQ` (17958–17963): compact bank question → full instrument question. */
function normalizeBankQuestion(c: BankQuestion): ExamQuestion {
  const base = { id: randomUUID(), text: c.q ?? "", points: Number.isFinite(c.p) && c.p > 0 ? c.p : 1, explanation: "", ref: c.ref ?? "" };
  if (c.t === "single" || c.t === "multi") {
    return { ...base, type: c.t, options: (c.o ?? []).map(([text, correct]) => ({ id: randomUUID(), text, correct: Boolean(correct) })) };
  }
  if (c.t === "tf") return { ...base, type: "truefalse", answerTrue: Boolean(c.a) };
  if (c.t === "short") return { ...base, type: "short", model: c.m ?? "" };
  return { ...base, type: "single", options: [] };
}

/** OD `pracSeedIfNeeded` (18249–18255) L4 rubric — the only OD-authored practical content. */
const INTERNAL_AUDITING_PRACTICAL_CRITERIA: { text: string; points: number; guidance: string }[] = [
  { text: "Plans and leads a risk-based audit programme spanning multiple processes", points: 2, guidance: "Scope, criteria and methods are defined and proportionate to risk; resourcing and scheduling are sound." },
  { text: "Conducts opening and closing meetings, managing auditee dynamics professionally", points: 1, guidance: "Sets expectations, handles disagreement calmly, communicates findings clearly." },
  { text: "Gathers and corroborates objective evidence and reaches defensible conclusions", points: 2, guidance: "Triangulates records, interviews and observation; conclusions trace to verifiable evidence." },
  { text: "Grades and documents nonconformities with clear, traceable evidence", points: 2, guidance: "Correct classification (major/minor); statements are specific, factual and reproducible." },
  { text: "Mentors junior auditors and reviews the quality of their findings", points: 1, guidance: "Provides actionable coaching; corrects weak findings before reporting." },
  { text: "Evaluates audit-programme effectiveness and recommends improvements", points: 1, guidance: "Identifies systemic themes; recommendations are practical and add value." },
];

/** Ensure the global (org_id NULL) hard skill backing a bank entry exists — OD's
 * compSkillLib top-up (16750), scoped to just the 15 bank skill names. */
async function ensureBankSkill(name: string): Promise<CompetenceSkill> {
  const [skill] = await CompetenceSkill.findOrCreate({
    where: { orgId: null, name, type: "hard" },
    defaults: { orgId: null, name, type: "hard", description: null, methods: ["Written exam", "Practical assessment"] },
  });
  return skill;
}

/** Idempotent, global, lazy bank seed — call at the top of every instrument read. */
export async function ensureInstrumentSeed(): Promise<void> {
  const already = await CompetenceExamInstrument.count({ where: { orgId: null } });
  if (already > 0) return;
  for (const [skillName, def] of Object.entries(EXAM_BANK)) {
    const skill = await ensureBankSkill(skillName);
    for (const level of [1, 2, 3] as const) {
      const bankQs = def.levels[String(level)] ?? [];
      if (!bankQs.length) continue;
      const dup = await CompetenceExamInstrument.findOne({ where: { orgId: null, skillId: skill.id, level } });
      if (dup) continue;
      const questions = bankQs.map(normalizeBankQuestion);
      const name = `${skillName} — L${level} ${PROF_LEVELS[level]} Exam`;
      // Seeded exams must clear the same publish gate a manually-authored exam would
      // (validated against the full 1,194-question bank offline — see scratchpad notes);
      // fall back to Draft in the defensive case a future bank edit introduces bad data.
      const invalid = validateExamPublish({ name, questions });
      await CompetenceExamInstrument.create({
        orgId: null, skillId: skill.id, level, name, status: invalid ? "Draft" : "Published",
        passMark: 70, durationMin: EXAM_DURATIONS[level] ?? 30, attempts: 2, shuffleQ: true, drawCount: 0,
        questions,
      });
    }
  }
  const auditSkill = await CompetenceSkill.findOne({ where: { orgId: null, name: "Internal Auditing", type: "hard" } });
  if (auditSkill) {
    const dup = await CompetencePracticalInstrument.findOne({ where: { orgId: null, skillId: auditSkill.id } });
    if (!dup) {
      const criteria = INTERNAL_AUDITING_PRACTICAL_CRITERIA.map((c) => ({ id: randomUUID(), ...c }));
      const name = "Internal Auditing — L4 Expert Practical Assessment";
      const invalid = validatePracticalPublish({ name, criteria });
      await CompetencePracticalInstrument.create({
        orgId: null, skillId: auditSkill.id, level: 4, name, status: invalid ? "Draft" : "Published",
        passMark: 75, criteria,
      });
    }
  }
}

// ---------------- Exam instruments (L1–L3 ladder) ----------------
export async function listExamInstruments(auth: AuthContext, filters: { skillId?: string } = {}) {
  await ensureInstrumentSeed();
  const scope = await orgClause(auth);
  const where = filters.skillId ? { ...scope, skillId: filters.skillId } : scope;
  return (await CompetenceExamInstrument.findAll({ where, order: [["level", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createExamInstrument(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const skillId = str(input.skillId);
  const level = num(input.level);
  if (!skillId) throw new BadRequestError("Skill is required", "SKILL_REQUIRED");
  if (![1, 2, 3].includes(level)) throw new BadRequestError("Exam level must be 1, 2 or 3", "INVALID_LEVEL");
  const skill = await CompetenceSkill.findByPk(skillId);
  if (!skill) throw new NotFoundError("Skill not found", "SKILL_NOT_FOUND");
  // One exam per skill+level within the caller's visible library (OD examSave dup guard, 18034).
  const dup = await CompetenceExamInstrument.findOne({ where: { ...(await orgClause(auth)), skillId, level } });
  if (dup) throw new BadRequestError(`An exam already exists for ${skill.name} at L${level}.`, "EXAM_EXISTS");
  const row = await CompetenceExamInstrument.create({
    orgId: ownerOrgId(auth),
    skillId, level,
    // OD names it "<skill> — L<n> <proficiency> Exam" (e.g. "Internal Auditing —
    // L1 Awareness Exam"); the proficiency label was being dropped.
    name: str(input.name) ?? `${skill.name} — L${level} ${PROF_LEVELS[level] ?? ""} Exam`.replace(/\s+/g, " ").trim(),
    status: "Draft",
    passMark: input.passMark !== undefined ? num(input.passMark) : 70, durationMin: input.durationMin !== undefined ? num(input.durationMin) : 30,
    // OD defaults a new exam to two attempts with shuffled questions.
    attempts: input.attempts !== undefined ? num(input.attempts) : 2,
    shuffleQ: input.shuffleQ !== undefined ? input.shuffleQ === true : true,
    drawCount: num(input.drawCount),
    questions: (Array.isArray(input.questions) ? input.questions : []) as ExamQuestion[],
  });
  await audit(auth, "competence.exam.created", "CompetenceExamInstrument", row.id, ip);
  return row.get({ plain: true });
}
async function requireOwnedExam(auth: AuthContext, id: string): Promise<CompetenceExamInstrument> {
  const row = await CompetenceExamInstrument.findByPk(id);
  if (!row) throw new NotFoundError("Exam not found", "EXAM_NOT_FOUND");
  assertOwned(auth, row.orgId);
  return row;
}
export async function updateExamInstrument(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await requireOwnedExam(auth, id);
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
  const row = await requireOwnedExam(auth, id);
  if (status === "Published") {
    const err = validateExamPublish(row);
    if (err) throw new BadRequestError(err, "EXAM_INVALID");
  }
  row.status = status;
  await row.save();
  await audit(auth, "competence.exam.status", "CompetenceExamInstrument", row.id, ip);
  return row.get({ plain: true });
}
export async function deleteExamInstrument(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireOwnedExam(auth, id);
  await row.destroy();
  await audit(auth, "competence.exam.deleted", "CompetenceExamInstrument", id, ip);
}

// ---------------- Practical instruments (L4) ----------------
export async function listPracticalInstruments(auth: AuthContext, filters: { skillId?: string } = {}) {
  await ensureInstrumentSeed();
  const scope = await orgClause(auth);
  const where = filters.skillId ? { ...scope, skillId: filters.skillId } : scope;
  return (await CompetencePracticalInstrument.findAll({ where, order: [["createdAt", "ASC"]] })).map((r) => r.get({ plain: true }));
}
export async function createPracticalInstrument(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const skillId = str(input.skillId);
  if (!skillId) throw new BadRequestError("Skill is required", "SKILL_REQUIRED");
  const skill = await CompetenceSkill.findByPk(skillId);
  if (!skill) throw new NotFoundError("Skill not found", "SKILL_NOT_FOUND");
  // One practical per skill within the caller's visible library (OD pracSave dup guard).
  const dup = await CompetencePracticalInstrument.findOne({ where: { ...(await orgClause(auth)), skillId } });
  if (dup) throw new BadRequestError(`A practical assessment already exists for ${skill.name}.`, "PRACTICAL_EXISTS");
  const row = await CompetencePracticalInstrument.create({
    orgId: ownerOrgId(auth),
    skillId, level: 4, name: str(input.name) ?? `${skill.name} — L4 Expert Practical Assessment`, status: "Draft",
    passMark: input.passMark !== undefined ? num(input.passMark) : 75,
    criteria: (Array.isArray(input.criteria) ? input.criteria : []) as PracticalCriterion[],
  });
  await audit(auth, "competence.practical.created", "CompetencePracticalInstrument", row.id, ip);
  return row.get({ plain: true });
}
async function requireOwnedPractical(auth: AuthContext, id: string): Promise<CompetencePracticalInstrument> {
  const row = await CompetencePracticalInstrument.findByPk(id);
  if (!row) throw new NotFoundError("Practical not found", "PRACTICAL_NOT_FOUND");
  assertOwned(auth, row.orgId);
  return row;
}
export async function updatePracticalInstrument(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const row = await requireOwnedPractical(auth, id);
  if (input.name !== undefined) row.name = str(input.name) ?? row.name;
  if (input.passMark !== undefined) row.passMark = num(input.passMark);
  if (input.criteria !== undefined) row.criteria = (Array.isArray(input.criteria) ? input.criteria : []) as PracticalCriterion[];
  await row.save();
  await audit(auth, "competence.practical.updated", "CompetencePracticalInstrument", row.id, ip);
  return row.get({ plain: true });
}
export async function setPracticalStatus(auth: AuthContext, id: string, status: string, ip: string | null) {
  if (!INSTRUMENT_STATUS.includes(status as never)) throw new BadRequestError("Invalid status", "INVALID_STATUS");
  const row = await requireOwnedPractical(auth, id);
  if (status === "Published") {
    const err = validatePracticalPublish(row);
    if (err) throw new BadRequestError(err, "PRACTICAL_INVALID");
  }
  row.status = status;
  await row.save();
  await audit(auth, "competence.practical.status", "CompetencePracticalInstrument", row.id, ip);
  return row.get({ plain: true });
}
export async function deletePracticalInstrument(auth: AuthContext, id: string, ip: string | null) {
  const row = await requireOwnedPractical(auth, id);
  await row.destroy();
  await audit(auth, "competence.practical.deleted", "CompetencePracticalInstrument", id, ip);
}

// ---------------- Scoring ----------------
/** Auto-score a written exam (OD examFinalize 18148): single/multi/true-false from the
 * answer key; short-answer questions from assessor-awarded `grades` (0..points each). */
export function gradeExam(questions: ExamQuestion[], answers: Record<string, unknown>, grades: Record<string, number> = {}): { earned: number; total: number; score: number } {
  let earned = 0, total = 0;
  for (const q of questions) {
    total += q.points;
    const a = answers[q.id];
    if (q.type === "short") {
      earned += Math.max(0, Math.min(q.points, num(grades[q.id])));
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

// ---------------- Attempts (ladder-enforced, OD 17953 / 17367–17390) ----------------
/** Strict ladder: highest consecutive level passed by a recorded (non-preview) attempt. */
async function examAchievedLevel(auth: AuthContext, skillId: string, personId: string): Promise<number> {
  const ids = await visibleTenantOrgIds(auth);
  const scope: Record<string, unknown> = { skillId, personId, passed: true, preview: false };
  if (ids !== null) scope.orgId = { [Op.in]: ids.includes(auth.orgId) ? ids : [...ids, auth.orgId] };
  const exams = await CompetenceExamAttempt.findAll({ where: scope, attributes: ["level"] });
  const passedLevels = new Set(exams.map((e) => e.level));
  let achieved = 0;
  for (let l = 1; l <= 3; l++) { if (passedLevels.has(l)) achieved = l; else break; }
  return achieved;
}

const cleanGrades = (v: unknown): Record<string, number> | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, p] of Object.entries(v as Record<string, unknown>)) out[k] = num(p);
  return out;
};

export async function takeExam(auth: AuthContext, instrumentId: string, input: Record<string, unknown>, ip: string | null) {
  const inst = await CompetenceExamInstrument.findByPk(instrumentId);
  if (!inst) throw new NotFoundError("Exam not found", "EXAM_NOT_FOUND");
  await assertVisible(auth, inst.orgId);
  const personId = str(input.personId);
  if (!personId) throw new BadRequestError("Person is required", "PERSON_REQUIRED");
  const preview = input.preview === true;
  // Ladder enforcement (OD examNextLevel 17953): an exam at level N needs achieved level N-1.
  if (!preview) {
    const achieved = await examAchievedLevel(auth, inst.skillId, personId);
    if (inst.level > achieved + 1) {
      throw new BadRequestError(`L${inst.level} is locked — the candidate must pass the L${inst.level - 1} exam first.`, "LADDER_LOCKED");
    }
  }
  const answers = (input.answers && typeof input.answers === "object" ? input.answers : {}) as Record<string, unknown>;
  const grades = cleanGrades(input.grades);
  const hasShort = inst.questions.some((q) => q.type === "short");
  // Short answers need the assessor grading phase (OD examSubmitAnswers 18142): with no
  // grades supplied, a persisted attempt parks as PendingGrading; previews finalize at once.
  const pending = hasShort && grades === null && !preview;
  const { earned, total, score } = gradeExam(inst.questions, answers, grades ?? {});
  const passed = !pending && score >= inst.passMark;
  const result = {
    instrumentId, skillId: inst.skillId, level: inst.level, personId, personName: str(input.personName),
    score, earned, total, passed, preview, status: pending ? "PendingGrading" : "Completed",
    answers, grades: grades ?? {},
  };
  if (preview) return { ...result, id: null, takenAt: new Date().toISOString() };
  const row = await CompetenceExamAttempt.create({ orgId: auth.orgId, ...result });
  await audit(auth, "competence.exam.attempt", "CompetenceExamAttempt", row.id, ip);
  return row.get({ plain: true });
}

/** Assessor grading phase (OD extGradeHtml/examFinalize 18142–18164): award 0..points per
 * short-answer question of a PendingGrading attempt, then finalize the score. */
export async function gradeExamAttempt(auth: AuthContext, attemptId: string, input: Record<string, unknown>, ip: string | null) {
  const row = await CompetenceExamAttempt.findByPk(attemptId);
  if (!row) throw new NotFoundError("Attempt not found", "ATTEMPT_NOT_FOUND");
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(row.orgId) && row.orgId !== auth.orgId) throw new ForbiddenError();
  if (row.status !== "PendingGrading") throw new BadRequestError("This attempt is not awaiting grading", "NOT_PENDING");
  const inst = await CompetenceExamInstrument.findByPk(row.instrumentId);
  if (!inst) throw new NotFoundError("Exam not found", "EXAM_NOT_FOUND");
  const grades = cleanGrades(input.grades) ?? {};
  const { earned, total, score } = gradeExam(inst.questions, row.answers, grades);
  row.grades = grades;
  row.earned = earned;
  row.total = total;
  row.score = score;
  row.passed = score >= inst.passMark;
  row.status = "Completed";
  await row.save();
  await audit(auth, "competence.exam.attempt.graded", "CompetenceExamAttempt", row.id, ip);
  return row.get({ plain: true });
}

export async function runPractical(auth: AuthContext, instrumentId: string, input: Record<string, unknown>, ip: string | null) {
  const inst = await CompetencePracticalInstrument.findByPk(instrumentId);
  if (!inst) throw new NotFoundError("Practical not found", "PRACTICAL_NOT_FOUND");
  await assertVisible(auth, inst.orgId);
  const personId = str(input.personId);
  if (!personId) throw new BadRequestError("Person is required", "PERSON_REQUIRED");
  const preview = input.preview === true;
  // Ladder enforcement (OD assessRunPractical 17381): the L4 practical needs exam level 3.
  if (!preview && (await examAchievedLevel(auth, inst.skillId, personId)) < 3) {
    throw new BadRequestError("The candidate must pass the L3 written exam before the L4 practical.", "PRACTICAL_LOCKED");
  }
  const scores = (input.scores && typeof input.scores === "object" ? input.scores : {}) as Record<string, unknown>;
  const { earned, total, score } = gradePractical(inst.criteria, scores);
  const passed = score >= inst.passMark;
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
  // Next unlocked level requires a Published exam at that level (visible to this caller).
  let nextLevel = 0;
  if (achieved < 3) {
    const n = achieved + 1;
    const published = await CompetenceExamInstrument.findOne({ where: { ...(await orgClause(auth)), skillId, level: n, status: "Published" } });
    if (published) nextLevel = n;
  }
  return { skillId, personId, examAchievedLevel: achieved, practicalPassed, compInstrLevel, nextLevel };
}
