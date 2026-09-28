import { z } from "zod";
import { countByUrgency, FEATURE_KEY, introPrompt, itemsForCaller, runDailyDigests } from "../deadlines/digest";
import { defineAction, defineFeature } from "./types";

/**
 * Deadline agent: a daily digest (bell notifications + one email per person)
 * of everything due, overdue or waiting on them, and a "My deadlines" preview.
 * The scan is deterministic (`../deadlines/scan.ts`); AI only writes the
 * digest's opening paragraph, and the digest is sent without it when AI is off.
 *
 * POST /v1/ai/features/deadline-agent/digest-preview {} →
 *   { today, items, counts, summary, generationId }
 */
const digestPreview = defineAction({
  permission: "*",
  input: z.object({}),
  async run(ctx) {
    const { today, items } = await itemsForCaller(ctx.auth);
    const counts = countByUrgency(items);
    if (!items.length) return { today, items, counts, summary: "Nothing is due or waiting on you in the next two weeks.", generationId: null };
    const { text, generationId } = await ctx.ai.text({ ...introPrompt(items, today), maxTokens: 400, target: { type: "deadline-digest", id: ctx.auth.userId } });
    return { today, items, counts, summary: text.trim(), generationId };
  },
});

export default defineFeature({
  key: FEATURE_KEY,
  label: "Deadline agent",
  description: "Daily digest of what is due, overdue or waiting on each person, with an AI-written priority summary.",
  actions: { "digest-preview": digestPreview },
  schedules: [{ key: `${FEATURE_KEY}:daily-digest`, everyMinutes: 60, run: async () => void (await runDailyDigests()) }],
});
