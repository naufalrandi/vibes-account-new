import { z } from "zod";
import { BadRequestError, NotFoundError } from "../../../lib/errors";
import { ACTIONS } from "../../iam/actions.catalog";
import { listRecords, type RecordView } from "../../implementation/implementation.service";
import { redactPii, truncateForPrompt } from "./context";
import { d, findSimilar, recordForPrompt, s, similarSources } from "./capa-copilot.context";
import { defineAction, defineFeature } from "./types";

/**
 * CAPA copilot: root-cause analysis, corrective-action plan and incident
 * investigation drafts for nonconformities (NC-) and incidents (INC-).
 * Every action returns a draft; the client fills the CAP editor / incident form
 * and saves through the normal implementation endpoints.
 */

const PERMISSION = ACTIONS.MS_MANAGE;

type Module = "nonconformities" | "incidents";

/** Load one record through the tenant-scoped register read, plus its org's other NC/incident records. */
async function loadWithPeers(ctx: { auth: Parameters<typeof listRecords>[0] }, module: Module, id: string) {
  const own = await listRecords(ctx.auth, module);
  const record = own.find((r) => r.id === id);
  if (!record) throw new NotFoundError("Record does not exist", "RECORD_NOT_FOUND");
  const other = await listRecords(ctx.auth, module === "incidents" ? "nonconformities" : "incidents", { orgId: record.orgId });
  const peers = [...own.filter((r) => r.orgId === record.orgId && r.id !== id), ...other];
  return { record, peers };
}

// ---- rca ---------------------------------------------------------------------------------------

const METHODS = ["5-why", "fishbone", "8d", "free"] as const;
type Method = (typeof METHODS)[number];

const FISHBONE = ["people", "methods", "machines", "materials", "measurement", "environment"] as const;

const ANALYSIS: Record<Method, { schema: z.ZodType<unknown>; instruction: string }> = {
  "5-why": {
    schema: z.object({ whys: z.array(z.object({ question: z.string(), answer: z.string() })).min(1).max(7) }),
    instruction: 'Use the 5 Whys: "analysis" is { "whys": [{ "question", "answer" }] }, each why following from the previous answer, stopping at a systemic cause.',
  },
  fishbone: {
    schema: z.object({ categories: z.object(Object.fromEntries(FISHBONE.map((k) => [k, z.array(z.string())])) as Record<(typeof FISHBONE)[number], z.ZodArray<z.ZodString>>) }),
    instruction: `Use a fishbone (Ishikawa) diagram: "analysis" is { "categories": { ${FISHBONE.map((k) => `"${k}": string[]`).join(", ")} } } listing candidate causes per category (empty array when none apply).`,
  },
  "8d": {
    schema: z.object({ disciplines: z.array(z.object({ step: z.string(), title: z.string(), content: z.string() })).min(1).max(8) }),
    instruction: 'Use 8D: "analysis" is { "disciplines": [{ "step": "D1".."D8", "title", "content" }] }. Only fill a discipline from the context; say what is missing otherwise.',
  },
  free: {
    schema: z.object({ narrative: z.string() }),
    instruction: 'Write a free-form analysis: "analysis" is { "narrative": string }.',
  },
};

const rca = defineAction({
  permission: PERMISSION,
  input: z
    .object({ ncId: z.uuid().optional(), incidentId: z.uuid().optional(), method: z.enum(METHODS).default("5-why") })
    .refine((i) => !!i.ncId !== !!i.incidentId, "Give exactly one of ncId or incidentId"),
  async run(ctx) {
    const module: Module = ctx.input.ncId ? "nonconformities" : "incidents";
    const { record, peers } = await loadWithPeers(ctx, module, (ctx.input.ncId ?? ctx.input.incidentId)!);
    const similar = findSimilar(record, peers);
    const method = ANALYSIS[ctx.input.method];
    const { data, generationId } = await ctx.ai.json(
      z.object({ analysis: method.schema, rootCause: z.string(), openQuestions: z.array(z.string()) }),
      {
        system:
          "You are a quality/ISO management-system lead auditor helping a team run a root-cause analysis for a " +
          `${module === "incidents" ? "incident" : "nonconformity"} (ISO 9001/45001/27001 clause 10.2). ` +
          `${method.instruction} "rootCause" is the most likely systemic root cause in one or two sentences (not a symptom, not "human error" alone). ` +
          '"openQuestions" lists what the team must verify or find out before accepting the root cause. ' +
          "Similar past records are given for reference; cite them by code in square brackets only if they really relate.",
        user: [
          `Record:\n${recordForPrompt(record)}`,
          similar.length ? `Similar past records:\n${similarSources(similar)}` : "Similar past records: none found.",
        ].join("\n\n"),
        maxTokens: 2000,
        target: { type: module, id: record.id },
      },
    );
    return {
      method: ctx.input.method,
      ...data,
      similarPast: similar.map((p) => ({ id: p.id, code: p.code, title: p.title })),
      generationId,
    };
  },
});

