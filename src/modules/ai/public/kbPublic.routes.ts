import { Router, type Request, type Response, type NextFunction } from "express";
import { Op } from "sequelize";
import { z } from "zod";
import { AiGeneration, CmsPage, CmsPost, Organization } from "../../../db/models";
import { isAiAvailable } from "../../../lib/ai";
import { aiCompleteJson, type AiJsonResult } from "../../../lib/ai/json";
import { sendOk } from "../../../lib/apiResponse";
import { AppError, NotFoundError } from "../../../lib/errors";
import { fullTextMatch, likeAnyMatch } from "../../../lib/textSearch";
import { rateLimit } from "../../../middleware/rateLimit";
import { writeAudit } from "../../audit/audit.service";
import { OPERATING_COMPANIES } from "../../business/business.service";
import { searchPublicArticles } from "../../knowledge-base/kb.service";
import { isFeatureEnabled } from "../features/flags";
import {
  answerSchema, buildAnswerPrompt, finalizeAnswer, KB_ANSWER_SYSTEM, NOT_COVERED, type AnswerDraft, type KbSource,
} from "../features/kbAssistant.context";
import { buildSystemPrompt } from "../features/runtime";

// PUBLIC router — mounted at /v1/public/ai/kb WITHOUT authenticate/tenantScope.
// Answers a site visitor's question ONLY from that org's Published knowledge
// base (CMS posts in a "… Knowledge Base" category + Published KB articles).
// Every refusal (unknown org, org without a public site, feature off) is the
// same 404 so org ids can't be probed; no AI connection is a quiet 503.

export const kbPublicRoutes = Router();

const FEATURE = "kb-assistant";
const ACTION = "public-answer";
const MAX_SOURCES = 8;
const KB_POST_CATEGORY = "%knowledge base%";

const bodySchema = z.object({
  question: z.string().trim().min(1).max(500),
  /** Operating company whose KB articles to use (the Exelera site passes "exelera"). */
  company: z.enum(OPERATING_COMPANIES).optional(),
});

const notFound = () => new NotFoundError("Not found", "NOT_FOUND");

/** Same rule as public leads: the Service Owner (marketing site) or an org with a Published CMS page. */
async function publicOrg(orgId: string): Promise<Organization> {
  if (!z.guid().safeParse(orgId).success) throw notFound();
  const org = await Organization.findByPk(orgId, { attributes: ["id", "type", "systemDefaults"] });
  if (!org) throw notFound();
  if (org.type !== "ServiceOwner" && (await CmsPage.count({ where: { orgId, status: "Published" } })) === 0) throw notFound();
  return org;
}

async function searchKbPosts(orgId: string, question: string): Promise<CmsPost[]> {
  const cols = ["title", "excerpt", "body"];
  const visible = {
    orgId,
    category: { [Op.iLike]: KB_POST_CATEGORY },
    [Op.or]: [{ status: "Published" }, { status: "Scheduled", publishDate: { [Op.lte]: new Date() } }],
  };
  const fts = fullTextMatch(cols, question);
  const rows = await CmsPost.findAll({ where: { [Op.and]: [visible, fts.where] }, order: [[fts.rank, "DESC"]], limit: MAX_SOURCES });
  const like = rows.length ? null : likeAnyMatch(cols, question);
  return like ? CmsPost.findAll({ where: { [Op.and]: [visible, like] }, order: [["updatedAt", "DESC"]], limit: MAX_SOURCES }) : rows;
}

/** The model call, recorded like ctx.ai.json does (ai_generations row + audit), with no user. */
async function generate(orgId: string, ip: string | null, language: string, user: string): Promise<{ data: AnswerDraft; generationId: string }> {
  const base = { orgId, userId: null, feature: FEATURE, action: ACTION, targetType: null, targetId: null };
  const audit = (id: string, result: "Success" | "Failure", model: string | null) => writeAudit({
    actorUserId: null, organizationId: orgId, action: "ai.generation", entityType: "AiGeneration", entityId: id,
    sourceIp: ip, result, metadata: { feature: FEATURE, action: ACTION, model, generationId: id, public: true },
  });
  let res: AiJsonResult<AnswerDraft>;
  try {
    res = await aiCompleteJson(answerSchema, {
      system: buildSystemPrompt(KB_ANSWER_SYSTEM, language), messages: [{ role: "user", content: user }], maxTokens: 800,
    });
  } catch (e) {
    const gen = await AiGeneration.create({
      ...base, provider: null, model: null, latencyMs: null, status: "failed", error: e instanceof AppError ? e.message : "The AI request failed",
    });
    await audit(gen.id, "Failure", null);
    throw new AppError("AI_UNAVAILABLE", "The assistant is unavailable right now", 503);
  }
  const gen = await AiGeneration.create({
    ...base, provider: res.provider, model: res.model, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens,
    latencyMs: res.latencyMs, status: "draft", error: null,
  });
  await audit(gen.id, "Success", res.model);
  return { data: res.data, generationId: gen.id };
}

const limiter = rateLimit({ windowMs: 60_000, max: 10, keyPrefix: "ai-kb-public" });

kbPublicRoutes.post("/:orgId", limiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const org = await publicOrg(req.params.orgId as string);
    if (!(await isFeatureEnabled(org.id, FEATURE))) throw notFound();
    if (!(await isAiAvailable())) throw new AppError("AI_UNAVAILABLE", "The assistant is unavailable right now", 503);
    const { question, company } = bodySchema.parse(req.body ?? {});

    const [posts, articles] = await Promise.all([
      searchKbPosts(org.id, question),
      searchPublicArticles(org.id, org.type === "ServiceOwner", question, { company, limit: MAX_SOURCES }),
    ]);
    const postSources: KbSource[] = posts.map((p) => ({ title: p.title, summary: p.excerpt, content: p.body, ref: { slug: p.slug } }));
    const articleSources: KbSource[] = articles.map((a) => ({ title: a.title, summary: a.summary, content: a.content, ref: {} }));
    const half = MAX_SOURCES / 2;
    const sources = [...postSources.slice(0, half), ...articleSources.slice(0, half), ...postSources.slice(half), ...articleSources.slice(half)]
      .slice(0, MAX_SOURCES);
    if (!sources.length) {
      sendOk(res, { answer: NOT_COVERED, citations: [], answered: false });
      return;
    }

    const language = org.systemDefaults?.language || "English";
    const { data } = await generate(org.id, req.ip ?? null, language, buildAnswerPrompt(question, sources));
    // KB articles have no public page, so only CMS posts carry a slug the site can link to.
    sendOk(res, finalizeAnswer(data, sources, (s) => ({ title: s.title, ...(s.ref.slug ? { slug: s.ref.slug } : {}) })));
  } catch (e) {
    next(e);
  }
});
