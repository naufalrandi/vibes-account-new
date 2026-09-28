# AI features

Every file named `<key>.feature.ts` in this directory is loaded at boot (API and
worker) by `registry.ts`. **Adding a feature = adding one file** (plus its test).
Do not edit the registry, routes, or `app.ts`.

## Minimal feature

```ts
// src/modules/ai/features/risk-assist.feature.ts
import { z } from "zod";
import { ACTIONS } from "../../iam/actions.catalog";
import { defineAction, defineFeature } from "./types";
import { citeList, redactPii, truncateForPrompt } from "./context";

const suggest = defineAction({
  permission: [ACTIONS.RISK_CREATE, ACTIONS.RISK_UPDATE], // any-of; "*" = any signed-in user
  input: z.object({ riskId: z.uuid() }),                  // validated → 400 VALIDATION_ERROR
  async run(ctx) {
    // Load data through the EXISTING tenant-scoped service with ctx.auth — never query models unscoped.
    const risk = await riskService.get(ctx.auth, ctx.input.riskId);
    const { data, generationId } = await ctx.ai.json(
      z.object({ controls: z.array(z.object({ title: z.string(), sourceIds: z.array(z.string()) })) }),
      {
        system: "You suggest ISO 27001 controls for a risk.",
        user: `Risk:\n${truncateForPrompt(redactPii(risk.description), 4000)}\n\nSources:\n${citeList(sources)}`,
        target: { type: "risk", id: risk.id },
      },
    );
    return { ...data, generationId }; // always return the generationId(s)
  },
});

export default defineFeature({
  key: "risk-assist",               // must match the file name
  label: "Risk assistant",
  description: "Suggests controls for a risk.",
  actions: { suggest },
});
```

It is then served at `POST /v1/ai/features/risk-assist/suggest` and listed by
`GET /v1/ai/features`. `summarize.feature.ts` is a complete working example.

## Rules

- **Drafts only.** An action returns a draft for a person to review; it never
  writes business records itself. The client saves the (possibly edited) draft
  through the normal module endpoint and reports the outcome with
  `POST /v1/ai/generations/:id/feedback { status: "accepted" | "edited" | "rejected" }`.
- **Always call the model through `ctx.ai.json` / `ctx.ai.text`.** They append
  `Write in {language}.` and the safety paragraph (cite sources by id, never
  invent clause numbers / record codes / figures, say what is missing), record
  an `ai_generations` row and write the `ai.generation` audit entry. Never import
  `aiComplete` directly in a feature.
- **Tenant scoping** comes from `ctx.auth`: read data via the module's existing
  service functions that take `AuthContext`. Never trust ids in `input` without
  that scoped lookup.
- **Permissions** reuse the module's existing action keys (`ACTIONS.*` in
  `src/modules/iam/actions.catalog.ts`). Do not add AI-specific keys.
- **Prompt context**: `redactPii` personal data you don't need, `truncateForPrompt`
  / `jsonForPrompt` everything of unbounded size, `citeList` for sources the model
  must cite as `[id]`.
- **Long work**: set `mode: "job"`. The API answers `202 { jobId }`, the worker
  (`src/worker.ts`) runs it, the client polls `GET /v1/ai/jobs/:id`. Call
  `await ctx.progress?.(done, total)` as you go. The job re-checks permission and
  flags when it runs; a provider error is retried once.
- **Schedules**: `schedules: [{ key: "<feature>:<task>", everyMinutes, run }]` —
  run by the worker, at most once per interval across all workers. There is no
  user: `run()` must scope every query itself.
- Errors: throw the `src/lib/errors.ts` classes; their message reaches the user.

## Tests

Mock the model, not the framework:

```ts
const ai = vi.hoisted(() => ({ complete: vi.fn() }));
vi.mock("../../../lib/ai", async (orig) => ({ ...(await orig<typeof import("../../../lib/ai")>()), aiComplete: ai.complete }));
ai.complete.mockResolvedValueOnce({ text: '{"controls": []}', model: "m", provider: "openai", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1 });
```

`ctx.ai.json` goes through `src/lib/ai/json.ts`, which calls the same mocked
`aiComplete`, so one mock covers both. (To stub JSON results directly, mock
`../../../lib/ai/json`'s `aiCompleteJson` instead.) Make the AI "available" by
creating an enabled `AiConnection` row for the Service Owner org, and run job
actions with `processOneJob()` from `./jobs`. See `features.integration.test.ts`.
