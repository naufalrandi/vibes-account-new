/**
 * OD compliance-engine seed — framework groups, the 9 OD frameworks, the full
 * requirement catalogues, the 27 canonical FWEs, the CQ/CQR library, OD's 6
 * requirement criteria, and the 3,940 FWRC rows fanned out from OD's 665
 * authored statement templates.
 *
 * Data modules (complianceEngine.*.data.ts) are GENERATED from the OD
 * prototype by evaluating OD's own seed code (fe-vibes-new-od/index.html:
 * 2241-4326) in Node and re-keying every row by natural keys — nothing is
 * hand-transcribed.
 *
 * Idempotency: every entity is upserted by a natural key —
 *   groups        by name
 *   frameworks    by name
 *   requirements  by (frameworkId, code)
 *   elements      by FWE code (update-by-position: names/descriptions are
 *                 REPLACED in place so ids stay stable for anything that
 *                 references them; name collisions are evicted first)
 *   questions     by CQ code (CQ-<elemNum>-NN)
 *   responses     by CQR code (<CQ code>-Rn)
 *   criteria      by (requirementId, score)
 *   fwrc          by FWRC code (FWRC-NNNN, positional in OD concat order)
 * Re-running converges existing rows to the OD content without duplicating.
 */
import {
  Assessment,
  ConformanceQuestion,
  ConformanceResponse,
  ElementRequirementXref,
  Framework,
  FrameworkAssignment,
  FrameworkElement,
  FrameworkGroup,
  FrameworkRequirement,
  Fwrc,
  RequirementCriterion,
} from "../models";
import { CE_CRITERIA, CE_FRAMEWORKS, CE_GROUPS, CE_REQUIREMENTS } from "./complianceEngine.frameworks.data";
import { CE_ELEMENTS, CE_QUESTIONS, CE_RESPONSES } from "./complianceEngine.elements.data";
import { CE_FWRC } from "./complianceEngine.fwrc.data";

const ISO27001 = "ISO/IEC 27001:2022";
const BULK_CHUNK = 500;

/** Entities the Phase 8/9 demo blocks in seed.ts need (demo glue, not OD parity). */
export interface ComplianceEngineHandles {
  iso27001: Framework;
  /** FWE-017 "Internal Audit". */
  auditEl: FrameworkElement;
  /** FWE-007 "Risk Management". */
  riskEl: FrameworkElement;
  /** Internal Audit's first maturity CQ (CQ-017-03) + its best response. */
  q1: ConformanceQuestion;
  q1r5: ConformanceResponse;
  /** Risk Management's first maturity CQ (CQ-007-04) + its worst response. */
  qRisk: ConformanceQuestion;
  qRiskR0: ConformanceResponse;
  /** Demo-bridge criterion: score 5 on ISO 27001 9.2.1 (not part of the OD set). */
  crit5: RequirementCriterion;
  /** OD criterion: score 0 on ISO 27001 6.1.2. */
  critR0: RequirementCriterion;
}

function fail(message: string): never {
  throw new Error(`[seedComplianceEngine] ${message}`);
}

/**
 * Converge rows left behind by the pre-OD seed so the upsert passes below
 * update them in place (ids stay stable) instead of duplicating:
 * - "GDPR 2016/679"       → renamed to OD's "GDPR"
 * - "ISO/IEC 27002:2022"  → not in OD's 9; removed when nothing references it
 * - ISO 27001 requirements "Clause 9.2.1"/"Clause 6.1.2" → OD codes "9.2.1"/"6.1.2"
 */
async function convergeLegacyRows(): Promise<void> {
  const legacyGdpr = await Framework.findOne({ where: { name: "GDPR 2016/679" } });
  if (legacyGdpr && !(await Framework.findOne({ where: { name: "GDPR" } }))) {
    legacyGdpr.name = "GDPR";
    await legacyGdpr.save();
  }

  const iso27002 = await Framework.findOne({ where: { name: "ISO/IEC 27002:2022" } });
  if (iso27002) {
    const referenced =
      (await FrameworkAssignment.count({ where: { frameworkId: iso27002.id } })) > 0 ||
      (await Assessment.count({ where: { frameworkId: iso27002.id } })) > 0;
    if (!referenced) {
      const reqs = await FrameworkRequirement.findAll({ where: { frameworkId: iso27002.id }, attributes: ["id"] });
      const reqIds = reqs.map((r) => r.id);
      if (reqIds.length) {
        await RequirementCriterion.destroy({ where: { requirementId: reqIds } });
        await ElementRequirementXref.destroy({ where: { requirementId: reqIds } });
        await FrameworkRequirement.destroy({ where: { id: reqIds } });
      }
      await iso27002.destroy();
    }
  }

  const iso27001 = await Framework.findOne({ where: { name: ISO27001 } });
  if (iso27001) {
    for (const [legacyCode, odCode] of [["Clause 9.2.1", "9.2.1"], ["Clause 6.1.2", "6.1.2"]] as const) {
      const legacy = await FrameworkRequirement.findOne({ where: { frameworkId: iso27001.id, code: legacyCode } });
      const target = await FrameworkRequirement.findOne({ where: { frameworkId: iso27001.id, code: odCode } });
      if (legacy && !target) {
        legacy.code = odCode;
        await legacy.save();
      }
    }
  }
}

