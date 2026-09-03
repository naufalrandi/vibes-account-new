import fs from "fs";
import path from "path";
import {
  ImplementationRecord, CompetenceAssignment, CompetenceAssessment, CompetenceGap,
} from "../models";
import { HAMMER_TEAM, SP_TEAM, ensurePerson } from "./competenceRoles";

/**
 * Personnel/Competence tenant registers (SOF-322 gap, Personnel/Competence slice) — the OD
 * `db.aw*`/`db.trainingPlans`/`db.assessments`/`db.gaps` collections had no seeder, so the
 * Tenant Awareness workspace, Training Plan workspace, and Competence Assessments/Gaps
 * segments all rendered empty. `db.compTraining` (21 rows, the competence TRAINING CATALOG)
 * is NOT handled here — it's a *global* (org_id NULL) library row set already seeded lazily by
 * `ensureTrainingCatalogSeed()` (`competence.skillLibrarySeed.ts`, called from
 * `competence.service.ts`) and its 21 rows already match this dump 1:1 (names/sources).
 *
 * Source: `src/db/seeders/data/personnel/*.json`, verbatim dumps of the OD collections
 * (awTopics/awPrograms/awCampaigns/awAcks/awEvals/trainingPlans/assessments/gaps).
 *
 * Target mapping:
 *   awTopics (20)     -> ImplementationRecord module "awareness-topics"
 *   awPrograms (1)    -> ImplementationRecord module "awareness"
 *   awCampaigns (1)   -> ImplementationRecord module "awareness-campaigns"; awAcks (13) and
 *                        awEvals (13) are NOT separate registers — OD nests them under a
 *                        campaign's own `data.acks[]`/`data.evals[]` ledgers
 *                        (`lib/implementation/awareness.ts` `campaignData()`,
 *                        `AwarenessAcksTab`/`AwarenessEvalsTab` read them off `campaigns`, not
 *                        a standalone list), materialized here directly into the one seeded
 *                        campaign's `data`.
 *   trainingPlans (2) -> ImplementationRecord module "training"
 *   assessments (5)   -> CompetenceAssessment (competence.models.ts)
 *   gaps (1)          -> CompetenceGap (competence.models.ts)
 *
 * FK resolution (assessments/gaps): OD's `assignmentId`/`roleId` values in this dump are from a
 * different OD extraction run than `competenceRoles.ts`'s SHAPE_A dump (different id
 * generation), so they don't resolve directly against that seeder's `CompetenceAssignment`
 * rows. But the `personId` values (`idtu5`..`idtu8`, `axia1`) DO match `competenceRoles.ts`'s
 * `HAMMER_TEAM`/`SP_TEAM` roster, and `seedCompetenceRolesAndAssignments` gives each of those
 * people exactly one `CompetenceAssignment` — so this resolves the real assignment by
 * `(orgId, personId)` instead of trusting OD's own assignment/role ids, then uses that
 * assignment's own `roleId`. `seedCompetenceRolesAndAssignments` must run before this.
 *
 * Cross-links: `training` records link to their source gap/assessment by REAL id
 * (`TrainingDetailDrawer`'s `/competence?assessmentId=`/`?gapId=` links, `app/(app)/
 * competence/page.tsx`'s `assessments.find(x=>x.id===...)` / `gaps.find(...)` match on the
 * real row id, not OD's string id) — so OD's `gapId`/`assessmentId`/`sourceRecordId` fields are
 * remapped through the id maps built while seeding assessments/gaps, and conversely
 * `CompetenceGap.trainingPlanId` (`app/(app)/competence/forms.tsx`'s
 * `trainingPlans.find(t=>t.id===gap.trainingPlanId)`) is patched to the real training-plan id
 * once the training plan seed runs (chicken/egg: gap -> plan -> gap).
 *
 * Reported gap (no home): OD topic `quiz` rows use `{passMark, questions:[{text, options:[{text,
 * correct}]|answerTrue}]}` — the FE's `topicQuiz()`/`AwarenessQuiz` contract
 * (`lib/implementation/awareness.ts`) expects `{passPercent, questions:[{prompt, options:string[],
 * correctOption}]}`. A verbatim copy silently renders "Not configured" (every question fails
 * `topicQuiz`'s field-presence filter). This seeder reshapes the two affected topics' quizzes
 * into the FE contract (same content, renamed/restructured fields) rather than leaving that gap.
 * OD's per-record `activity[]`/`comments[]` arrays (topics/programs/campaigns/trainingPlans) ride
 * along in `data` for forward compatibility — same convention as `seedTenantSuppliers` — but have
 * no reader in the Awareness or Training Plan workspaces today.
 *
 * Idempotency: every register is keyed by a natural key already unique within the dump
 * (title for the three awareness modules, code for training plans, `(orgId, assignmentId)` for
 * assessments, `(orgId, assignmentId, reqKey)` for gaps) so re-running never duplicates rows,
 * and the OD-id -> real-id maps are rebuilt from whatever already exists on a partial rerun.
 */

