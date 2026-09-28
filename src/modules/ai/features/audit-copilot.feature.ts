import { Op } from "sequelize";
import { z } from "zod";
import { FrameworkRequirement, Fwrc } from "../../../db/models";
import { IA_FIND_TYPES } from "../../../db/models/internalAudit.models";
import { NotFoundError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { ACTIONS } from "../../iam/actions.catalog";
import { listRecords } from "../../implementation/implementation.service";
import { listFindings, listPrograms, listReports, listSessions } from "../../internal-audit/internalAudit.service";
import {
  clauseBlock, keepKnownClauses, processBlock, reportContext, sessionBlock, type ReqLike,
} from "./auditCopilot.context";
import { redactPii, truncateForPrompt } from "./context";
import { defineAction, defineFeature } from "./types";

/**
 * Internal audit copilot. Drafts only — nothing is saved here:
 * - checklist:          audit questions per clause of a session (criteriaReqs + FWRC + process).
 * - finding-from-notes: a finding draft from the auditor's notes; the auditor decides the type.
 * - report:             summary / conclusion / strengths / improvement areas from the real findings.
 */

const PERMISSION = ACTIONS.IAUDIT_MANAGE;

async function loadSession(auth: AuthContext, sessionId: string) {
  // Org-scoped list; the id is trusted only once found in it.
  const session = (await listSessions(auth)).find((s) => s.id === sessionId);
  if (!session) throw new NotFoundError("Session not found", "SESSION_NOT_FOUND");
  return session;
}

/** Clause library rows are shared reference data (not tenant data). */
async function loadClauses(reqIds: string[]): Promise<{ reqs: ReqLike[]; fwrc: Map<string, string[]> }> {
  if (reqIds.length === 0) return { reqs: [], fwrc: new Map() };
  const rows = await FrameworkRequirement.findAll({ where: { id: { [Op.in]: reqIds } }, order: [["code", "ASC"]] });
  const statements = await Fwrc.findAll({ where: { requirementId: { [Op.in]: reqIds }, status: "Active" }, order: [["code", "ASC"]] });
  const fwrc = new Map<string, string[]>();
  for (const s of statements) fwrc.set(s.requirementId, [...(fwrc.get(s.requirementId) ?? []), s.statement]);
  return { reqs: rows.map((r) => ({ id: r.id, code: r.code, subject: r.subject, description: r.description })), fwrc };
}

async function sessionContext(auth: AuthContext, sessionId: string) {
  const session = await loadSession(auth, sessionId);
  const [{ reqs, fwrc }, processes] = await Promise.all([
    loadClauses(session.criteriaReqs ?? []),
    listRecords(auth, "processes", { orgId: session.orgId }),
  ]);
  const process = processes.find((p) => p.title === session.process || p.code === session.process || p.data?.name === session.process);
  return { session, reqs, fwrc, process };
}

const checklistSchema = z.object({
  items: z.array(z.object({ clauseRef: z.string(), question: z.string(), evidenceToSeek: z.string() })),
});

const checklist = defineAction({
  permission: PERMISSION,
  input: z.object({ sessionId: z.uuid() }),
  async run(ctx) {
    const { session, reqs, fwrc, process } = await sessionContext(ctx.auth, ctx.input.sessionId);
    const { data, generationId } = await ctx.ai.json(checklistSchema, {
      system:
        "You are an experienced ISO internal auditor preparing an audit checklist for one audit session. " +
        "For each clause listed, write 2-4 practical audit questions for this process and, for each, the objective evidence to seek (records, documents, interviews, observations). " +
        "Set `clauseRef` to the clause id exactly as given in square brackets; use \"General\" for process-level questions not tied to a listed clause. " +
        "Use the criteria statements to decide what good looks like. Do not reference clauses that are not listed.",
      user: `${sessionBlock(session)}\n\n${processBlock(process)}\n\nClauses:\n${clauseBlock(reqs, fwrc)}`,
      maxTokens: 4000,
      target: { type: "ia_session", id: session.id },
    });
    const known = new Set(reqs.map((r) => r.code));
    const items = data.items
      .filter((i) => i.question.trim())
      .map((i) => ({ clauseRef: known.has(i.clauseRef) ? i.clauseRef : "General", question: i.question.trim(), evidenceToSeek: i.evidenceToSeek.trim() }));
    return { items, generationId };
  },
});

const findingSchema = z.object({
  title: z.string(),
  type: z.string(),
  description: z.string(),
  evidence: z.string(),
  criteria: z.string(),
  clauseRefs: z.array(z.string()).default([]),
  suggestedSeverityRationale: z.string(),
});

const findingFromNotes = defineAction({
  permission: PERMISSION,
  input: z.object({ sessionId: z.uuid(), notes: z.string().trim().min(1).max(8000) }),
  async run(ctx) {
    const { session, reqs, fwrc } = await sessionContext(ctx.auth, ctx.input.sessionId);
    const { data, generationId } = await ctx.ai.json(findingSchema, {
      system:
        "You help an ISO internal auditor write up one audit finding from their raw notes. " +
        `Suggest \`type\` as one of: ${IA_FIND_TYPES.join(", ")} — the auditor makes the final call. ` +
        "`title`: short. `description`: the finding statement (what was found vs. what the requirement expects). " +
        "`evidence`: only the objective evidence stated in the notes (records, samples, interviews). `criteria`: the requirement the finding is raised against, in words. " +
        "`clauseRefs`: ids of the listed clauses it relates to, exactly as given. `suggestedSeverityRationale`: 1-2 sentences on why this type fits. " +
        "Use only facts from the notes; never invent evidence.",
      user: `${sessionBlock(session)}\n\nClauses:\n${clauseBlock(reqs, fwrc)}\n\nAuditor notes:\n${truncateForPrompt(redactPii(ctx.input.notes), 8000)}`,
      maxTokens: 1500,
      target: { type: "ia_session", id: session.id },
    });
    const clauseRefs = keepKnownClauses(data.clauseRefs, reqs);
    return {
      title: data.title.trim(),
      type: (IA_FIND_TYPES as readonly string[]).includes(data.type) ? data.type : null,
      description: data.description.trim(),
      evidence: data.evidence.trim(),
      criteria: data.criteria.trim(),
      clauseRefs,
      criteriaReqs: reqs.filter((r) => clauseRefs.includes(r.code)).map((r) => r.id),
      process: session.process,
      suggestedSeverityRationale: data.suggestedSeverityRationale.trim(),
      generationId,
    };
  },
});

const reportSchema = z.object({
  summary: z.string(),
  conclusion: z.string(),
  strengths: z.array(z.string()).default([]),
  improvementAreas: z.array(z.string()).default([]),
});

const report = defineAction({
  permission: PERMISSION,
  input: z.object({ reportId: z.uuid() }),
  async run(ctx) {
    const rep = (await listReports(ctx.auth)).find((r) => r.id === ctx.input.reportId);
    if (!rep) throw new NotFoundError("Report not found", "REPORT_NOT_FOUND");
    const [programs, sessions, findings] = await Promise.all([
      listPrograms(ctx.auth, rep.orgId), listSessions(ctx.auth, rep.orgId), listFindings(ctx.auth, rep.orgId),
    ]);
    const program = programs.find((p) => p.id === rep.programId);
    if (!program) throw new NotFoundError("Program not found", "PROGRAM_NOT_FOUND");
    const progSessions = sessions.filter((s) => s.programId === rep.programId);
    const progFindings = findings.filter((f) => f.programId === rep.programId);
    const { data, generationId } = await ctx.ai.json(reportSchema, {
      system:
        "You draft the summary and conclusion of an ISO internal audit report from the programme's actual sessions and findings. " +
        "`summary`: what was audited and what was found, with the counts given (cite ids). `conclusion`: an evidence-based statement on the effectiveness of the management system — " +
        "if there are open nonconformities, say so; do not claim full effectiveness the findings do not support. " +
        "`strengths`: positives supported by Positive Finding / Conformity findings or sessions without findings. `improvementAreas`: from Nonconformity / Observation / Opportunity for Improvement findings. " +
        "If no sessions or findings are recorded, say the evidence is insufficient.",
      user: reportContext(program, progSessions, progFindings),
      maxTokens: 2000,
      target: { type: "ia_report", id: rep.id },
    });
    return {
      summary: data.summary.trim(),
      conclusion: data.conclusion.trim(),
      strengths: data.strengths.map((s) => s.trim()).filter(Boolean),
      improvementAreas: data.improvementAreas.map((s) => s.trim()).filter(Boolean),
      findingsCount: progFindings.length,
      sessionsCount: progSessions.length,
      generationId,
    };
  },
});

export default defineFeature({
  key: "audit-copilot",
  label: "Internal audit copilot",
  description: "Drafts session checklists, findings from auditor notes, and report summaries from the actual findings.",
  actions: { checklist, "finding-from-notes": findingFromNotes, report },
});