// ---- cap ---------------------------------------------------------------------------------------

const cap = defineAction({
  permission: PERMISSION,
  // `rootCause`: the RCA text currently in the CAP editor, which may not be saved yet.
  input: z.object({ ncId: z.uuid(), rootCause: z.string().trim().max(8000).optional() }),
  async run(ctx) {
    const { record, peers } = await loadWithPeers(ctx, "nonconformities", ctx.input.ncId);
    const plan = (d(record).cap ?? {}) as Record<string, unknown>;
    const rootCause = ctx.input.rootCause || s(plan.rca).trim() || s(d(record).rootCause).trim();
    if (!rootCause) {
      throw new BadRequestError("Record a root cause analysis first, then ask for suggested actions");
    }
    const similar = findSimilar(record, peers);
    const { data, generationId } = await ctx.ai.json(
      z.object({
        correction: z.string(),
        correctiveAction: z.string(),
        resources: z.string(),
        effectivenessMethod: z.string(),
        effectivenessDueDays: z.number().int().min(1).max(365),
      }),
      {
        system:
          "You draft a corrective action plan for a nonconformity (ISO 10.2). " +
          '"correction" is the immediate fix of the detected issue; "correctiveAction" removes the recorded root cause so it does not recur ' +
          "(concrete, assignable steps). " +
          '"resources" lists people/budget/tools needed. "effectivenessMethod" says how and with what evidence effectiveness will be verified; ' +
          '"effectivenessDueDays" is how many days after implementation the check should happen.',
        user: [
          `Nonconformity:\n${recordForPrompt(record)}`,
          `Root cause analysis:\n${redactPii(truncateForPrompt(rootCause, 4000))}`,
          similar.length ? `Similar past records:\n${similarSources(similar)}` : "",
        ].filter(Boolean).join("\n\n"),
        maxTokens: 1500,
        target: { type: "nonconformities", id: record.id },
      },
    );
    return { ...data, generationId };
  },
});

// ---- incident-report ---------------------------------------------------------------------------

const incidentReport = defineAction({
  permission: PERMISSION,
  input: z.object({ incidentId: z.uuid() }),
  async run(ctx) {
    const { record, peers } = await loadWithPeers(ctx, "incidents", ctx.input.incidentId);
    const similar = findSimilar(record, peers);
    const { data, generationId } = await ctx.ai.json(
      z.object({ investigation: z.string(), rootCause: z.string(), correctiveAction: z.string(), followups: z.array(z.string()) }),
      {
        system:
          "You draft the investigation section of an incident report (ISO 10.2 / ISO 27035 style). " +
          '"investigation" summarises the timeline, facts established and evidence still to collect; "rootCause" is the most likely systemic cause; ' +
          '"correctiveAction" prevents recurrence; "followups" are short, assignable follow-up actions.',
        user: [
          `Incident:\n${recordForPrompt(record)}`,
          similar.length ? `Similar past records:\n${similarSources(similar)}` : "",
        ].filter(Boolean).join("\n\n"),
        maxTokens: 1500,
        target: { type: "incidents", id: record.id },
      },
    );
    return { ...data, generationId };
  },
});

export default defineFeature({
  key: "capa-copilot",
  label: "CAPA copilot",
  description: "Drafts root-cause analyses, corrective action plans and incident investigations.",
  actions: { rca, cap, "incident-report": incidentReport },
});
