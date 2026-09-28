import { Op } from "sequelize";
import { z } from "zod";
import { AiGeneration, FrameworkRequirement, Fwrc } from "../../../db/models";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { getAssessment, getResults, listGaps, type AssessmentDetailView, type GapView } from "../../assessments/assessment.service";
import { ACTIONS } from "../../iam/actions.catalog";
import { createRecord } from "../../implementation/implementation.service";
import { MS_MODULES } from "../../implementation/registry";
import { createRisk } from "../../risks/risk.service";
import { citeList, truncateForPrompt } from "./context";
import { hasActionPermission } from "./runtime";
import { defineAction, defineFeature } from "./types";

/**
 * Gap Report + Certification Roadmap for a finalized gap assessment.
 *
 * POST /v1/ai/features/gap-report/generate { assessmentId } (job) →
 *   { executiveSummary, overallReadiness, clauses[], roadmap[], generationId }
 * POST /v1/ai/features/gap-report/create-drafts { assessmentId, generationId, actions[] } →
 *   { created: [{ title, module, id, code }], failed: [{ title, module, error }] }
 *
 * Readiness, the clause list and each clause's severity are computed here from
 * the stored answer scores; the model only writes the prose (summary, findings,
 * recommendations) and proposes the roadmap.
 */

// Same rubric as assessment.service: 0–9 maturity, below 5 is a gap.
const MAX_MATURITY = 9;
const GAP_THRESHOLD = 5;
const MAX_CLAUSES_IN_PROMPT = 40;
const STATEMENTS_PER_CLAUSE = 3;

/** Implementation registers a roadmap action may be drafted into (all take a bare title + description). */
export const DRAFT_MODULES = [
  "policies", "objectives", "risks", "improvements", "capa", "training", "awareness", "nonconformities",
] as const;
export type DraftModule = (typeof DRAFT_MODULES)[number];
const PHASES = ["30 days", "60 days", "90 days"] as const;

type Severity = "High" | "Medium" | "Low";
export function severityFor(score: number): Severity {
  if (score < 2) return "High";
  if (score < 4) return "Medium";
  return "Low";
}

/** Maturity (0–9) scaled to 0–100 and discounted by unanswered questions. */
export function computeReadiness(maturity: number | null, answered: number, total: number): number {
  if (maturity === null || total <= 0) return 0;
  const coverage = Math.min(answered / total, 1);
  return Math.max(0, Math.min(100, Math.round((maturity / MAX_MATURITY) * 100 * coverage)));
}

export interface FwrcRow { id: string; requirementId: string; questionId: string | null; responseId: string; statement: string }
export interface RequirementRow { id: string; code: string; subject: string }

export interface ClauseFacts {
  requirementCode: string;
  subject: string;
  score: number;
  severity: Severity;
  evidenceSources: string[];
  /** Prompt-only context: chosen answers and the matching FWRC statements. */
  answers: string[];
  statements: { id: string; text: string }[];
}

/**
 * Group the answered questions by the framework requirement their chosen
 * response maps to (via FWRC) and keep the requirements scoring below the gap
 * threshold, worst first. Falls back to the element-level gaps when the
 * assessment has no FWRC mapping (whole-library runs).
 */
export function buildClauses(detail: AssessmentDetailView, fwrcs: FwrcRow[], reqs: RequirementRow[], gaps: GapView[]): ClauseFacts[] {
  const reqById = new Map(reqs.map((r) => [r.id, r]));
  const answered = new Map<string, { questionText: string; responseText: string; score: number | null }>();
  for (const el of detail.elements) {
    for (const q of el.questions) {
      const r = q.responses.find((x) => x.id === q.answeredResponseId);
      if (r) answered.set(r.id, { questionText: q.text, responseText: r.text, score: r.score });
    }
  }
  const byReq = new Map<string, { scores: number[]; evidence: Set<string>; answers: Set<string>; statements: { id: string; text: string }[] }>();
  for (const f of fwrcs) {
    const a = answered.get(f.responseId);
    if (!a || !reqById.has(f.requirementId)) continue;
    const acc = byReq.get(f.requirementId) ?? { scores: [], evidence: new Set(), answers: new Set(), statements: [] };
    if (f.questionId && !acc.evidence.has(f.questionId)) {
      acc.evidence.add(f.questionId);
      if (a.score !== null) acc.scores.push(a.score);
      acc.answers.add(`${a.questionText} → ${a.responseText}`);
    }
    acc.evidence.add(f.id);
    if (acc.statements.length < STATEMENTS_PER_CLAUSE) acc.statements.push({ id: f.id, text: truncateForPrompt(f.statement, 240) });
    byReq.set(f.requirementId, acc);
  }
  const clauses: ClauseFacts[] = [];
  for (const [reqId, acc] of byReq) {
    if (acc.scores.length === 0) continue;
    const score = Math.round((acc.scores.reduce((s, x) => s + x, 0) / acc.scores.length) * 100) / 100;
    if (score >= GAP_THRESHOLD) continue;
    const req = reqById.get(reqId)!;
    clauses.push({
      requirementCode: req.code, subject: req.subject, score, severity: severityFor(score),
      evidenceSources: [...acc.evidence], answers: [...acc.answers], statements: acc.statements,
    });
  }
  if (clauses.length === 0 && fwrcs.length === 0) {
    for (const g of gaps) {
      const el = detail.elements.find((e) => e.elementId === g.elementId);
      clauses.push({
        requirementCode: g.elementName, subject: g.elementName, score: g.score, severity: g.severity,
        evidenceSources: el ? el.questions.filter((q) => q.answeredResponseId).map((q) => q.id) : [],
        answers: el ? el.questions.flatMap((q) => {
          const r = q.responses.find((x) => x.id === q.answeredResponseId);
          return r ? [`${q.text} → ${r.text}`] : [];
        }) : [],
        statements: [],
      });
    }
  }
  return clauses.sort((a, b) => a.score - b.score || a.requirementCode.localeCompare(b.requirementCode));
}