async function seedGroups(): Promise<Map<string, FrameworkGroup>> {
  const groups = new Map<string, FrameworkGroup>();
  let sort = 0;
  for (const name of CE_GROUPS) {
    sort += 1;
    const [group] = await FrameworkGroup.findOrCreate({ where: { name }, defaults: { name, sortOrder: sort } });
    if (group.sortOrder !== sort) {
      group.sortOrder = sort;
      await group.save();
    }
    groups.set(name, group);
  }
  return groups;
}

async function seedFrameworks(groups: Map<string, FrameworkGroup>): Promise<Map<string, Framework>> {
  const frameworks = new Map<string, Framework>();
  for (const spec of CE_FRAMEWORKS) {
    const group = groups.get(spec.group) ?? fail(`unknown group ${spec.group}`);
    const [fw] = await Framework.findOrCreate({
      where: { name: spec.name },
      defaults: {
        name: spec.name, groupId: group.id, familyId: null, code: null, version: null, status: "Active",
        shortDescription: spec.description, fullDescription: null, jurisdictions: spec.jurisdictions, publishedDate: null,
      },
    });
    let dirty = false;
    if (fw.groupId !== group.id) { fw.groupId = group.id; dirty = true; }
    if (fw.status !== "Active") { fw.status = "Active"; dirty = true; }
    if (fw.shortDescription !== spec.description) { fw.shortDescription = spec.description; dirty = true; }
    if (JSON.stringify(fw.jurisdictions) !== JSON.stringify(spec.jurisdictions)) { fw.jurisdictions = spec.jurisdictions; dirty = true; }
    if (dirty) await fw.save();
    frameworks.set(spec.name, fw);
  }
  return frameworks;
}

/**
 * The 27 canonical FWEs, keyed by their stable FWE-NNN code. Wrong names from
 * the pre-OD seed are replaced in place (same row, same id). Any other row
 * already holding a target name is evicted to a suffixed name first so the
 * unique(name) constraint never trips mid-update.
 */
async function seedElements(): Promise<Map<string, FrameworkElement>> {
  const elements = new Map<string, FrameworkElement>();
  for (const spec of CE_ELEMENTS) {
    const row = await FrameworkElement.findOne({ where: { code: spec.code } });
    if (row && row.name !== spec.name) {
      const holder = await FrameworkElement.findOne({ where: { name: spec.name } });
      if (holder && holder.id !== row.id) {
        holder.name = `${spec.name} (legacy ${holder.id.slice(0, 8)})`;
        await holder.save();
      }
    }
    if (row) {
      let dirty = false;
      if (row.name !== spec.name) { row.name = spec.name; dirty = true; }
      if (row.description !== spec.description) { row.description = spec.description; dirty = true; }
      if (row.category !== spec.category) { row.category = spec.category; dirty = true; }
      if (row.status !== "Active") { row.status = "Active"; dirty = true; }
      if (dirty) await row.save();
      elements.set(spec.code, row);
    } else {
      elements.set(
        spec.code,
        await FrameworkElement.create({ code: spec.code, name: spec.name, description: spec.description, category: spec.category, status: "Active" }),
      );
    }
  }
  return elements;
}

async function seedRequirements(frameworks: Map<string, Framework>): Promise<Map<string, FrameworkRequirement>> {
  const fwIds = [...frameworks.values()].map((f) => f.id);
  const existing = await FrameworkRequirement.findAll({ where: { frameworkId: fwIds } });
  const byKey = new Map(existing.map((r) => [`${r.frameworkId}|${r.code}`, r]));
  const requirements = new Map<string, FrameworkRequirement>();
  const toCreate: Array<{ frameworkId: string; code: string; subject: string; description: string; type: string; shortLabel: null; status: "Active" }> = [];

  for (const spec of CE_REQUIREMENTS) {
    const fw = frameworks.get(spec.framework) ?? fail(`unknown framework ${spec.framework}`);
    const row = byKey.get(`${fw.id}|${spec.code}`);
    if (row) {
      let dirty = false;
      if (row.subject !== spec.subject) { row.subject = spec.subject; dirty = true; }
      if (row.description !== spec.description) { row.description = spec.description; dirty = true; }
      if (row.type !== spec.type) { row.type = spec.type; dirty = true; }
      if (row.status !== "Active") { row.status = "Active"; dirty = true; }
      if (dirty) await row.save();
      requirements.set(`${spec.framework}|${spec.code}`, row);
    } else {
      toCreate.push({ frameworkId: fw.id, code: spec.code, subject: spec.subject, description: spec.description, type: spec.type, shortLabel: null, status: "Active" });
    }
  }
  for (let i = 0; i < toCreate.length; i += BULK_CHUNK) {
    await FrameworkRequirement.bulkCreate(toCreate.slice(i, i + BULK_CHUNK));
  }
  if (toCreate.length) {
    const fresh = await FrameworkRequirement.findAll({ where: { frameworkId: fwIds } });
    const idByFw = new Map(fwIds.map((id) => [id, [...frameworks.values()].find((f) => f.id === id)?.name ?? ""]));
    for (const r of fresh) requirements.set(`${idByFw.get(r.frameworkId)}|${r.code}`, r);
  }
  return requirements;
}

