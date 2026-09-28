import { z } from "zod";
import { AiGeneration } from "../../../db/models";
import { BadRequestError, NotFoundError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { ACTIONS } from "../../iam/actions.catalog";
import { listRecords, updateRecord, type RecordView } from "../../implementation/implementation.service";
import { listFindings, listReports } from "../../internal-audit/internalAudit.service";
import { getPerfIndicators } from "../../performance-evaluation/perfEval.service";
import { redactPii, truncateForPrompt } from "./context";
import {
  ISO_DATE, TOPIC_SOURCES, attachActions, auditDigest, buildInputsPrompt, citedSources, findTopic,
  indicatorDigest, previousActionsDigest, registerDigest, reviewPeriod, topicKeyOf,
  type MrTopicLike, type Period, type SourceKey, type TopicData,
} from "./mrAutopilot.context";
import { defineAction, defineFeature } from "./types";

/**
 * Management Review autopilot (ISO 9.3) for the `reviews` implementation register.
 * - inputs:        per-topic input summaries drafted from figures computed here from live registers.
 * - minutes:       minutes summary + decisions + actions drafted ONLY from the chair's notes.
 * - apply-actions: attaches the actions the user selected to their topics (`topic.action`, the
 *                  register's open-action representation) through `updateRecord`.
 */

const FEATURE = "mr-autopilot";
const PERMISSION = ACTIONS.MS_MANAGE; // the reviews register is written through the MS clause-register routes
const TOPICS_PER_CALL = 6;
const CLOSED_REVIEW = ["Finalized", "Cancelled", "Archived"];

async function loadReview(auth: AuthContext, reviewId: string): Promise<{ review: RecordView; all: RecordView[] }> {
  // listRecords is org-scoped via ctx.auth; the id is only trusted once found in that list.
  const all = await listRecords(auth, "reviews");
  const review = all.find((r) => r.id === reviewId);
  if (!review) throw new NotFoundError("Management review not found", "MREVIEW_NOT_FOUND");
  return { review, all: all.filter((r) => r.orgId === review.orgId) };
}

const topicsOf = (review: RecordView): MrTopicLike[] =>
  (Array.isArray(review.data.topics) ? review.data.topics : []) as MrTopicLike[];

type Digest = { facts: string[]; sources: { id: string; label: string }[] };

/** Loads each needed source once (org-scoped) and turns it into a digest. */
async function collectDigests(
  auth: AuthContext, orgId: string, keys: Set<SourceKey>, period: Period, reviews: RecordView[], review: RecordView,
): Promise<Map<SourceKey, Digest>> {
  const out = new Map<SourceKey, Digest>();
  for (const key of keys) {
    if (key === "prevReviews") {
      out.set(key, previousActionsDigest(reviews, review.id, String(review.data.date ?? "")));
    } else if (key === "indicators") {
      out.set(key, indicatorDigest(await getPerfIndicators(auth, orgId)));
    } else if (key === "ia") {
      const [findings, reports] = await Promise.all([listFindings(auth, orgId), listReports(auth, orgId)]);
      out.set(key, auditDigest(findings, reports, period));
    } else {
      out.set(key, registerDigest(key, await listRecords(auth, key, { orgId }), period));
    }
  }
  return out;
}

const inputsSchema = z.object({
  topics: z.array(z.object({
    topicKey: z.string(),
    input: z.string(),
    trend: z.string(),
    sourceIds: z.array(z.string()).default([]),
  })),
});

const INPUTS_SYSTEM =
  "You prepare the inputs for an ISO management review (clause 9.3). For each topic you get figures computed from the organisation's registers, each line tagged with a source id. " +
  "For every topic write `input`: 2-5 plain sentences summarising the situation for top management. Use ONLY figures present in that topic's lines and put the source id in square brackets right after each figure, e.g. \"12 open nonconformities [register:nonconformities]\". " +
  "Write `trend`: one short phrase (improving / stable / worsening / not enough data) with the figures behind it, comparing the review period with the previous period when both are given. " +
  "List the ids you used in `sourceIds`. Return one entry per topicKey given, with the topicKey exactly as given.";

const inputs = defineAction({
  permission: PERMISSION,
  mode: "job",
  input: z.object({ reviewId: z.uuid(), topics: z.array(z.string().min(1).max(200)).max(40).optional() }),
  async run(ctx) {
    const { review, all } = await loadReview(ctx.auth, ctx.input.reviewId);
    const reviewTopics = topicsOf(review);
    const wanted = ctx.input.topics?.length
      ? ctx.input.topics.map((k) => findTopic(reviewTopics, k)).filter((t): t is MrTopicLike => Boolean(t))
      : reviewTopics;
    if (wanted.length === 0) throw new BadRequestError("The review has no matching topics", "NO_TOPICS");

    const reviewDate = String(review.data.date || ctx.today);
    const period = reviewPeriod(reviewDate, all.filter((r) => r.id !== review.id && r.status !== "Cancelled").map((r) => String(r.data.date ?? "")));
    const keys = new Set(wanted.flatMap((t) => TOPIC_SOURCES[t.title] ?? []));
    const digests = await collectDigests(ctx.auth, review.orgId, keys, period, all, review);

    const topicData: TopicData[] = wanted.map((t) => {
      const parts = (TOPIC_SOURCES[t.title] ?? []).map((k) => digests.get(k)!).filter(Boolean);
      return { topicKey: topicKeyOf(t), title: t.title, facts: parts.flatMap((p) => p.facts), sources: parts.flatMap((p) => p.sources) };
    });
    const withData = topicData.filter((t) => t.facts.length > 0);
    const results: Record<string, unknown>[] = topicData
      .filter((t) => t.facts.length === 0)
      .map((t) => ({ topicKey: t.topicKey, title: t.title, input: "", trend: "", sources: [], noData: true, generationId: null }));

    const generationIds: string[] = [];
    const batches = Math.ceil(withData.length / TOPICS_PER_CALL);
    for (let b = 0; b < batches; b++) {
      const batch = withData.slice(b * TOPICS_PER_CALL, (b + 1) * TOPICS_PER_CALL);
      const { data, generationId } = await ctx.ai.json(inputsSchema, {
        system: INPUTS_SYSTEM,
        user: buildInputsPrompt(batch, period),
        maxTokens: 3000,
        target: { type: "mreview", id: review.id },
      });
      generationIds.push(generationId);
      for (const t of batch) {
        const drafted = data.topics.find((d) => d.topicKey === t.topicKey);
        results.push({
          topicKey: t.topicKey, title: t.title, input: drafted?.input.trim() ?? "", trend: drafted?.trend.trim() ?? "",
          sources: citedSources(t.sources, drafted?.sourceIds ?? []), noData: false, generationId,
        });
      }
      await ctx.progress?.(b + 1, batches);
    }
    const order = wanted.map(topicKeyOf);
    results.sort((a, b) => order.indexOf(String(a.topicKey)) - order.indexOf(String(b.topicKey)));
    return { period, topics: results, generationId: generationIds[0] ?? null, generationIds };
  },
});

const minutesSchema = z.object({
  minutesSummary: z.string(),
  decisions: z.array(z.object({ topicKey: z.string().nullish(), decision: z.string() })).default([]),
  actions: z.array(z.object({
    topicKey: z.string().nullish(), action: z.string(), ownerName: z.string().nullish(), due: z.string().nullish(),
  })).default([]),
});

const minutes = defineAction({
  permission: PERMISSION,
  input: z.object({ reviewId: z.uuid(), notes: z.string().trim().min(1).max(20_000) }),
  async run(ctx) {
    const { review } = await loadReview(ctx.auth, ctx.input.reviewId);
    const topics = topicsOf(review);
    const topicList = topics.map((t) => `- topicKey: ${topicKeyOf(t)} — ${t.title}`).join("\n") || "(no agenda topics)";
    const { data, generationId } = await ctx.ai.json(minutesSchema, {
      system:
        "You turn a management review chair's meeting notes into draft minutes. " +
        "`minutesSummary`: a concise, formal summary of what was discussed (short paragraphs or bullets). " +
        "`decisions`: every decision stated in the notes; `actions`: every follow-up action stated in the notes, with the owner's name and due date (YYYY-MM-DD) only when the notes give them. " +
        "Take decisions and actions ONLY from the notes — never add your own recommendations. " +
        "Set `topicKey` to the agenda topic the item belongs to, using a topicKey from the list exactly, or null when unclear.",
      user: `Meeting date: ${String(review.data.date ?? "unknown")}\nAgenda topics:\n${topicList}\n\nNotes:\n${truncateForPrompt(redactPii(ctx.input.notes), 20_000)}`,
      maxTokens: 3000,
      target: { type: "mreview", id: review.id },
    });
    const validKey = (k: string | null | undefined) => (k && findTopic(topics, k) ? topicKeyOf(findTopic(topics, k)!) : null);
    return {
      minutesSummary: data.minutesSummary.trim(),
      decisions: data.decisions.filter((d) => d.decision.trim()).map((d) => ({ topicKey: validKey(d.topicKey), decision: d.decision.trim() })),
      actions: data.actions.filter((a) => a.action.trim()).map((a) => ({
        topicKey: validKey(a.topicKey),
        action: a.action.trim(),
        ownerName: a.ownerName?.trim() || null,
        due: a.due && ISO_DATE.test(a.due) ? a.due : null,
      })),
      generationId,
    };
  },
});

const applyActions = defineAction({
  permission: PERMISSION,
  input: z.object({
    reviewId: z.uuid(),
    generationId: z.uuid(),
    actions: z.array(z.object({
      topicKey: z.string().min(1).max(200),
      action: z.string().trim().min(1).max(500),
      ownerName: z.string().trim().max(200).nullish(),
      due: z.string().regex(ISO_DATE).nullish(),
      priority: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
    })).min(1).max(25),
  }),
  async run(ctx) {
    const { review } = await loadReview(ctx.auth, ctx.input.reviewId);
    const gen = await AiGeneration.findOne({
      where: { id: ctx.input.generationId, orgId: ctx.auth.orgId, feature: FEATURE, action: "minutes", targetId: review.id },
    });
    if (!gen) throw new BadRequestError("Unknown minutes draft for this review", "GENERATION_NOT_FOUND");
    if (CLOSED_REVIEW.includes(review.status)) {
      throw new BadRequestError(`Actions cannot be added to a ${review.status} review`, "REVIEW_CLOSED");
    }
    const { topics, errors } = attachActions(topicsOf(review), ctx.input.actions);
    if (errors.length) throw new BadRequestError(errors.join("; "), "ACTION_TOPIC_CONFLICT");
    // The normal save path: lifecycle validation, audit entry and activity log all apply.
    const saved = await updateRecord(ctx.auth, "reviews", review.id, { title: review.title, data: { ...review.data, topics } }, ctx.ip);
    return { review: saved, created: ctx.input.actions.length, generationId: ctx.input.generationId };
  },
});

export default defineFeature({
  key: FEATURE,
  label: "Management review autopilot",
  description: "Drafts management review inputs from live register data, and minutes, decisions and actions from meeting notes.",
  actions: { inputs, minutes, "apply-actions": applyActions },
});