export function buildReportPrompt(input: {
  title: string; frameworkName: string | null; readiness: number; maturity: number | null;
  answered: number; total: number; clauses: ClauseFacts[]; gaps: GapView[];
}): string {
  const shown = input.clauses.slice(0, MAX_CLAUSES_IN_PROMPT);
  const clauseBlock = shown.map((c) => [
    `Clause ${c.requirementCode} — ${c.subject} (severity ${c.severity}, maturity ${c.score}/9)`,
    ...c.answers.slice(0, 4).map((a) => `  answer: ${truncateForPrompt(a, 300)}`),
    c.statements.length ? citeList(c.statements).split("\n").map((l) => `  ${l}`).join("\n") : null,
  ].filter(Boolean).join("\n")).join("\n\n");
  return [
    `Assessment: ${input.title}`,
    `Framework: ${input.frameworkName ?? "all elements"}`,
    `Overall readiness (computed): ${input.readiness}/100 — maturity ${input.maturity ?? "n/a"}/9, ${input.answered}/${input.total} questions answered.`,
    input.gaps.length
      ? `Element gaps: ${input.gaps.map((g) => `${g.elementName} (${g.severity}, ${g.score}/9, closes in ${g.recommendedModuleLabel})`).join("; ")}`
      : "Element gaps: none",
    input.clauses.length > shown.length ? `(${input.clauses.length - shown.length} further lower-severity clauses omitted.)` : null,
    "Clauses below target:",
    clauseBlock || "(none)",
    `Allowed module keys for roadmap actions: ${DRAFT_MODULES.join(", ")}.`,
  ].filter(Boolean).join("\n\n");
}

const modelSchema = z.object({
  executiveSummary: z.string(),
  clauses: z.array(z.object({ requirementCode: z.string(), finding: z.string(), recommendation: z.string() })),
  roadmap: z.array(z.object({
    phase: z.enum(PHASES),
    actions: z.array(z.object({
      title: z.string(),
      clauseRefs: z.array(z.string()),
      ownerRole: z.string(),
      module: z.enum(DRAFT_MODULES),
    })),
  })),
});
type ModelOut = z.infer<typeof modelSchema>;

export function mergeReport(clauses: ClauseFacts[], out: ModelOut) {
  const prose = new Map(out.clauses.map((c) => [c.requirementCode.trim(), c]));
  const codes = new Set(clauses.map((c) => c.requirementCode));
  return {
    executiveSummary: out.executiveSummary.trim(),
    clauses: clauses.map((c) => ({
      requirementCode: c.requirementCode, subject: c.subject, severity: c.severity,
      finding: prose.get(c.requirementCode)?.finding.trim() ?? "",
      evidenceSources: c.evidenceSources,
      recommendation: prose.get(c.requirementCode)?.recommendation.trim() ?? "",
    })),
    // One entry per phase, in order; clause refs limited to clauses in the report.
    roadmap: PHASES.map((phase) => ({
      phase,
      actions: out.roadmap.filter((p) => p.phase === phase).flatMap((p) => p.actions)
        .filter((a) => a.title.trim())
        .map((a) => ({ ...a, title: a.title.trim(), clauseRefs: a.clauseRefs.filter((r) => codes.has(r)) })),
    })),
  };
}

async function requireFinalized(auth: AuthContext, assessmentId: string): Promise<AssessmentDetailView> {
  const detail = await getAssessment(auth, assessmentId); // tenant-scoped; 404/403 otherwise
  if (detail.status !== "Completed") throw new BadRequestError("Finalize the assessment before generating a gap report", "ASSESSMENT_NOT_FINALIZED");
  return detail;
}

