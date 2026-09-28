import { z } from "zod";
import { NotFoundError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { getBusiness, listBusiness, type BusinessRecordView } from "../../business/business.service";
import { serviceById } from "../../business/inquiryRules";
import { ACTIONS } from "../../iam/actions.catalog";
import { citeList, truncateForPrompt } from "./context";
import {
  clampScore, clauseLine, contractTypeLine, isServiceClause, keepKnown, pickSqAnswers,
  recordForPrompt, serviceCatalogForPrompt, sqKeysFor,
} from "./sales-assist.context";
import { defineAction, defineFeature } from "./types";

/**
 * Sales assistant for Leads → Inquiries → Proposals (`business_records`, area `enterprise`).
 * Every action returns a draft; nothing here writes a record or changes a status or lifecycle.
 * Prices, discounts, tax and CAB man-days are never produced by the model — the UI keeps
 * computing them with proposalRules / cabPricing. Suggested ids (services, sq keys, clauses,
 * contract types) are filtered in code to the ones that actually exist.
 */

const AREA = "enterprise";
const s = (v: unknown) => (typeof v === "string" ? v : "");
const id = z.uuid();
const company = z.string().trim().max(20).optional();
const LIST = { limit: 200, offset: 0 };

async function tryGet(auth: AuthContext, module: string, recId: string | undefined, co?: string): Promise<BusinessRecordView | null> {
  if (!recId) return null;
  try {
    return await getBusiness(auth, AREA, module, recId, co);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

async function mustGet(auth: AuthContext, module: string, recId: string, co: string | undefined, label: string): Promise<BusinessRecordView> {
  const r = await tryGet(auth, module, recId, co);
  if (!r) throw new NotFoundError(`${label} not found`, "RECORD_NOT_FOUND");
  return r;
}

async function clauseLibrary(auth: AuthContext, co?: string) {
  const [clauses, types] = await Promise.all([
    listBusiness(auth, AREA, "ent-clauses", co, {}, LIST),
    listBusiness(auth, AREA, "ent-svc-ctypes", co, {}, LIST),
  ]);
  return { clauses: clauses.rows.filter(isServiceClause), types: types.rows };
}

function context(parts: [string, BusinessRecordView | null][]): string {
  return parts.filter(([, r]) => r).map(([label, r]) => `${label}:\n${recordForPrompt(r!)}`).join("\n\n");
}

// ---------------------------------------------------------------- qualify-lead

const qualifySchema = z.object({
  summary: z.string(),
  fitScore: z.number(),
  reasons: z.array(z.string()).max(8),
  suggestedService: z.string().nullable(),
  suggestedVariant: z.string().nullable().optional(),
  missingInfo: z.array(z.string()).max(10),
  suggestedNextStep: z.string(),
});

const qualifyLead = defineAction({
  permission: [ACTIONS.BUSINESS_READ, ACTIONS.BUSINESS_MANAGE],
  input: z.object({ leadId: id, company }),
  async run(ctx) {
    const { leadId, company: co } = ctx.input;
    const lead = await tryGet(ctx.auth, "ent-leads", leadId, co);
    const inquiry = lead ? null : await mustGet(ctx.auth, "ent-inq", leadId, co, "Lead or inquiry");
    const inqLead = inquiry ? await tryGet(ctx.auth, "ent-leads", s(inquiry.data.leadId) || undefined, co) : null;
    const target = lead ?? inquiry!;

    const { data, generationId } = await ctx.ai.json(qualifySchema, {
      system:
        "You qualify B2B sales leads for a management-system consultancy (ISO implementation, audits, assessments, training). " +
        "Assess fit from the record only: need clarity, scope signals (frameworks, sites, headcount), timeline, decision maker, and source. " +
        "fitScore is 0-100. suggestedService must be one of the service ids listed, or null if none fits. " +
        "missingInfo lists the concrete facts a salesperson still has to collect. suggestedNextStep is one short action.",
      user: [
        `Services:\n${serviceCatalogForPrompt()}`,
        context([["Lead", lead ?? inqLead], ["Inquiry", inquiry]]),
      ].join("\n\n"),
      maxTokens: 1200,
      target: { type: lead ? "ent-leads" : "ent-inq", id: target.id },
    });

    const svc = data.suggestedService ? serviceById(data.suggestedService) : undefined;
    const variant = svc && data.suggestedVariant && svc.variants.includes(data.suggestedVariant) ? data.suggestedVariant : svc?.variants[0];
    return {
      recordType: lead ? "lead" : "inquiry",
      summary: data.summary.trim(),
      fitScore: clampScore(data.fitScore),
      reasons: data.reasons,
      suggestedService: svc ? { id: svc.id, name: svc.name, variant: variant ?? null } : null,
      missingInfo: data.missingInfo,
      suggestedNextStep: data.suggestedNextStep.trim(),
      generationId,
    };
  },
});

// ---------------------------------------------------------------- inquiry-scope

const scopeSchema = z.object({
  scopeText: z.string(),
  answers: z.array(z.object({ key: z.string(), value: z.string() })).max(20),
});

const inquiryScope = defineAction({
  permission: ACTIONS.BUSINESS_MANAGE,
  input: z.object({ inquiryId: id, company }),
  async run(ctx) {
    const { inquiryId, company: co } = ctx.input;
    const inquiry = await mustGet(ctx.auth, "ent-inq", inquiryId, co, "Inquiry");
    const lead = await tryGet(ctx.auth, "ent-leads", s(inquiry.data.leadId) || undefined, co);
    const service = s(inquiry.data.service);
    const variant = s(inquiry.data.variant);
    const sq = (inquiry.data.sq ?? {}) as Record<string, unknown>;
    // Only empty questionnaire fields are drafted; answers already given stay as they are.
    const open = sqKeysFor(service, variant).filter((k) => !String(sq[k] ?? "").trim());

    const { data, generationId } = await ctx.ai.json(scopeSchema, {
      system:
        "You draft the scope of work for a consultancy inquiry: objectives, frameworks, sites/units in scope, deliverables, " +
        "assumptions and exclusions, in short paragraphs or bullets. Then suggest answers for the open questionnaire keys, " +
        "ONLY where the context states or clearly implies the value; leave a key out when it is not supported. Never invent numbers or dates.",
      user: [
        `Service: ${service || "(not set)"}${variant ? ` / ${variant}` : ""}`,
        `Open questionnaire keys: ${open.length ? open.join(", ") : "(none)"}`,
        context([["Inquiry", inquiry], ["Lead", lead]]),
      ].join("\n\n"),
      maxTokens: 1500,
      target: { type: "ent-inq", id: inquiry.id },
    });

    return {
      scopeText: data.scopeText.trim(),
      suggestedAnswers: pickSqAnswers(data.answers, open),
      generationId,
    };
  },
});

// ---------------------------------------------------------------- proposal-draft

const MAX_ITEMS = 12;
const draftSchema = z.object({
  items: z.array(z.object({
    description: z.string(),
    qty: z.number(),
    unit: z.string(),
    suggestedServiceKey: z.string().nullable().optional(),
  })).max(20),
  notes: z.string(),
  termSuggestions: z.array(z.object({ termId: z.string(), reason: z.string() })).max(30),
});

const proposalDraft = defineAction({
  permission: ACTIONS.BUSINESS_MANAGE,
  input: z.object({ inquiryId: id.optional(), proposalId: id.optional(), company })
    .refine((v) => v.inquiryId || v.proposalId, { message: "inquiryId or proposalId is required" }),
  async run(ctx) {
    const { inquiryId, proposalId, company: co } = ctx.input;
    const proposal = proposalId ? await mustGet(ctx.auth, "ent-proposals", proposalId, co, "Proposal") : null;
    const inqId = inquiryId ?? (s(proposal?.data.inqId) || undefined);
    const inquiry = inquiryId ? await mustGet(ctx.auth, "ent-inq", inquiryId, co, "Inquiry") : await tryGet(ctx.auth, "ent-inq", inqId, co);
    const lead = await tryGet(ctx.auth, "ent-leads", s(inquiry?.data.leadId) || s(proposal?.data.leadId) || undefined, co);
    const { clauses } = await clauseLibrary(ctx.auth, co);

    const { data, generationId } = await ctx.ai.json(draftSchema, {
      system:
        "You draft the content of a commercial proposal for a management-system consultancy: line items (description, quantity, " +
        "unit of measure such as 'man-day', 'participant', 'site', 'lot'), a short notes paragraph, and which clauses from the " +
        "library to include (termId = the clause id in square brackets, with a one-line reason). " +
        "Do NOT give prices, rates, discounts, tax or man-day pricing — they are calculated by the system. " +
        "suggestedServiceKey is one of the service ids listed, or null. Quantities must come from the context (participants, sites, auditor-days); use 1 when unknown.",
      user: [
        `Services:\n${serviceCatalogForPrompt()}`,
        context([["Inquiry", inquiry], ["Existing proposal", proposal], ["Lead", lead]]),
        `Clause library:\n${clauses.length ? truncateForPrompt(citeList(clauses.map(clauseLine)), 12_000) : "(empty)"}`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 2000,
      target: proposal ? { type: "ent-proposals", id: proposal.id } : inquiry ? { type: "ent-inq", id: inquiry.id } : undefined,
    });

    const clauseIds = new Set(clauses.map((c) => c.id));
    return {
      items: data.items.slice(0, MAX_ITEMS).map((i) => ({
        description: i.description.trim(),
        qty: Number.isFinite(i.qty) && i.qty > 0 ? Math.min(Math.round(i.qty), 10_000) : 1,
        unit: i.unit.trim(),
        suggestedServiceKey: i.suggestedServiceKey && serviceById(i.suggestedServiceKey) ? i.suggestedServiceKey : null,
      })).filter((i) => i.description),
      notes: data.notes.trim(),
      termSuggestions: keepKnown(data.termSuggestions, (t) => t.termId, clauseIds),
      generationId,
    };
  },
});

// ---------------------------------------------------------------- contract-clauses

const clausesSchema = z.object({
  contractTypeId: z.string().nullable(),
  contractTypeReason: z.string(),
  clauses: z.array(z.object({ clauseId: z.string(), reason: z.string() })).max(30),
});

const contractClauses = defineAction({
  permission: ACTIONS.BUSINESS_MANAGE,
  input: z.object({ proposalId: id, company }),
  async run(ctx) {
    const { proposalId, company: co } = ctx.input;
    const proposal = await mustGet(ctx.auth, "ent-proposals", proposalId, co, "Proposal");
    const inquiry = await tryGet(ctx.auth, "ent-inq", s(proposal.data.inqId) || undefined, co);
    const { clauses, types } = await clauseLibrary(ctx.auth, co);

    const { data, generationId } = await ctx.ai.json(clausesSchema, {
      system:
        "You pick the service contract type and the contract clauses for an accepted or pending proposal. " +
        "contractTypeId must be one of the contract type ids in square brackets (or null if none fits); " +
        "clauses must be clause ids from the library in square brackets. Give a one-line reason for each.",
      user: [
        context([["Proposal", proposal], ["Inquiry", inquiry]]),
        `Contract types:\n${types.length ? citeList(types.map(contractTypeLine)) : "(none)"}`,
        `Clause library:\n${clauses.length ? truncateForPrompt(citeList(clauses.map(clauseLine)), 12_000) : "(empty)"}`,
      ].join("\n\n"),
      maxTokens: 1500,
      target: { type: "ent-proposals", id: proposal.id },
    });

    const type = types.find((t) => t.id === data.contractTypeId);
    return {
      contractType: type ? { id: type.id, title: type.title, reason: data.contractTypeReason.trim() } : null,
      clauses: keepKnown(data.clauses, (c) => c.clauseId, new Set(clauses.map((c) => c.id)))
        .map((c) => ({ ...c, title: clauses.find((x) => x.id === c.clauseId)?.title ?? "" })),
      generationId,
    };
  },
});

export default defineFeature({
  key: "sales-assist",
  label: "Sales assistant",
  description: "Qualifies leads, drafts inquiry scope and proposal content, and suggests contract clauses. Prices stay system-calculated.",
  actions: {
    "qualify-lead": qualifyLead,
    "inquiry-scope": inquiryScope,
    "proposal-draft": proposalDraft,
    "contract-clauses": contractClauses,
  },
});