const DATA_DIR = path.resolve(__dirname, "data/personnel");

function loadDump<T = Record<string, unknown>>(name: string): T[] {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), "utf8")) as T[];
}

/** Same date-defect guard as `israTenantDemo.ts`: OD emits `""` and full ISO timestamps into
 * fields that must be plain `YYYY-MM-DD` (or null) for a DATEONLY column. Postgres rejects both. */
const date = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const dateOnly = (v: unknown): string | null => {
  const d = date(v);
  return d ? d.toISOString().slice(0, 10) : null;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/** Resolves an OD `idtu*`/`axia*` person id to this backend's real `User.id`, creating the
 * roster row if `seedCompetenceRolesAndAssignments` hasn't (same natural key: email). */
async function resolvePerson(
  hammerTenantId: string, spOrgId: string, odId: string,
): Promise<{ id: string; fullName: string; orgId: string } | null> {
  const h = HAMMER_TEAM.find((p) => p.odId === odId);
  if (h) return { id: await ensurePerson(hammerTenantId, hammerTenantId, h.fullName, h.email, h.position), fullName: h.fullName, orgId: hammerTenantId };
  const s = SP_TEAM.find((p) => p.odId === odId);
  if (s) return { id: await ensurePerson(spOrgId, null, s.fullName, s.email, s.position), fullName: s.fullName, orgId: spOrgId };
  return null;
}

// ============================ Awareness ============================

interface RawQuizOption { id: string; text: string; correct?: boolean }
interface RawQuizQuestion { id: string; type: string; text: string; options?: RawQuizOption[]; answerTrue?: boolean }
interface RawQuiz { passMark: number; questions: RawQuizQuestion[] }

/** Reshapes OD's quiz dump into the `AwarenessQuiz` contract `topicQuiz()` (lib/implementation/
 * awareness.ts) actually reads — see header note. */
function transformQuiz(raw: unknown): Record<string, unknown> | undefined {
  const q = raw as RawQuiz | undefined;
  if (!q || !Array.isArray(q.questions) || q.questions.length === 0) return undefined;
  return {
    passPercent: q.passMark,
    questions: q.questions.map((question) => {
      if (question.type === "truefalse") {
        return { id: question.id, prompt: question.text, options: ["True", "False"], correctOption: question.answerTrue ? 0 : 1 };
      }
      const options = question.options ?? [];
      const correctOption = Math.max(0, options.findIndex((o) => o.correct === true));
      return { id: question.id, prompt: question.text, options: options.map((o) => o.text), correctOption };
    }),
  };
}

async function seedAwarenessTopics(orgId: string): Promise<Map<string, string>> {
  const rows = loadDump("awTopics");
  const existing = await ImplementationRecord.findAll({ where: { orgId, module: "awareness-topics" } });
  const byTitle = new Map(existing.map((e) => [e.title, e.id]));
  const map = new Map<string, string>();
  let created = 0;
  for (const row of rows) {
    let id = byTitle.get(str(row.title));
    if (!id) {
      const rec = await ImplementationRecord.create({
        orgId, module: "awareness-topics", code: str(row.id), title: str(row.title),
        status: str(row.status) || "Draft", owner: str(row.owner) || null, elementId: null,
        frameworks: Array.isArray(row.frameworks) ? row.frameworks : [],
        data: {
          category: row.category, description: row.description, materials: row.materials ?? [],
          quiz: transformQuiz(row.quiz), createdBy: row.createdBy, createdDate: row.createdDate,
          lastUpdatedBy: row.lastUpdatedBy, activity: row.activity ?? [], comments: row.comments ?? [],
        },
      });
      id = rec.id;
      created += 1;
    }
    map.set(str(row.id), id);
  }
  // eslint-disable-next-line no-console
  console.log(`  Awareness topics: ${created} created, ${map.size - created} already present.`);
  return map;
}

async function seedAwarenessPrograms(orgId: string): Promise<Map<string, string>> {
  const rows = loadDump("awPrograms");
  const existing = await ImplementationRecord.findAll({ where: { orgId, module: "awareness" } });
  const byTitle = new Map(existing.map((e) => [e.title, e.id]));
  const map = new Map<string, string>();
  let created = 0;
  for (const row of rows) {
    let id = byTitle.get(str(row.name));
    if (!id) {
      const rec = await ImplementationRecord.create({
        orgId, module: "awareness", code: str(row.id), title: str(row.name),
        status: str(row.status) || "Draft", owner: str(row.owner) || null, elementId: null,
        frameworks: Array.isArray(row.frameworks) ? row.frameworks : [],
        data: {
          period: row.period, objective: row.objective, notes: row.notes,
          createdBy: row.createdBy, createdDate: row.createdDate, lastUpdatedBy: row.lastUpdatedBy,
          activity: row.activity ?? [], comments: row.comments ?? [],
        },
      });
      id = rec.id;
      created += 1;
    }
    map.set(str(row.id), id);
  }
  // eslint-disable-next-line no-console
  console.log(`  Awareness programs: ${created} created, ${map.size - created} already present.`);
  return map;
}

async function seedAwarenessCampaigns(
  orgId: string, topicIdMap: Map<string, string>, programIdMap: Map<string, string>,
  hammerTenantId: string, spOrgId: string,
): Promise<void> {
  const rows = loadDump("awCampaigns");
  const already = await ImplementationRecord.count({ where: { orgId, module: "awareness-campaigns" } });
  if (already > 0) {
    // eslint-disable-next-line no-console
    console.log(`  Awareness campaigns: ${already} already present, skipping.`);
    return;
  }

  const allAcks = loadDump<Record<string, unknown>>("awAcks");
  const allEvals = loadDump<Record<string, unknown>>("awEvals");

  let created = 0;
  for (const row of rows) {
    const campaignOdId = str(row.id);
    const acks = allAcks.filter((a) => a.campaignId === campaignOdId);
    const evals = allEvals.filter((e) => e.campaignId === campaignOdId);

    const acksOut = [];
    for (const a of acks) {
      const member = await resolvePerson(hammerTenantId, spOrgId, str(a.memberId));
      acksOut.push({
        id: a.id, memberId: member?.id ?? a.memberId, memberName: a.memberName,
        topicId: topicIdMap.get(str(a.topicId)) ?? a.topicId, materialId: a.materialId,
        due: a.due, statement: a.statement, status: a.status, ackDate: a.ackDate,
        reminderDate: a.reminderDate, waiverReason: a.waiverReason, waivedBy: a.waivedBy, waivedDate: a.waivedDate,
      });
    }
    const evalsOut = [];
    for (const e of evals) {
      const member = await resolvePerson(hammerTenantId, spOrgId, str(e.memberId));
      evalsOut.push({
        id: e.id, memberId: member?.id ?? e.memberId, memberName: e.memberName,
        topicId: topicIdMap.get(str(e.topicId)) ?? e.topicId, method: e.method, result: e.result,
        score: e.score, evaluator: e.evaluator, evalDate: e.evalDate,
        followupRequired: e.followupRequired, followupActionId: e.followupActionId, notes: e.notes,
      });
    }

    await ImplementationRecord.create({
      orgId, module: "awareness-campaigns", code: campaignOdId, title: str(row.title),
      status: str(row.status) || "Draft", owner: str(row.owner) || null, elementId: null, frameworks: [],
      data: {
        programId: programIdMap.get(str(row.programId)) ?? row.programId,
        topics: (Array.isArray(row.topics) ? row.topics : []).map((t) => topicIdMap.get(String(t)) ?? t),
        focus: row.focus ?? [], audience: row.audience, message: row.message,
        delivery: row.delivery ?? [], startDate: row.startDate, dueDate: row.due,
        ackRequired: row.ackRequired, evalRequired: row.evalRequired, evalMethod: row.evalMethod ?? [],
        acks: acksOut, evals: evalsOut, followups: [],
        createdBy: row.createdBy, createdDate: row.createdDate, lastUpdatedBy: row.lastUpdatedBy,
        activity: row.activity ?? [], comments: row.comments ?? [],
      },
    });
    created += 1;
  }
  // eslint-disable-next-line no-console
  console.log(`  Awareness campaigns: ${created} created (${loadDump("awAcks").length} acks, ${loadDump("awEvals").length} evals embedded).`);
}

export async function seedAwareness(hammerTenantId: string, spOrgId: string): Promise<void> {
  const topicIdMap = await seedAwarenessTopics(hammerTenantId);
  const programIdMap = await seedAwarenessPrograms(hammerTenantId);
  await seedAwarenessCampaigns(hammerTenantId, topicIdMap, programIdMap, hammerTenantId, spOrgId);
}

// ============================ Competence assessments / gaps ============================

/** Local twin of `competence.assessment.service.ts`'s private `nextCode` (not exported) —
 * global-across-orgs sequential code per prefix, same convention. */
async function nextCompCode(model: { findAll: (opts: { attributes: string[] }) => Promise<{ get: (k: string) => unknown }[]> }, prefix: string): Promise<string> {
  const rows = await model.findAll({ attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(String(r.get("code")).replace(`${prefix}-`, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

interface AssessmentIds { assessmentIdMap: Map<string, string>; gapIdMap: Map<string, string> }

export async function seedCompetenceAssessmentsAndGaps(hammerTenantId: string, spOrgId: string): Promise<AssessmentIds> {
  const assessmentIdMap = new Map<string, string>();
  const gapIdMap = new Map<string, string>();

  const assessmentRows = loadDump("assessments");
  let assessCreated = 0;
  let assessSkipped = 0;
  for (const row of assessmentRows) {
    const org = row.tenantId === "__ENT__" ? spOrgId : hammerTenantId;
    const person = await resolvePerson(hammerTenantId, spOrgId, str(row.personId));
    if (!person) { assessSkipped += 1; continue; }
    const assignment = await CompetenceAssignment.findOne({ where: { orgId: org, personId: person.id } });
    if (!assignment) { assessSkipped += 1; continue; }

    const [rec, wasCreated] = await CompetenceAssessment.findOrCreate({
      where: { orgId: org, assignmentId: assignment.id },
      defaults: {
        orgId: org, code: await nextCompCode(CompetenceAssessment, "CA"), assignmentId: assignment.id,
        personId: person.id, roleId: assignment.roleId, assessor: str(row.assessor) || null,
        date: dateOnly(row.date), notes: str(row.notes) || null, requirements: arr(row.requirements) as never,
        score: Number(row.score) || 0, openGaps: Number(row.openGaps) || 0,
        status: str(row.status) || "Not yet competent", validUntil: dateOnly(row.validUntil),
        approvalState: str(row.approvalState) || "Pending", approvedBy: str(row.approvedBy) || null,
        approvedDate: dateOnly(row.approvedDate), activity: arr(row.activity) as never, comments: arr(row.comments) as never,
      },
    });
    if (wasCreated) {
      assessCreated += 1;
      assignment.latestAssessmentId = rec.id;
      assignment.latestStatus = rec.status;
      assignment.latestDate = rec.date;
      assignment.validUntil = rec.validUntil;
      await assignment.save();
    }
    assessmentIdMap.set(str(row.id), rec.id);
  }
  // eslint-disable-next-line no-console
  console.log(`  Competence assessments: ${assessCreated} created, ${assessSkipped} skipped (no matching assignment).`);

  const gapRows = loadDump("gaps");
  let gapCreated = 0;
  let gapSkipped = 0;
  for (const row of gapRows) {
    const org = row.tenantId === "__ENT__" ? spOrgId : hammerTenantId;
    const person = await resolvePerson(hammerTenantId, spOrgId, str(row.personId));
    if (!person) { gapSkipped += 1; continue; }
    const assignment = await CompetenceAssignment.findOne({ where: { orgId: org, personId: person.id } });
    if (!assignment) { gapSkipped += 1; continue; }

    const [rec] = await CompetenceGap.findOrCreate({
      where: { orgId: org, assignmentId: assignment.id, reqKey: str(row.reqKey) },
      defaults: {
        orgId: org, code: await nextCompCode(CompetenceGap, "GAP"),
        assessmentId: assessmentIdMap.get(str(row.assessmentId)) ?? null, assignmentId: assignment.id,
        personId: person.id, roleId: assignment.roleId, reqKey: str(row.reqKey), reqLabel: str(row.reqLabel) || null,
        kind: str(row.kind) || null, evalType: str(row.evalType) || null,
        currentLevel: Number(row.currentLevel) || 0, requiredLevel: Number(row.requiredLevel) || 0,
        severity: str(row.severity) || "partial", action: str(row.action) || null, owner: str(row.owner) || null,
        due: dateOnly(row.due), training: str(row.training) || null, trainingDone: false, trainingDate: null,
        status: str(row.status) || "Open", resolvedDate: dateOnly(row.resolvedDate), resolvedBy: str(row.resolvedBy) || null,
        createdDate: dateOnly(row.createdDate), trainingPlanId: null, noTraining: false, noTrainingReason: null,
        reassessResult: null, reviewedBy: null, reviewedDate: null,
      },
    });
    gapCreated += 1;
    gapIdMap.set(str(row.id), rec.id);
  }
  // eslint-disable-next-line no-console
  console.log(`  Competence gaps: ${gapCreated} created/present, ${gapSkipped} skipped (no matching assignment).`);

  return { assessmentIdMap, gapIdMap };
}

// ============================ Training plans ============================

export async function seedTrainingPlans(
  hammerTenantId: string, spOrgId: string, assessmentIdMap: Map<string, string>, gapIdMap: Map<string, string>,
): Promise<void> {
  const rows = loadDump("trainingPlans");
  const existing = await ImplementationRecord.findAll({ where: { orgId: hammerTenantId, module: "training" } });
  const byCode = new Map(existing.map((e) => [e.code, e.id]));

  let created = 0;
  for (const row of rows) {
    const code = str(row.id);
    if (byCode.has(code)) continue;

    let memberId: string | null = null;
    let roleId: string | null = null;
    if (str(row.memberId)) {
      const person = await resolvePerson(hammerTenantId, spOrgId, str(row.memberId));
      if (person) {
        memberId = person.id;
        const assignment = await CompetenceAssignment.findOne({ where: { orgId: person.orgId, personId: person.id } });
        roleId = assignment?.roleId ?? null;
      }
    }

    const rec = await ImplementationRecord.create({
      orgId: hammerTenantId, module: "training", code, title: str(row.title),
      status: str(row.status) || "Draft", owner: str(row.owner) || null, elementId: null, frameworks: [],
      data: {
        source: row.source, gapId: gapIdMap.get(str(row.gapId)) ?? row.gapId,
        assignmentId: row.assignmentId, assessmentId: assessmentIdMap.get(str(row.assessmentId)) ?? row.assessmentId,
        sourceRecordId: assessmentIdMap.get(str(row.sourceRecordId)) ?? row.sourceRecordId,
        memberId: memberId ?? row.memberId, memberName: row.memberName, audience: row.audience ?? [],
        roleId: roleId ?? row.roleId, roleName: row.roleName, reqId: row.reqId, reqTitle: row.reqTitle,
        gapDescription: row.gapDescription, description: row.description, type: row.type, delivery: row.delivery,
        provider: row.provider, due: row.due, priority: row.priority, reassessRequired: row.reassessRequired,
        reassessDue: row.reassessDue, notes: row.notes, completionDate: row.completionDate,
        completedBy: row.completedBy ?? [], completionEvidence: row.completionEvidence,
        completionNotes: row.completionNotes, completionResult: row.completionResult,
        reassessResult: row.reassessResult, linkedReassessId: row.linkedReassessId,
        lastUpdatedBy: row.lastUpdatedBy, createdBy: row.createdBy, createdDate: row.createdDate,
        activity: row.activity ?? [], comments: row.comments ?? [],
      },
    });
    created += 1;

    // Chicken/egg close-out: the gap this plan was raised from points forward to the plan's
    // real id (`CompetenceGap.trainingPlanId`, read by `app/(app)/competence/forms.tsx`).
    const realGapId = gapIdMap.get(str(row.gapId));
    if (realGapId) {
      const gap = await CompetenceGap.findByPk(realGapId);
      if (gap && !gap.trainingPlanId) { gap.trainingPlanId = rec.id; await gap.save(); }
    }
  }
  // eslint-disable-next-line no-console
  console.log(`  Training plans: ${created} created, ${existing.length} already present.`);
}
