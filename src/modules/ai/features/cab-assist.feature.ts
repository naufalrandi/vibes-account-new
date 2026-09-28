import { z } from "zod";
import { ACTIONS } from "../../iam/actions.catalog";
import { getBusiness, listBusiness, OPERATING_COMPANIES, type BusinessRecordView } from "../../business/business.service";
import {
  CAB_PHASES, RECOMMENDATIONS, cabFindings, cabReportContext, enforceRecommendation, impartialityContext,
  matchRelatedWork, openMajorCount,
} from "./cab-assist.context";
import { defineAction, defineFeature } from "./types";

/**
 * Exelera certification body (ISO/IEC 17021-1) assistant over `exelera/ex-cab` records.
 * Drafts only: the certification decision, `canIssueCertificate` and man-day math stay
 * deterministic and untouched; the client saves the (edited) report through the normal
 * ex-cab update.
 *
 * `pcb-exam-items` is intentionally not implemented: the PCB exam register (`pcb-exams`) is
 * still an OD scaffold (no field contract, hidden in the nav) with no item-development screen.
 */

const PERMISSION_READ = [ACTIONS.BUSINESS_READ, ACTIONS.BUSINESS_MANAGE];

const loadCab = (ctx: { auth: Parameters<typeof getBusiness>[0] }, id: string) => getBusiness(ctx.auth, "exelera", "ex-cab", id);

const reportSchema = z.object({
  executiveSummary: z.string(),
  scopeStatement: z.string(),
  methodology: z.string(),
  findingsNarrative: z.array(z.object({ findingId: z.string(), narrative: z.string() })),
  conformityConclusion: z.string(),
  recommendationToCommittee: z.enum(RECOMMENDATIONS),
  recommendationRationale: z.string(),
});

const auditReport = defineAction({
  permission: PERMISSION_READ,
  input: z.object({ cabRecordId: z.uuid(), phase: z.enum(CAB_PHASES).optional() }),
  async run(ctx) {
    const record = await loadCab(ctx, ctx.input.cabRecordId);
    const findings = cabFindings(record);
    const majors = openMajorCount(findings);
    const { data, generationId } = await ctx.ai.json(reportSchema, {
      system:
        "You are an ISO/IEC 17021-1 lead auditor drafting a certification audit report (§9.4.8) for the certification committee. " +
        'Write "executiveSummary", "scopeStatement" (the certification scope, standards and sites exactly as stored), ' +
        '"methodology" (audit type, sampling, man-days only as given in the data), one "findingsNarrative" entry per stored finding ' +
        '(use its id as "findingId", state grade, clause and status; never add findings), "conformityConclusion", and a ' +
        '"recommendationToCommittee" ("recommend" | "recommend with conditions" | "do not recommend") with "recommendationRationale". ' +
        "The recommendation is only a suggestion; the committee decides. " +
        (majors > 0
          ? `There are ${majors} OPEN major nonconformities: you must NOT recommend certification — the recommendation is "do not recommend" until they are closed and verified.`
          : "Recommend with conditions when minor nonconformities remain open."),
      user: cabReportContext(record, ctx.input.phase),
      maxTokens: 3000,
      target: { type: "ex-cab", id: record.id },
    });
    const ids = new Set(findings.map((f) => f.id));
    return {
      ...data,
      findingsNarrative: data.findingsNarrative.filter((n) => ids.has(n.findingId)),
      recommendationToCommittee: enforceRecommendation(data.recommendationToCommittee, findings),
      openMajorNonconformities: majors,
      generationId,
    };
  },
});

const THREATS = ["self-interest", "self-review", "familiarity", "intimidation", "advocacy"] as const;

/** Group companies' consultancy/service records for the client (§5.2 — consultancy is a self-review threat). */
async function relatedWorkFor(ctx: { auth: Parameters<typeof listBusiness>[0] }, record: BusinessRecordView) {
  const lists = await Promise.all(
    OPERATING_COMPANIES.flatMap((co) => ["ent-projects", "ent-svc-contracts"].map((m) => listBusiness(ctx.auth, "enterprise", m, co))),
  );
  return matchRelatedWork(record, lists.flatMap((l) => l.rows));
}

const impartialityAnalysis = defineAction({
  permission: PERMISSION_READ,
  // `clientId` is accepted as an alias: a CAB client IS its ex-cab record.
  input: z
    .object({ cabRecordId: z.uuid().optional(), clientId: z.uuid().optional() })
    .refine((i) => !!(i.cabRecordId ?? i.clientId), "Give cabRecordId or clientId"),
  async run(ctx) {
    const record = await loadCab(ctx, (ctx.input.cabRecordId ?? ctx.input.clientId)!);
    const related = await relatedWorkFor(ctx, record);
    const { data, generationId } = await ctx.ai.json(
      z.object({
        threats: z.array(z.object({
          type: z.enum(THREATS),
          description: z.string(),
          severity: z.enum(["low", "medium", "high"]),
          mitigation: z.string(),
          sourceIds: z.array(z.string()),
        })),
        summary: z.string(),
        missingInformation: z.array(z.string()),
      }),
      {
        system:
          "You are the impartiality function of an ISO/IEC 17021-1 certification body (§5.2). Identify threats to impartiality " +
          `(${THREATS.join(", ")}) for this certification client using ONLY the relationships given: auditor assignments across cycles ` +
          "(familiarity when the same auditor keeps auditing the client), and consultancy/service work by group companies (self-review / " +
          "self-interest; §5.2.5–5.2.7). For each threat give a concrete mitigation (e.g. auditor rotation, exclusion of consultants from " +
          "the audit team, two-year cooling-off, independent decision maker, impartiality committee review) and cite the source ids it " +
          'rests on. Do not invent relationships; if there is nothing to support a threat, leave it out and list in "missingInformation" ' +
          "what should be checked (e.g. auditor declarations of interest).",
        user: impartialityContext(record, related),
        maxTokens: 2000,
        target: { type: "ex-cab", id: record.id },
      },
    );
    return {
      ...data,
      relatedWork: related.map((r) => ({ id: r.id, code: r.code, title: r.title, module: r.module })),
      generationId,
    };
  },
});

export default defineFeature({
  key: "cab-assist",
  label: "Certification body assistant",
  description: "Drafts certification audit reports and analyses threats to impartiality for Exelera CAB clients.",
  actions: { "audit-report": auditReport, "impartiality-analysis": impartialityAnalysis },
});
