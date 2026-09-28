import { z } from "zod";
import { ForbiddenError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { ACTIONS } from "../../iam/actions.catalog";
import { KB_CATEGORIES, searchArticles } from "../../knowledge-base/kb.service";
import { getTicket } from "../../tickets/ticket.service";
import { redactPii, truncateForPrompt } from "./context";
import { answerSchema, buildAnswerPrompt, finalizeAnswer, KB_ANSWER_SYSTEM, NOT_COVERED, type KbSource } from "./kbAssistant.context";
import { hasActionPermission } from "./runtime";
import { defineAction, defineFeature } from "./types";

/**
 * Knowledge-base assistant.
 * - answer:              answers a question ONLY from Published KB articles the caller can read (cited), or says the KB doesn't cover it.
 * - article-from-ticket: drafts a KB article from a resolved support ticket; the UI saves it as a Draft through the normal KB create.
 * The public marketing-site variant lives in `../public/kbPublic.routes.ts`.
 */

const MAX_SOURCES = 8;

async function ticketContext(auth: AuthContext, ticketId: string) {
  if (!hasActionPermission(auth, ACTIONS.TICKET_READ)) throw new ForbiddenError("You don't have access to tickets");
  return getTicket(auth, ticketId); // org-scoped: throws for a ticket outside the caller's visibility
}

const answer = defineAction({
  permission: ACTIONS.KB_READ,
  input: z.object({
    question: z.string().trim().min(1).max(1000),
    ticketId: z.uuid().optional(),
    /** Operating company filter (the KB page's AXIA/Exelera switcher). */
    company: z.string().trim().max(40).optional(),
  }),
  async run(ctx) {
    const { question, ticketId, company } = ctx.input;
    const ticket = ticketId ? await ticketContext(ctx.auth, ticketId) : null;
    const context = ticket ? `Support ticket ${ticket.code}: ${ticket.subject}\n${truncateForPrompt(redactPii(ticket.description ?? ""), 2000)}` : undefined;
    const articles = await searchArticles(ctx.auth, ticket ? `${question} ${ticket.subject}` : question, { company, limit: MAX_SOURCES });
    // Nothing retrieved: no model call — there is nothing it could honestly answer from.
    if (!articles.length) return { answer: NOT_COVERED, citations: [], answered: false, generationId: null };

    const sources: KbSource[] = articles.map((a) => ({ title: a.title, summary: a.summary, content: a.content, ref: { articleId: a.id } }));
    const { data, generationId } = await ctx.ai.json(answerSchema, {
      system: KB_ANSWER_SYSTEM,
      user: buildAnswerPrompt(question, sources, context),
      maxTokens: 1200,
      target: ticket ? { type: "ticket", id: ticket.id } : undefined,
    });
    return { ...finalizeAnswer(data, sources, (s) => ({ articleId: s.ref.articleId, title: s.title })), generationId };
  },
});

const CATEGORY_IDS = KB_CATEGORIES.map((c) => c.id) as [string, ...string[]];

const articleSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(500),
  content: z.string().min(1),
  keywords: z.array(z.string().max(60)).max(12).default([]),
  category: z.enum(CATEGORY_IDS).catch("troubleshooting"),
});

const ARTICLE_SYSTEM =
  "You turn a resolved customer support ticket into a reusable help-center article for a compliance management platform. " +
  "Write for any customer with the same problem: no customer names, organisation names, ticket codes, emails or other personal details. " +
  "Use only the facts in the ticket conversation; where the resolution is unclear, say so in the article instead of inventing steps. " +
  "`content` is markdown: a short description of the problem, then the numbered solution steps, then notes if any. " +
  "`summary` is one sentence. `keywords` are 3-8 search terms. `category` is one of: " +
  KB_CATEGORIES.map((c) => `${c.id} (${c.name})`).join(", ") + ".";

const articleFromTicket = defineAction({
  permission: ACTIONS.KB_MANAGE,
  input: z.object({ ticketId: z.uuid() }),
  async run(ctx) {
    // KB authoring is a Service-Owner control (kb.service assertServiceOwner) — don't draft what can't be saved.
    if (ctx.auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner authors knowledge base articles");
    const ticket = await ticketContext(ctx.auth, ctx.input.ticketId);
    const conversation = ticket.messages
      .map((m) => `${m.author.kind === "support" ? "Support" : "Customer"}: ${redactPii(m.text)}`)
      .join("\n\n");
    const { data, generationId } = await ctx.ai.json(articleSchema, {
      system: ARTICLE_SYSTEM,
      user: [
        `Ticket category: ${ticket.category}`,
        `Subject: ${redactPii(ticket.subject)}`,
        `Description:\n${truncateForPrompt(redactPii(ticket.description ?? ""), 3000)}`,
        `Conversation:\n${truncateForPrompt(conversation || "(no replies)", 8000)}`,
      ].join("\n\n"),
      maxTokens: 2000,
      target: { type: "ticket", id: ticket.id },
    });
    return { ...data, ticketCode: ticket.code, generationId };
  },
});

export default defineFeature({
  key: "kb-assistant",
  label: "Knowledge base assistant",
  description: "Answers questions from published knowledge-base articles with citations, and drafts KB articles from support tickets.",
  actions: { answer, "article-from-ticket": articleFromTicket },
});