async function seedQuestions(elements: Map<string, FrameworkElement>): Promise<Map<string, ConformanceQuestion>> {
  const existing = await ConformanceQuestion.findAll();
  const byCode = new Map(existing.filter((q) => q.code).map((q) => [q.code as string, q]));
  const questions = new Map<string, ConformanceQuestion>();
  for (const spec of CE_QUESTIONS) {
    const element = elements.get(spec.element) ?? fail(`unknown element ${spec.element}`);
    const row = byCode.get(spec.code);
    if (row) {
      let dirty = false;
      if (row.elementId !== element.id) { row.elementId = element.id; dirty = true; }
      if (row.title !== spec.title) { row.title = spec.title; dirty = true; }
      if (row.text !== spec.text) { row.text = spec.text; dirty = true; }
      if (row.category !== spec.category) { row.category = spec.category; dirty = true; }
      if (row.dimension !== spec.dimension) { row.dimension = spec.dimension; dirty = true; }
      if (row.sortOrder !== spec.order) { row.sortOrder = spec.order; dirty = true; }
      if (row.status !== "Active") { row.status = "Active"; dirty = true; }
      if (dirty) await row.save();
      questions.set(spec.code, row);
    } else {
      questions.set(
        spec.code,
        await ConformanceQuestion.create({
          elementId: element.id, code: spec.code, title: spec.title, text: spec.text,
          category: spec.category, dimension: spec.dimension, sortOrder: spec.order, status: "Active",
        }),
      );
    }
  }
  return questions;
}

async function seedResponses(questions: Map<string, ConformanceQuestion>): Promise<Map<string, ConformanceResponse>> {
  const existing = await ConformanceResponse.findAll();
  const byCode = new Map(existing.filter((r) => r.code).map((r) => [r.code as string, r]));
  const responses = new Map<string, ConformanceResponse>();
  for (const spec of CE_RESPONSES) {
    const question = questions.get(spec.question) ?? fail(`unknown question ${spec.question}`);
    const row = byCode.get(spec.code);
    if (row) {
      let dirty = false;
      if (row.questionId !== question.id) { row.questionId = question.id; dirty = true; }
      if (row.text !== spec.text) { row.text = spec.text; dirty = true; }
      if (row.sortOrder !== spec.order) { row.sortOrder = spec.order; dirty = true; }
      if (row.child !== spec.child) { row.child = spec.child; dirty = true; }
      if (row.status !== "Active") { row.status = "Active"; dirty = true; }
      if (dirty) await row.save();
      responses.set(spec.code, row);
    } else {
      responses.set(
        spec.code,
        await ConformanceResponse.create({
          questionId: question.id, code: spec.code, text: spec.text, sortOrder: spec.order,
          status: "Active", criterionId: null, child: spec.child,
        }),
      );
    }
  }
  return responses;
}

async function seedCriteria(requirements: Map<string, FrameworkRequirement>): Promise<void> {
  for (const spec of CE_CRITERIA) {
    const req = requirements.get(`${spec.framework}|${spec.requirement}`) ?? fail(`unknown requirement ${spec.framework} ${spec.requirement}`);
    const [row] = await RequirementCriterion.findOrCreate({
      where: { requirementId: req.id, score: spec.score },
      defaults: { requirementId: req.id, score: spec.score, description: spec.description },
    });
    if (row.description !== spec.description) {
      row.description = spec.description;
      await row.save();
    }
  }
}

