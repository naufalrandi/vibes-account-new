import { z } from "zod";
import {
  answerSchema, MAX_CALLS, MAX_ROUNDS, planSchema, resolveCitations, resultsForPrompt, runCalls, toolCatalogue, toolsUsed,
  transcript, type Executed, type ToolCall,
} from "./askVibes.loop";
import { ASK_TOOLS, type ToolEnv } from "./askVibes.tools";
import { hasActionPermission } from "./runtime";
import { defineAction, defineFeature } from "./types";

/**
 * Ask Vibes — a read-only conversational agent over the caller's own registers.
 * POST /v1/ai/features/ask-vibes/ask { question, history? }
 *   → { answer (markdown), citations: [{ type, id, code?, label }], toolsUsed, generationId, generationIds }
 * The model picks tools from ASK_TOOLS (≤ 4 per round, ≤ 2 rounds); each tool checks the
 * caller's read permission and reads through the module's tenant-scoped service. Nothing is written.
 */

const ROLE =
  "You are Vibes, an assistant inside a compliance management platform (ISO management systems, risk, audits). " +
  "You can only read the organisation's data through the tools listed below; you never change anything. " +
  "You have no access to HR or personnel data — if asked for it, say so.";

const CATALOGUE = toolCatalogue(ASK_TOOLS);

const PLAN_SYSTEM =
  `${ROLE}\n\nTools:\n${CATALOGUE}\n\n` +
  `Pick the tools (at most ${MAX_CALLS}) whose results you need to answer the question, with arguments matching each tool's schema. ` +
  "Return an empty list when no tool is relevant (greetings, questions outside these registers).";

const answerSystem = (canCallMore: boolean) =>
  `${ROLE}\n\n` +
  "Answer the question from the tool results only, in concise markdown (short paragraphs, bullet lists or a small table). " +
  "Mention record codes exactly as they appear in the results (the `ref` values) and list every ref you relied on in `citations`. " +
  "A result of {\"denied\": true} means the user lacks access to that area — say so instead of guessing. " +
  "If the results don't answer the question, say what is missing. " +
  (canCallMore
    ? `If you genuinely need more data, return up to ${MAX_CALLS} further tool calls in \`moreTools\` (same tools as below) and leave \`answer\` empty.\n\nTools:\n${CATALOGUE}`
    : "Return an empty `moreTools`.");

const ask = defineAction({
  permission: "*",
  input: z.object({
    question: z.string().trim().min(1).max(2000),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).max(10).default([]),
  }),
  async run(ctx) {
    const env: ToolEnv = { auth: ctx.auth, today: ctx.today };
    const can = (permission: string[]) => hasActionPermission(ctx.auth, permission);
    const convo = `Today is ${ctx.today}.\n\n${transcript(ctx.input.history, ctx.input.question)}`;
    const generationIds: string[] = [];

    const plan = await ctx.ai.json(planSchema, { system: PLAN_SYSTEM, user: convo, maxTokens: 600 });
    generationIds.push(plan.generationId);

    const executed: Executed[] = [];
    let calls: ToolCall[] = plan.data.tools;
    let rounds = 0;
    for (;;) {
      if (calls.length) {
        executed.push(...(await runCalls(ASK_TOOLS, calls, env, can)));
        rounds += 1;
      }
      const canCallMore = calls.length > 0 && rounds < MAX_ROUNDS;
      const { data, generationId } = await ctx.ai.json(answerSchema, {
        system: answerSystem(canCallMore),
        user: `${convo}\n\n${resultsForPrompt(executed)}`,
        maxTokens: 1500,
      });
      generationIds.push(generationId);
      if (canCallMore && data.moreTools.length && !data.answer.trim()) {
        calls = data.moreTools;
        continue;
      }
      return {
        answer: data.answer.trim() || "I couldn't find an answer to that in the data I can read.",
        citations: resolveCitations(data.citations, executed),
        toolsUsed: toolsUsed(executed),
        generationId,
        generationIds,
      };
    }
  },
});

export default defineFeature({
  key: "ask-vibes",
  label: "Ask Vibes",
  description: "Ask questions about your nonconformities, risks, audits, objectives, suppliers, documents and KPIs; answers cite the records they come from.",
  actions: { ask },
});
