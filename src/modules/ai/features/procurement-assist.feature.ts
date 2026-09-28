import { z } from "zod";
import { BadRequestError, NotFoundError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { getBusiness, type BusinessRecordView } from "../../business/business.service";
import { ACTIONS } from "../../iam/actions.catalog";
import { jsonForPrompt, redactPii, truncateForPrompt } from "./context";
import { quoteRows, threeWayCheck } from "./procurement-assist.context";
import { recordForPrompt } from "./sales-assist.context";
import { defineAction, defineFeature } from "./types";

/**
 * Procurement assistant for Purchase Requests (`enterprise/ent-pr`) and their POs (`ent-po`).
 * All numbers (quote ranking, 3-way match, tolerances) are computed in code; the model only
 * writes reasoning and notes. Nothing here saves a record, awards a quote, records a QC
 * decision or approves payment — the UI applies drafts through the normal PR save path.
 */

const AREA = "enterprise";
const s = (v: unknown) => (typeof v === "string" ? v : "");
const company = z.string().trim().max(20).optional();
const prOrPo = z.object({ prId: z.uuid().optional(), poId: z.uuid().optional(), company });
const needOne = (v: { prId?: string; poId?: string }) => !!(v.prId || v.poId);
const NEED_ONE = { message: "prId or poId is required" };

async function tryGet(auth: AuthContext, module: string, id: string | undefined, co?: string): Promise<BusinessRecordView | null> {
  if (!id) return null;
  try {
    return await getBusiness(auth, AREA, module, id, co);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

/** The PR and its PO (either id may be given), both scoped to the caller's org + company. */
async function loadPrPo(auth: AuthContext, input: { prId?: string; poId?: string; company?: string }) {
  const co = input.company;
  const poFirst = input.poId ? await tryGet(auth, "ent-po", input.poId, co) : null;
  if (input.poId && !poFirst) throw new NotFoundError("Purchase order not found", "RECORD_NOT_FOUND");
  const pr = await tryGet(auth, "ent-pr", input.prId ?? (s(poFirst?.data.prId) || undefined), co);
  if (!pr) throw new NotFoundError("Purchase request not found", "RECORD_NOT_FOUND");
  const po = poFirst ?? (await tryGet(auth, "ent-po", s(pr.data.poId) || undefined, co));
  return { pr, po };
}

// ---------------------------------------------------------------- compare-quotes

const compareSchema = z.object({
  recommendedQuoteId: z.string().nullable(),
  selectReason: z.string(),
  quoteNotes: z.array(z.object({ quoteId: z.string(), assessment: z.string(), risks: z.array(z.string()).max(6) })).max(20),
});

const compareQuotes = defineAction({
  permission: ACTIONS.BUSINESS_MANAGE,
  input: z.object({ prId: z.uuid(), company }),
  async run(ctx) {
    const { pr } = await loadPrPo(ctx.auth, ctx.input);
    const rows = quoteRows(pr.data, ctx.today);
    if (rows.length === 0) throw new BadRequestError("Record at least one quotation first", "NO_QUOTES");

    const { data, generationId } = await ctx.ai.json(compareSchema, {
      system:
        "You compare supplier quotations for a purchase request and recommend one. The figures, ranking and code-found risks " +
        "are already computed — do not recalculate or restate different numbers. Weigh price against lead time, validity, " +
        "documentation and the request's need-by date. recommendedQuoteId must be one of the quoteId values. " +
        "selectReason is 1-3 sentences a procurement officer can put on record; if the recommendation is not the lowest " +
        "price, it must say why. Add per-quote risks only when the context supports them.",
      user: [
        `Request:\n${recordForPrompt(pr, 2500)}`,
        `Quotes (currency ${s(pr.data.currency) || "IDR"}, cheapest first):\n${jsonForPrompt(rows, 8000)}`,
      ].join("\n\n"),
      maxTokens: 1500,
      target: { type: "ent-pr", id: pr.id },
    });

    const notes = new Map(data.quoteNotes.map((n) => [n.quoteId, n]));
    const recommended = rows.find((r) => r.quoteId === data.recommendedQuoteId) ?? null;
    return {
      currency: s(pr.data.currency) || "IDR",
      rows: rows.map((r) => ({ ...r, assessment: notes.get(r.quoteId)?.assessment ?? "", aiRisks: notes.get(r.quoteId)?.risks ?? [] })),
      recommendedQuoteId: recommended?.quoteId ?? null,
      isLowest: recommended ? recommended.rank === 1 : null,
      selectReason: data.selectReason.trim(),
      generationId,
    };
  },
});

// ---------------------------------------------------------------- qc-note

const qcNote = defineAction({
  permission: ACTIONS.BUSINESS_MANAGE,
  input: prOrPo.extend({
    observations: z.string().trim().min(1).max(4000),
    stage: z.enum(["handover", "return"]).optional(),
  }).refine(needOne, NEED_ONE),
  async run(ctx) {
    const { pr, po } = await loadPrPo(ctx.auth, ctx.input);
    const { text, generationId } = await ctx.ai.text({
      system:
        "You write the quality-control / acceptance inspection note for a received purchase (goods, rental asset or service). " +
        "Use the inspector's observations as the primary evidence and compare them with what was ordered (description, " +
        "quantity, specification, PO). Write 3-6 short factual sentences: what was inspected, what conforms, any deviation " +
        "and its impact, and the follow-up needed. Do not decide acceptance — the inspector records the decision.",
      user: [
        `Stage: ${ctx.input.stage ?? "return"}`,
        `Purchase request:\n${recordForPrompt(pr, 3000)}`,
        po ? `Purchase order:\n${recordForPrompt(po, 1500)}` : null,
        `Inspector's observations:\n${truncateForPrompt(redactPii(ctx.input.observations), 4000)}`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 700,
      target: { type: "ent-pr", id: pr.id },
    });
    return { note: text.trim(), generationId };
  },
});

// ---------------------------------------------------------------- three-way-check

const threeWay = defineAction({
  permission: [ACTIONS.BUSINESS_READ, ACTIONS.BUSINESS_MANAGE],
  input: prOrPo.refine(needOne, NEED_ONE),
  async run(ctx) {
    const { pr, po } = await loadPrPo(ctx.auth, ctx.input);
    const { legs, discrepancies } = threeWayCheck(pr.data, po ? { id: po.id, code: po.code, data: po.data } : null);
    const result = { prId: pr.id, match: discrepancies.length === 0, legs, discrepancies };
    // The model is skipped when everything matches, and when the only findings are missing documents.
    if (discrepancies.every((d) => d.code.endsWith("_missing"))) return result;

    const { text, generationId } = await ctx.ai.text({
      system:
        "You explain a failed 3-way match (purchase order vs goods/service receipt vs supplier invoice) to an accounts-payable " +
        "officer. The discrepancies were computed by the system; restate only their figures. In 2-5 sentences, say what " +
        "most likely happened and what to check or request (credit note, corrected invoice, receipt correction, PO amendment) " +
        "before payment is approved. Do not approve or reject payment.",
      user: [
        `Match legs (${legs.currency}):\n${jsonForPrompt(legs, 3000)}`,
        `Discrepancies:\n${jsonForPrompt(discrepancies, 4000)}`,
        `Request: ${truncateForPrompt(redactPii(`${pr.code} — ${pr.title}`), 300)}`,
      ].join("\n\n"),
      maxTokens: 600,
      target: { type: "ent-pr", id: pr.id },
    });
    return { ...result, explanation: text.trim(), generationId };
  },
});

export default defineFeature({
  key: "procurement-assist",
  label: "Procurement assistant",
  description: "Compares supplier quotes, drafts QC notes and explains PO / receipt / invoice mismatches. Figures are computed by the system.",
  actions: {
    "compare-quotes": compareQuotes,
    "qc-note": qcNote,
    "three-way-check": threeWay,
  },
});