async function seedFwrc(
  frameworks: Map<string, Framework>,
  requirements: Map<string, FrameworkRequirement>,
  questions: Map<string, ConformanceQuestion>,
  responses: Map<string, ConformanceResponse>,
): Promise<number> {
  const existing = await Fwrc.findAll();
  const byCode = new Map(existing.map((f) => [f.code, f]));
  const toCreate: Array<{
    code: string; frameworkId: string; requirementId: string; elementId: string;
    questionId: string; responseId: string; statement: string;
  }> = [];

  for (let i = 0; i < CE_FWRC.length; i += 1) {
    const [fwName, reqCode, respCode, statement] = CE_FWRC[i];
    const code = `FWRC-${String(i + 1).padStart(4, "0")}`;
    const fw = frameworks.get(fwName) ?? fail(`FWRC ${code}: unknown framework ${fwName}`);
    const req = requirements.get(`${fwName}|${reqCode}`) ?? fail(`FWRC ${code}: unknown requirement ${fwName} ${reqCode}`);
    const response = responses.get(respCode) ?? fail(`FWRC ${code}: unknown response ${respCode}`);
    const questionCode = respCode.replace(/-R\d+$/, "");
    const question = questions.get(questionCode) ?? fail(`FWRC ${code}: unknown question ${questionCode}`);

    const row = byCode.get(code);
    if (row) {
      let dirty = false;
      if (row.frameworkId !== fw.id) { row.frameworkId = fw.id; dirty = true; }
      if (row.requirementId !== req.id) { row.requirementId = req.id; dirty = true; }
      if (row.elementId !== question.elementId) { row.elementId = question.elementId; dirty = true; }
      if (row.questionId !== question.id) { row.questionId = question.id; dirty = true; }
      if (row.responseId !== response.id) { row.responseId = response.id; dirty = true; }
      if (row.statement !== statement) { row.statement = statement; dirty = true; }
      if (dirty) await row.save();
    } else {
      toCreate.push({
        code, frameworkId: fw.id, requirementId: req.id, elementId: question.elementId,
        questionId: question.id, responseId: response.id, statement,
      });
    }
  }
  for (let i = 0; i < toCreate.length; i += BULK_CHUNK) {
    await Fwrc.bulkCreate(toCreate.slice(i, i + BULK_CHUNK));
  }
  return toCreate.length;
}

export async function seedComplianceEngine(): Promise<ComplianceEngineHandles> {
  await convergeLegacyRows();

  const groups = await seedGroups();
  const frameworks = await seedFrameworks(groups);
  const elements = await seedElements();
  const requirements = await seedRequirements(frameworks);
  const questions = await seedQuestions(elements);
  const responses = await seedResponses(questions);
  await seedCriteria(requirements);
  const fwrcCreated = await seedFwrc(frameworks, requirements, questions, responses);

  // --- Demo bridge (BE-only, not OD content) --------------------------------
  // Phase 8 in seed.ts finalizes a demo assessment against ISO 27001 with one
  // "mature" (score 5) and one "ad hoc" (score 0) answer. OD's criteria only
  // cover scores 0-2, so a single score-5 criterion is added on ISO 27001
  // 9.2.1; every other handle points at OD-seeded content.
  const iso27001 = frameworks.get(ISO27001) ?? fail("ISO 27001 missing after seed");
  const req921 = requirements.get(`${ISO27001}|9.2.1`) ?? fail("ISO 27001 9.2.1 missing after seed");
  const req612 = requirements.get(`${ISO27001}|6.1.2`) ?? fail("ISO 27001 6.1.2 missing after seed");
  const [crit5] = await RequirementCriterion.findOrCreate({
    where: { requirementId: req921.id, score: 5 },
    defaults: { requirementId: req921.id, score: 5, description: "Audits are planned, documented and recurring." },
  });
  const critR0 =
    (await RequirementCriterion.findOne({ where: { requirementId: req612.id, score: 0 } })) ??
    fail("ISO 27001 6.1.2 score-0 criterion missing after seed");

  const handles: ComplianceEngineHandles = {
    iso27001,
    auditEl: elements.get("FWE-017") ?? fail("FWE-017 missing after seed"),
    riskEl: elements.get("FWE-007") ?? fail("FWE-007 missing after seed"),
    q1: questions.get("CQ-017-03") ?? fail("CQ-017-03 missing after seed"),
    q1r5: responses.get("CQ-017-03-R3") ?? fail("CQ-017-03-R3 missing after seed"),
    qRisk: questions.get("CQ-007-04") ?? fail("CQ-007-04 missing after seed"),
    qRiskR0: responses.get("CQ-007-04-R1") ?? fail("CQ-007-04-R1 missing after seed"),
    crit5,
    critR0,
  };

  // eslint-disable-next-line no-console
  console.log(
    `  Compliance engine: ${frameworks.size} frameworks, ${requirements.size} requirements, ` +
      `${elements.size} elements, ${questions.size} questions, ${responses.size} responses, ` +
      `${CE_FWRC.length} FWRC (${fwrcCreated} new)`,
  );
  return handles;
}
