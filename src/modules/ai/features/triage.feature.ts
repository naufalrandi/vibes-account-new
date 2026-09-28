import { z } from "zod";
import { NotFoundError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { ACTIONS } from "../../iam/actions.catalog";
import { CONCERN_CLASSIFICATIONS, listRecords, type RecordView } from "../../implementation/implementation.service";
import { listArticles } from "../../knowledge-base/kb.service";
import { getTicket } from "../../tickets/ticket.service";
import { citeList, jsonForPrompt, redactPii, truncateForPrompt } from "./context";
import { queryCoverage, textSimilarity, topMatches } from "./triage.similarity";
import { defineAction, defineFeature } from "./types";

/**
 * Triage drafts for intake records: concern classification (+ duplicate
 * candidates found in code), CSAT comment analysis, and support-ticket
 * category/priority + a KB-grounded reply. Nothing is saved: the person routes
 * the concern, updates the CSAT record or sends the reply through the normal UI.
 */

const MS_ACCESS = [ACTIONS.MS_READ, ACTIONS.MS_MANAGE];
const CLOSED = new Set(["Closed", "Cancelled", "Archived", "Routed"]);
const TICKET_CATEGORIES = ["Technical Support", "Billing", "Commercial", "Feature Request", "Bug Report", "General Inquiry"] as const;
const TICKET_PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
const DUPLICATE_MIN = 0.3;
const KB_MIN = 0.25;

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** One register record by id, through the tenant-scoped register read. */
async function findRecord(auth: AuthContext, module: string, id: string): Promise<RecordView> {
  // ponytail: the register has no single-record read, so this filters the caller's visible list; add a scoped get if registers grow large.
  const rec = (await listRecords(auth, module)).find((r) => r.id === id);
  if (!rec) throw new NotFoundError("Record does not exist", "RECORD_NOT_FOUND");
  return rec;
}

const recordText = (r: RecordView) => `${r.title} ${str(r.data.description)} ${str(r.data.category)}`;

/** Open NCs and other open concerns of the concern's org whose text overlaps it. */
export async function findPossibleDuplicates(auth: AuthContext, concern: RecordView) {
  const [ncs, concerns] = await Promise.all([
    listRecords(auth, "nonconformities", { orgId: concern.orgId }),
    listRecords(auth, "concerns", { orgId: concern.orgId }),
  ]);
  const candidates = [...ncs, ...concerns].filter((r) => r.id !== concern.id && !CLOSED.has(r.status));
  const target = recordText(concern);
  return topMatches(candidates, (r) => textSimilarity(target, recordText(r)), DUPLICATE_MIN, 5).map(({ item, score }) => ({
    id: item.id,
    code: item.code,
    title: item.title,
    reason: `${Math.round(score * 100)}% wording overlap with this concern (${item.module === "nonconformities" ? "open nonconformity" : "open concern"}, ${item.status})`,
  }));
}

const concern = defineAction({
  permission: MS_ACCESS,
  input: z.object({ concernId: z.uuid() }),
  async run(ctx) {
    const c = await findRecord(ctx.auth, "concerns", ctx.input.concernId);
    const possibleDuplicates = await findPossibleDuplicates(ctx.auth, c);
    const { data, generationId } = await ctx.ai.json(
      z.object({ suggestedClass: z.enum(CONCERN_CLASSIFICATIONS), rationale: z.string(), routingNotes: z.string() }),
      {
        system:
          "You triage concerns reported into an ISO management system. Classify the concern as exactly one of: " +
          `${CONCERN_CLASSIFICATIONS.join(", ")}. ` +
          "Nonconformity = a requirement (standard, procedure, legal, customer) was not met. Incident = an unplanned event that caused or could cause harm, loss or disruption. " +
          "Observation / Improvement = no requirement breached but something could be better. Duplicate = the same issue is already recorded (only if a listed candidate clearly is the same issue). " +
          "Invalid Report = not a real or verifiable issue. No Action Required = valid but needs nothing. " +
          "Give a short rationale citing the concern's facts, and routing notes for the owner of the resulting record (what to check first, who should be involved). " +
          'Answer as JSON: {"suggestedClass": string, "rationale": string, "routingNotes": string}.',
        user: [
          `Concern [${c.code}]:`,
          jsonForPrompt({ title: c.title, status: c.status, category: c.data.category, process: c.data.process, site: c.data.site, workUnit: c.data.workUnit }, 1500),
          `Description:\n${truncateForPrompt(redactPii(str(c.data.description)), 4000)}`,
          c.data.evidence ? `Evidence:\n${truncateForPrompt(redactPii(str(c.data.evidence)), 1500)}` : null,
          possibleDuplicates.length
            ? `Possible duplicates found by wording overlap:\n${citeList(possibleDuplicates.map((d) => ({ id: d.code, text: `${d.title} — ${d.reason}` })))}`
            : "No similar open nonconformities or concerns were found.",
        ].filter(Boolean).join("\n\n"),
        maxTokens: 800,
        target: { type: "concern", id: c.id },
      },
    );
    return { ...data, possibleDuplicates, generationId };
  },
});

const csat = defineAction({
  permission: MS_ACCESS,
  input: z.object({ recordId: z.uuid() }),
  async run(ctx) {
    const r = await findRecord(ctx.auth, "customer-satisfaction", ctx.input.recordId);
    const { data, generationId } = await ctx.ai.json(
      z.object({
        sentiment: z.enum(["positive", "neutral", "negative", "mixed"]),
        themes: z.array(z.string()).max(8),
        suggestedRoute: z.enum(["improvement", "NC", "none"]),
        rationale: z.string(),
      }),
      {
        system:
          "You analyse customer satisfaction feedback for an ISO 9001 quality team. Determine the sentiment, list the main themes (short noun phrases), " +
          "and suggest a route: NC when the feedback shows a product/service requirement or customer requirement was not met, improvement when it points to something that could be better, none when no action is needed. " +
          'Answer as JSON: {"sentiment": "positive"|"neutral"|"negative"|"mixed", "themes": string[], "suggestedRoute": "improvement"|"NC"|"none", "rationale": string}.',
        user: [
          `CSAT record [${r.code}]:`,
          jsonForPrompt({ title: r.title, method: r.data.method, type: r.data.ftype, score: r.data.score, overall: r.data.overall, period: r.data.period, category: r.data.category, categoryScores: r.data.cats, priority: r.data.priority }, 2000),
          `Comment:\n${truncateForPrompt(redactPii(str(r.data.comment)) || "(no comment)", 4000)}`,
        ].join("\n\n"),
        maxTokens: 600,
        target: { type: "customer-satisfaction", id: r.id },
      },
    );
    return { ...data, generationId };
  },
});

const ticket = defineAction({
  permission: [ACTIONS.TICKET_READ, ACTIONS.TICKET_MANAGE],
  input: z.object({ ticketId: z.uuid() }),
  async run(ctx) {
    const t = await getTicket(ctx.auth, ctx.input.ticketId);
    const query = `${t.subject} ${t.description ?? ""} ${t.messages.filter((m) => m.author.kind === "user").map((m) => m.text).join(" ")}`;
    const published = (await listArticles(ctx.auth, { status: "Published" })).filter((a) => a.status === "Published");
    const articles = topMatches(published, (a) => queryCoverage(query, `${a.title} ${a.summary ?? ""} ${a.keywords.join(" ")} ${a.content}`), KB_MIN, 5)
      .map((m) => m.item);
    const { data, generationId } = await ctx.ai.json(
      z.object({
        category: z.enum(TICKET_CATEGORIES),
        priority: z.enum(TICKET_PRIORITIES),
        draftReply: z.string(),
        citedArticleIds: z.array(z.string()),
        kbHasAnswer: z.boolean(),
      }),
      {
        system:
          "You help a support agent triage a customer ticket. Choose the best category and priority " +
          `(categories: ${TICKET_CATEGORIES.join(", ")}; priorities: ${TICKET_PRIORITIES.join(", ")} — Critical only for outages or data loss). ` +
          "Draft a polite reply to the customer based ONLY on the knowledge base articles provided, citing each article you use by its id in square brackets. " +
          "If the articles do not answer the question, set kbHasAnswer to false and write a reply that acknowledges the request and says the team is looking into it, without inventing steps. " +
          'Answer as JSON: {"category": string, "priority": string, "draftReply": string, "citedArticleIds": string[], "kbHasAnswer": boolean}.',
        user: [
          `Ticket ${t.code} (current category: ${t.category}, priority: ${t.priority}, status: ${t.status}):`,
          `Subject: ${t.subject}`,
          `Description:\n${truncateForPrompt(redactPii(t.description ?? ""), 3000)}`,
          t.messages.length
            ? `Latest messages:\n${truncateForPrompt(redactPii(t.messages.slice(-5).map((m) => `${m.author.kind}: ${m.text}`).join("\n")), 3000)}`
            : null,
          articles.length
            ? `Knowledge base articles:\n${citeList(articles.map((a) => ({ id: a.id, text: `${a.title}: ${truncateForPrompt(a.summary ? `${a.summary} ${a.content}` : a.content, 1500)}` })))}`
            : "No published knowledge base article matches this ticket.",
        ].filter(Boolean).join("\n\n"),
        maxTokens: 1200,
        target: { type: "ticket", id: t.id },
      },
    );
    const cited = articles.filter((a) => data.citedArticleIds.includes(a.id));
    const kbHasAnswer = data.kbHasAnswer && cited.length > 0;
    return {
      category: data.category,
      priority: data.priority,
      draftReply: data.draftReply,
      kbHasAnswer,
      relatedArticles: (cited.length ? cited : articles).map((a) => ({ id: a.id, title: a.title })),
      generationId,
    };
  },
});

export default defineFeature({
  key: "triage",
  label: "Triage assistant",
  description: "Suggests a classification for concerns (with possible duplicates), analyses CSAT comments, and drafts ticket categories and KB-grounded replies.",
  actions: { concern, csat, ticket },
});