const generate = defineAction({
  permission: ACTIONS.ASSESSMENT_RUN_READ,
  mode: "job",
  input: z.object({ assessmentId: z.uuid() }),
  async run(ctx) {
    const { assessmentId } = ctx.input;
    const detail = await requireFinalized(ctx.auth, assessmentId);
    const [results, gaps] = await Promise.all([getResults(ctx.auth, assessmentId), listGaps(ctx.auth, assessmentId)]);
    const answeredIds = detail.elements.flatMap((e) => e.questions.map((q) => q.answeredResponseId)).filter((id): id is string => !!id);
    const fwrcs = answeredIds.length === 0 ? [] : await Fwrc.findAll({
      where: { responseId: { [Op.in]: answeredIds }, status: "Active", ...(detail.frameworkId ? { frameworkId: detail.frameworkId } : {}) },
      attributes: ["id", "requirementId", "questionId", "responseId", "statement"],
    });
    const reqs = fwrcs.length === 0 ? [] : await FrameworkRequirement.findAll({
      where: { id: { [Op.in]: [...new Set(fwrcs.map((f) => f.requirementId))] } },
      attributes: ["id", "code", "subject"],
    });
    await ctx.progress?.(1, 3);

    const clauses = buildClauses(detail, fwrcs, reqs, gaps);
    const overallReadiness = computeReadiness(results.maturityScore, results.answeredCount, results.questionCount);
    const { data, generationId } = await ctx.ai.json(modelSchema, {
      system:
        "You are a lead auditor preparing a certification-readiness gap report for a management-system standard. " +
        "Write an executiveSummary of 3–6 sentences for top management (readiness, main weaknesses, what certification needs). " +
        "For each listed clause (use its exact clause code as requirementCode) write a one- or two-sentence finding grounded in the answers, " +
        "citing statement ids like [id], and a concrete recommendation. Paraphrase — never quote long passages of standard text. " +
        "Then propose a 30/60/90-day roadmap: High-severity clauses first; 2–6 actions per phase; each action has a short imperative title, " +
        "the clause codes it addresses (clauseRefs), an ownerRole (a job role, not a person's name) and a module from the allowed module keys. " +
        "Do not state the readiness figure differently from the computed one.",
      user: buildReportPrompt({
        title: detail.title, frameworkName: detail.frameworkName, readiness: overallReadiness,
        maturity: results.maturityScore, answered: results.answeredCount, total: results.questionCount, clauses, gaps,
      }),
      maxTokens: 4000,
      target: { type: "assessment", id: assessmentId },
    });
    await ctx.progress?.(3, 3);
    return { ...mergeReport(clauses, data), overallReadiness, generationId };
  },
});

/** "Draft" where the register has it; otherwise the register's own create default (Open / Unassigned). */
function draftStatus(module: DraftModule): string | undefined {
  return MS_MODULES[module].statuses.includes("Draft") ? "Draft" : undefined;
}

const createDrafts = defineAction({
  permission: ACTIONS.ASSESSMENT_RUN_MANAGE,
  input: z.object({
    assessmentId: z.uuid(),
    generationId: z.uuid(),
    actions: z.array(z.object({
      title: z.string().trim().min(1).max(300),
      module: z.enum(DRAFT_MODULES),
      clauseRefs: z.array(z.string().max(120)).max(30).default([]),
    })).min(1).max(30),
  }),
  async run(ctx) {
    const { auth, input, ip } = ctx;
    if (!hasActionPermission(auth, ACTIONS.MS_MANAGE)) throw new ForbiddenError("You need permission to manage implementation records");
    const detail = await requireFinalized(auth, input.assessmentId);
    const gen = await AiGeneration.findOne({
      where: { id: input.generationId, orgId: auth.orgId, feature: "gap-report", targetId: detail.id },
    });
    if (!gen) throw new NotFoundError("Gap report not found for this assessment", "GENERATION_NOT_FOUND");

    const created: { title: string; module: DraftModule; id: string; code: string }[] = [];
    const failed: { title: string; module: DraftModule; error: string }[] = [];
    for (const a of input.actions) {
      const refs = a.clauseRefs.length ? ` Clauses: ${a.clauseRefs.join(", ")}.` : "";
      const description = `Drafted from the AI gap report for ${detail.code} (${detail.frameworkName ?? "all elements"}).${refs}`;
      try {
        // No AI call here: the user picked these actions; each goes through its register's own service.
        const rec = a.module === "risks"
          ? await createRisk(auth, { title: a.title, description }, ip)
          : await createRecord(auth, a.module, { title: a.title, status: draftStatus(a.module), data: { description } }, undefined, ip);
        created.push({ title: a.title, module: a.module, id: rec.id, code: rec.code });
      } catch (e) {
        failed.push({ title: a.title, module: a.module, error: e instanceof Error ? e.message : "Could not create the record" });
      }
    }
    return { created, failed, generationId: input.generationId };
  },
});

export default defineFeature({
  key: "gap-report",
  label: "Gap report",
  description: "Certification-readiness gap report and 30/60/90-day roadmap from a finalized gap assessment.",
  actions: { generate, "create-drafts": createDrafts },
});
