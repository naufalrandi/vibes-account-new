import { z } from "zod";
import { defineAction, defineFeature } from "./types";

/**
 * Generic summarizer — also the reference example for writing a feature.
 * POST /v1/ai/features/summarize/text { text, instruction? } → { summary, generationId }
 */
const text = defineAction({
  permission: "*",
  input: z.object({
    text: z.string().trim().min(1).max(20_000),
    instruction: z.string().trim().max(500).optional(),
  }),
  async run(ctx) {
    const { text: summary, generationId } = await ctx.ai.text({
      system:
        "You summarize text for busy compliance and management-system professionals. " +
        "Keep the key facts, decisions, obligations, owners and dates. Be concise; use short bullet points when the text lists several items.",
      user: [
        ctx.input.instruction ? `Instruction: ${ctx.input.instruction}` : null,
        "Text to summarize:",
        ctx.input.text,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 1024,
    });
    return { summary: summary.trim(), generationId };
  },
});

export default defineFeature({
  key: "summarize",
  label: "Summarize",
  description: "Summarize any block of text into a short draft.",
  actions: { text },
});
