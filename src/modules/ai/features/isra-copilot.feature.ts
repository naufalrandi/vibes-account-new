import { Op } from "sequelize";
import { z } from "zod";
import {
  IsraAnnexAControl,
  IsraExistingControl,
  IsraExistingControlAnnexRef,
  IsraKmVulnControl,
  IsraScenarioRecommendationDisposition,
  IsraTreatTemplate,
} from "../../../db/models";
import { ISRA_SAMPLE_SCENARIOS, type IsraSampleScenarioRow } from "../../../db/seeders/isra.tenantSample.data";
import { AppError, NotFoundError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { ACTIONS } from "../../iam/actions.catalog";
import { listRecords } from "../../implementation/implementation.service";
import { getScenarioById, ISRA_CONSEQ_WEIGHT, listScenarios } from "../../isra/israScenario.service";
import { listEffectiveLibrary } from "../../isra/israLibraryOverride.service";
import { getSoa } from "../../isra/israSoa.service";
import { getProcessById } from "../../processes/process.service";
import { getRiskById } from "../../risks/risk.service";
import { citeList, jsonForPrompt, redactPii, truncateForPrompt } from "./context";
import { defineAction, defineFeature, type AiActionContext } from "./types";

/**
 * ISRA + Risk register copilot. Every action returns a draft for a person to
 * review; nothing here writes a scenario, disposition, RTP, SoA justification
 * or risk action plan. The client applies the draft through the module's own
 * endpoints. Method C scores, likelihood/impact numbers, dispositions,
 * approvals and risk acceptance are never produced or changed.
 *
 * SoA justifications are returned, not saved: `IsraSoaJustification` has no
 * AI-authorship marker, so saving server-side would record AI text as the
 * caller's own. Existing (human-written) justifications are never redrafted.
 */

const ISRA_MANAGE = ACTIONS.ISRA_ORG_CONTROL_MANAGE;
const RISK_MANAGE = ACTIONS.MS_MANAGE;

export const IMPACT_AREAS = Object.keys(ISRA_CONSEQ_WEIGHT) as [string, ...string[]];
const MAX_EXAMPLES = 4;
const MIN_EXAMPLES = 3;
const SOA_BATCH = 10;
const BULK_MAX = 50;

const s = (v: unknown) => (typeof v === "string" ? v : "");
const id = z.string().trim().min(1).max(100);

// ------------------------------------------------------------ library lookups

interface LibEntry { name: string; description: string; category: string }
type Lib = Map<string, LibEntry>;

/** The org's effective library (platform + overrides + own items), keyed by platform and tenant item id. */
async function library(auth: AuthContext, libType: "threat" | "vuln" | "secondary" | "primary"): Promise<Lib> {
  const rows = await listEffectiveLibrary(auth, libType);
  const map: Lib = new Map();
  for (const r of rows) {
    const entry = { name: r.name, description: r.description ?? "", category: r.category ?? "" };
    if (r.platformItemId) map.set(r.platformItemId, entry);
    if (r.tenantItemId) map.set(r.tenantItemId, entry);
  }
  return map;
}

const libLine = (lib: Lib, key: string) => {
  const e = lib.get(key);
  return e ? `${e.name}${e.category ? ` (${e.category})` : ""}${e.description ? ` — ${e.description}` : ""}` : "not in the library";
};

async function annexNames(): Promise<Map<string, string>> {
  const rows = await IsraAnnexAControl.findAll({ attributes: ["ref", "name"] });
  return new Map(rows.map((r) => [r.ref, r.name]));
}

// ------------------------------------------------------------ scenario drafts

export interface FewShot { id: string; title: string; ciaDesc: Record<string, string>; likelihoodNote: string; impactNotes: { area: string; note: string }[] }

const short = (t: string, n = 220) => truncateForPrompt(t.replace(/\s+/g, " ").trim(), n);

function toFewShot(row: IsraSampleScenarioRow, i: number): FewShot {
  return {
    id: `EX-${i + 1}`,
    title: row.title,
    ciaDesc: Object.fromEntries(Object.entries(row.ciaDesc ?? {}).filter(([, v]) => v).map(([k, v]) => [k, short(String(v))])),
    likelihoodNote: short(row.likelihoodNote ?? ""),
    impactNotes: row.potentialImpacts.filter((p) => p.note).slice(0, 4).map((p) => ({ area: p.perspective, note: short(String(p.note)) })),
  };
}

/**
 * Style examples from the PLATFORM sample workspace (a static seed, never another
 * tenant's data): same threat first, most vulnerability overlap first; only when
 * the threat has no example, the first generic ones with notes.
 */
export function pickFewShots(threatId: string, vulnIds: string[], rows: readonly IsraSampleScenarioRow[] = ISRA_SAMPLE_SCENARIOS): FewShot[] {
  const withNotes = rows.filter((r) => r.likelihoodNote || r.potentialImpacts.some((p) => p.note));
  const overlap = (r: IsraSampleScenarioRow) => r.includedVulnIds.filter((v) => vulnIds.includes(v)).length;
  const same = withNotes.filter((r) => r.threatId === threatId).sort((a, b) => overlap(b) - overlap(a));
  const picked = same.length ? same.slice(0, MAX_EXAMPLES) : withNotes.slice(0, MIN_EXAMPLES);
  return picked.map(toFewShot);
}

const scenarioDraftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  ciaDesc: z.object({ c: z.string().max(1500).optional(), i: z.string().max(1500).optional(), a: z.string().max(1500).optional() }),
  likelihoodNote: z.string().max(2000),
  impactNotes: z.array(z.object({ area: z.enum(IMPACT_AREAS), note: z.string().max(1000) })).max(IMPACT_AREAS.length),
  citations: z.array(z.string().max(100)).max(30),
});
export type ScenarioDraft = z.infer<typeof scenarioDraftSchema>;

interface Pair { secondaryAssetId?: string; threatId: string; vulnIds: string[] }
interface Libs { threat: Lib; vuln: Lib; secondary: Lib }

export function scenarioPrompt(pair: Pair, libs: Libs, examples: FewShot[], existing?: { title?: string; primaryAssetRef?: string; processRef?: string }): string {
  const sources = [
    { id: pair.threatId, text: `Threat: ${libLine(libs.threat, pair.threatId)}` },
    ...pair.vulnIds.map((v) => ({ id: v, text: `Vulnerability: ${libLine(libs.vuln, v)}` })),
  ];
  return [
    pair.secondaryAssetId ? `Secondary asset ${pair.secondaryAssetId}: ${libLine(libs.secondary, pair.secondaryAssetId)}` : null,
    existing?.primaryAssetRef ? `Primary asset ref: ${existing.primaryAssetRef}` : null,
    existing?.processRef ? `Process ref: ${existing.processRef}` : null,
    existing?.title ? `Current title: ${existing.title}` : null,
    `Sources:\n${citeList(sources)}`,
    `Consequence areas (use these keys): ${IMPACT_AREAS.join(", ")}`,
    examples.length ? `Style examples (platform sample scenarios, imitate tone and length, do not copy facts):\n${jsonForPrompt(examples, 6000)}` : null,
  ].filter(Boolean).join("\n\n");
}

const SCENARIO_SYSTEM =
  "You draft ISO/IEC 27005 information-security risk scenarios for an ISRA register. " +
  "Given one threat, the vulnerabilities it exploits and the affected asset, write: a concise scenario title (threat via weakness on asset); " +
  "for each of confidentiality (c), integrity (i) and availability (a) that is actually affected, one or two sentences of loss context (omit unaffected ones); " +
  "a likelihood note explaining what makes the threat more or less likely given these vulnerabilities; and a short note for each consequence area that is relevant. " +
  "Never give numeric ratings, scores, severities or likelihood levels — the assessor rates those. Put the source ids you relied on in `citations`.";

async function draftScenario(ctx: AiActionContext<unknown>, pair: Pair, libs: Libs, existing?: Parameters<typeof scenarioPrompt>[3], targetId?: string) {
  const { data, generationId } = await ctx.ai.json(scenarioDraftSchema, {
    system: SCENARIO_SYSTEM,
    user: scenarioPrompt(pair, libs, pickFewShots(pair.threatId, pair.vulnIds), existing),
    maxTokens: 1500,
    target: targetId ? { type: "isra_scenario", id: targetId } : undefined,
  });
  return { ...data, generationId };
}

const loadScenarioLibs = async (auth: AuthContext): Promise<Libs> => {
  const [threat, vuln, secondary] = await Promise.all([library(auth, "threat"), library(auth, "vuln"), library(auth, "secondary")]);
  return { threat, vuln, secondary };
};

const pairSchema = z.object({
  secondaryAssetId: id.optional(),
  threatId: id,
  vulnIds: z.array(id).min(1).max(30),
});

const scenarioDraftAction = defineAction({
  permission: ISRA_MANAGE,
  input: pairSchema.extend({ scenarioId: z.uuid().optional() }),
  async run(ctx) {
    const scenario = ctx.input.scenarioId ? await getScenarioById(ctx.auth, ctx.input.scenarioId) : null;
    const libs = await loadScenarioLibs(ctx.auth);
    const pair = { ...ctx.input, secondaryAssetId: ctx.input.secondaryAssetId ?? scenario?.secondaryAssetRef ?? undefined };
    return draftScenario(ctx, pair, libs, scenario ?? undefined, scenario?.id);
  },
});

const scenarioDraftBulk = defineAction({
  permission: ISRA_MANAGE,
  mode: "job",
  input: z.object({ pairs: z.array(pairSchema).min(1).max(BULK_MAX) }),
  async run(ctx) {
    const libs = await loadScenarioLibs(ctx.auth);
    const drafts: Record<string, unknown>[] = [];
    for (const [i, pair] of ctx.input.pairs.entries()) {
      try {
        drafts.push({ pair, ...(await draftScenario(ctx, pair, libs)) });
      } catch (e) {
        // One bad pair must not lose the rest of the batch; the failure is already recorded as a failed generation.
        drafts.push({ pair, error: e instanceof AppError ? e.message : "The AI request failed" });
      }
      await ctx.progress?.(i + 1, ctx.input.pairs.length);
    }
    return { drafts, generationIds: drafts.map((d) => d.generationId).filter((g): g is string => typeof g === "string") };
  },
});

// ------------------------------------------------------ recommendation + RTP

interface KmEdge { id: string; vulnId: string; annexRef: string; mechanism: string | null }

async function kmEdges(vulnIds: string[]): Promise<KmEdge[]> {
  if (!vulnIds.length) return [];
  const rows = await IsraKmVulnControl.findAll({ where: { vulnId: { [Op.in]: vulnIds } }, attributes: ["id", "vulnId", "annexRef", "mechanism"] });
  return rows.map((r) => ({ id: r.id, vulnId: r.vulnId, annexRef: r.annexRef, mechanism: r.mechanism }));
}

type Scenario = Awaited<ReturnType<typeof getScenarioById>>;

const existingControlsText = (sc: Scenario) =>
  citeList((sc.existingControls as { id: string; title: string; status: string; description?: string | null; annexRefs: string[] }[]).map((c) => ({
    id: `EXC:${c.id}`,
    text: `${c.title} — ${c.status}; covers ${c.annexRefs.join(", ") || "no Annex A ref"}${c.description ? `. ${short(c.description, 300)}` : ""}`,
  }))) || "none recorded";

const DISPOSITIONS = ["Selected", "Not selected", "Already implemented"] as const;
const rationaleSchema = z.object({
  suggestions: z.array(z.object({
    annexRef: z.string().max(40),
    suggestedDisposition: z.enum(DISPOSITIONS),
    rationale: z.string().max(1500),
  })).max(200),
});

/** Code-side join: which knowledge-map edges back each recommended control (not left to the model). */
export function mechanismSources(edges: KmEdge[], annexRef: string): string | null {
  const ids = edges.filter((e) => e.annexRef === annexRef).map((e) => e.id);
  return ids.length ? ids.join(", ") : null;
}

const controlRationale = defineAction({
  permission: ISRA_MANAGE,
  input: z.object({ scenarioId: z.uuid() }),
  async run(ctx) {
    const sc = await getScenarioById(ctx.auth, ctx.input.scenarioId);
    const controls = (sc.recommendations?.controls ?? []) as { annexRef: string; fromVulns: string[] }[];
    if (!controls.length) throw new NotFoundError("Generate recommendations for this scenario first", "NO_RECOMMENDATIONS");
    const [edges, names, threat, vuln] = await Promise.all([kmEdges(sc.includedVulns), annexNames(), library(ctx.auth, "threat"), library(ctx.auth, "vuln")]);
    const refs = new Set(controls.map((c) => c.annexRef));
    const user = [
      `Scenario ${sc.code}: ${sc.title}`,
      `Threat: ${libLine(threat, sc.threatId)}`,
      `Vulnerabilities:\n${citeList((sc.includedVulns as string[]).map((v) => ({ id: v, text: libLine(vuln, v) })))}`,
      `Existing controls on this scenario:\n${existingControlsText(sc)}`,
      `Recommended Annex A controls with the knowledge-map mechanism sentences:\n${citeList(controls.map((c) => ({
        id: c.annexRef,
        text: `${names.get(c.annexRef) ?? ""}. For ${c.fromVulns.join(", ")}. ${edges.filter((e) => e.annexRef === c.annexRef && e.mechanism).map((e) => e.mechanism).join(" ")}`,
      })))}`,
    ].join("\n\n");
    const { data, generationId } = await ctx.ai.json(rationaleSchema, {
      system:
        "You help an ISO 27001 assessor rule on recommended Annex A controls for one risk scenario. For EVERY recommended control suggest " +
        "\"Already implemented\" when an existing control already covers it, otherwise \"Selected\" when it addresses a listed vulnerability, or \"Not selected\" with the reason. " +
        "Give a one- to three-sentence rationale citing the control ref, vulnerability ids and existing control ids ([EXC:...]). This is advice only; the assessor decides.",
      user,
      maxTokens: 3000,
      target: { type: "isra_scenario", id: sc.id },
    });
    const suggestions = data.suggestions
      .filter((x) => refs.has(x.annexRef))
      .map((x) => ({ ...x, mechanismSource: mechanismSources(edges, x.annexRef) }));
    return { suggestions, generationId };
  },
});

const rtpSchema = z.object({
  description: z.string().max(3000),
  expectedEvidence: z.string().max(3000),
  funding: z.string().max(1000).optional(),
  monitoring: z.string().max(3000),
  completionCriteria: z.string().max(3000),
  actions: z.array(z.object({
    action: z.string().trim().min(1).max(500),
    ownerRole: z.string().max(200),
    evidenceRequired: z.string().max(1000),
    completionCriteria: z.string().max(1000),
    targetOffsetDays: z.number().int().min(0).max(730),
    annexRefs: z.array(z.string().max(40)).max(20).optional(),
  })).min(1).max(20),
  citations: z.array(z.string().max(100)).max(40).optional(),
});

const rtpDraft = defineAction({
  permission: ISRA_MANAGE,
  input: z.object({ scenarioId: z.uuid() }),
  async run(ctx) {
    const sc = await getScenarioById(ctx.auth, ctx.input.scenarioId);
    const selected = new Set<string>([
      ...(sc.dispositions as { annexRef: string; disposition: string }[]).filter((d) => d.disposition === "Selected").map((d) => d.annexRef),
      ...(sc.addedControls as { annexRef: string }[]).map((a) => a.annexRef),
    ]);
    const [edges, names, templates] = await Promise.all([
      kmEdges(sc.includedVulns),
      annexNames(),
      IsraTreatTemplate.findAll({ where: { [Op.or]: [{ annexRef: { [Op.in]: [...selected] } }, { vulnId: { [Op.in]: sc.includedVulns } }] } }),
    ]);
    const user = [
      `Scenario ${sc.code}: ${sc.title}. Treatment option: ${sc.treatment?.option ?? "not decided"}.`,
      `Vulnerabilities: ${(sc.includedVulns as string[]).join(", ") || "none"}`,
      `Controls selected for treatment:\n${citeList([...selected].map((ref) => ({
        id: ref,
        text: `${names.get(ref) ?? ""}. ${edges.filter((e) => e.annexRef === ref && e.mechanism).map((e) => e.mechanism).join(" ")}`,
      }))) || "none selected yet"}`,
      `Existing controls:\n${existingControlsText(sc)}`,
      templates.length ? `Treatment templates:\n${citeList(templates.map((t) => ({ id: `TPL:${t.annexRef}/${t.vulnId}`, text: `${t.actionTemplate}. ${t.mechanism ?? ""}. ${t.notes ?? ""}` })))}` : null,
    ].filter(Boolean).join("\n\n");
    const { data, generationId } = await ctx.ai.json(rtpSchema, {
      system:
        "You draft an ISO 27001 Risk Treatment Plan for one risk scenario: a plan description, the evidence expected, the monitoring approach, " +
        "overall completion criteria and 3-8 concrete actions implementing the selected controls (reuse template wording where it fits). " +
        "Owners are ROLES (e.g. \"IT Security Lead\"), never person names. targetOffsetDays is days from today. " +
        "Only mention funding if the context supports it, and never invent amounts.",
      user,
      maxTokens: 3000,
      target: { type: "isra_scenario", id: sc.id },
    });
    return { ...data, generationId };
  },
});

// ------------------------------------------------------------- SoA justify

type SoaRow = Awaited<ReturnType<typeof getSoa>>[number];

/** Per-annexRef context: dispositions and existing controls in the caller's org. */
async function soaContext(auth: AuthContext) {
  const scenarios = await listScenarios(auth);
  const codeById = new Map(scenarios.map((sc) => [sc.id as string, sc.code as string]));
  const [dispositions, controls] = await Promise.all([
    codeById.size ? IsraScenarioRecommendationDisposition.findAll({ where: { scenarioId: { [Op.in]: [...codeById.keys()] } } }) : [],
    IsraExistingControl.findAll({ where: { orgId: auth.orgId }, attributes: ["id", "title", "status"] }),
  ]);
  const refs = controls.length ? await IsraExistingControlAnnexRef.findAll({ where: { existingControlId: { [Op.in]: controls.map((c) => c.id) } } }) : [];
  const ctrlById = new Map(controls.map((c) => [c.id, c]));
  const byRef = new Map<string, string[]>();
  const add = (ref: string, line: string) => byRef.set(ref, [...(byRef.get(ref) ?? []), line]);
  for (const d of dispositions) add(d.annexRef, `${codeById.get(d.scenarioId)}: ${d.disposition}${d.rationale ? ` — ${short(d.rationale, 150)}` : ""}`);
  for (const r of refs) {
    const c = ctrlById.get(r.existingControlId);
    if (c) add(r.annexRef, `existing control "${c.title}" (${c.status})`);
  }
  return byRef;
}

export function soaBatchPrompt(rows: SoaRow[], ctxByRef: Map<string, string[]>): string {
  return citeList(rows.map((r) => ({
    id: r.ref,
    text: `${r.name} [${r.category ?? ""}]. ${r.applicable ? `Applicable — used in ${(r.scenarios as { code: string }[]).map((x) => x.code).join(", ")}` : "No active risk scenario uses it"}. ` +
      `${(ctxByRef.get(r.ref) ?? []).slice(0, 8).join("; ")}`,
  })));
}

const soaSchema = z.object({ justifications: z.array(z.object({ annexRef: z.string().max(40), justification: z.string().max(1500) })).max(SOA_BATCH * 2) });

const soaJustify = defineAction({
  permission: ISRA_MANAGE,
  mode: "job",
  input: z.object({ onlyEmpty: z.boolean().default(true) }),
  async run(ctx) {
    const all = await getSoa(ctx.auth);
    // Authorship is not stored, so every saved justification counts as human-written: never redraft one, whatever `onlyEmpty` says.
    const todo = all.filter((r) => !r.justification.trim());
    const ctxByRef = await soaContext(ctx.auth);
    const drafts: { annexRef: string; name: string; applicable: boolean; justification: string; generationId: string }[] = [];
    const generationIds: string[] = [];
    for (let i = 0; i < todo.length; i += SOA_BATCH) {
      const batch = todo.slice(i, i + SOA_BATCH);
      const { data, generationId } = await ctx.ai.json(soaSchema, {
        system:
          "You write Statement of Applicability justifications (ISO/IEC 27001:2022 clause 6.1.3 d) for Annex A controls. " +
          "For each control give 1-3 sentences: why it is applicable (the risk scenarios, dispositions and existing controls given) or why it is excluded " +
          "when no scenario uses it (say that no assessed risk currently requires it and it should be confirmed). Cite scenario codes as given. Return one entry per control ref.",
        user: soaBatchPrompt(batch, ctxByRef),
        maxTokens: 2500,
      });
      generationIds.push(generationId);
      const byRef = new Map(batch.map((r) => [r.ref, r]));
      for (const j of data.justifications) {
        const row = byRef.get(j.annexRef);
        if (row && j.justification.trim()) drafts.push({ annexRef: row.ref, name: row.name, applicable: row.applicable, justification: j.justification.trim(), generationId });
      }
      await ctx.progress?.(Math.min(i + SOA_BATCH, todo.length), todo.length);
    }
    return { drafts, skippedWithJustification: all.length - todo.length, saved: false, generationIds };
  },
});

// -------------------------------------------------------- risk action plans

const actionPlanSchema = z.object({
  actionPlans: z.array(z.object({
    title: z.string().trim().min(1).max(500),
    description: z.string().max(2000),
    ownerRole: z.string().max(200),
    due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).min(1).max(10),
});

async function riskContext(auth: AuthContext, risk: Awaited<ReturnType<typeof getRiskById>>): Promise<string[]> {
  const out: string[] = [];
  if (risk.sourceIssueId) {
    const issue = (await listRecords(auth, "context", { orgId: risk.orgId })).find((r) => r.id === risk.sourceIssueId || r.code === risk.sourceIssueId);
    if (issue) out.push(`[${issue.code}] Context issue: ${issue.title}. ${short(s((issue.data as Record<string, unknown>).description), 600)}`);
  }
  if (risk.processId && (auth.isSuperAdmin || auth.actions.includes(ACTIONS.PROCESS_READ))) {
    try {
      const p = await getProcessById(auth, risk.processId);
      out.push(`[${p.code}] Process: ${p.name}. ${short(p.description ?? "", 400)} Steps: ${p.steps.map((st) => `${st.name}${st.responsible ? ` (${st.responsible})` : ""}`).join("; ")}`);
    } catch (e) {
      if (!(e instanceof AppError)) throw e; // a missing/hidden process only drops that context line
    }
  }
  return out;
}

const riskActionPlan = defineAction({
  permission: RISK_MANAGE,
  input: z.object({ riskId: z.uuid() }),
  async run(ctx) {
    const risk = await getRiskById(ctx.auth, ctx.input.riskId);
    const linked = await riskContext(ctx.auth, risk);
    const user = [
      `[${risk.code}] ${risk.title}`,
      `Description: ${redactPii(truncateForPrompt(risk.description, 3000))}`,
      `Category: ${risk.category}; source: ${risk.source}; band: ${risk.band ?? "not rated"}; priority: ${risk.priority ?? "not set"}`,
      linked.length ? `Linked context:\n${redactPii(linked.join("\n"))}` : null,
      risk.rtp?.actionPlans.length ? `Existing action plans (do not repeat): ${risk.rtp.actionPlans.map((a) => a.title).join("; ")}` : null,
      `Today: ${ctx.today}`,
    ].filter(Boolean).join("\n\n");
    const { data, generationId } = await ctx.ai.json(actionPlanSchema, {
      system:
        "You draft risk treatment action plans for a management-system risk register. Propose 2-5 concrete, verifiable actions that reduce the risk, " +
        "each with a short title, a description of what is done and how completion is evidenced, an owner ROLE (never a person's name) and a realistic due date (YYYY-MM-DD, after today).",
      user,
      maxTokens: 2000,
      target: { type: "risk", id: risk.id },
    });
    const actionPlans = data.actionPlans.map((p) => ({ ...p, due: p.due > ctx.today ? p.due : "", status: "Draft" as const }));
    return { actionPlans, generationId };
  },
});

export default defineFeature({
  key: "isra-copilot",
  label: "ISRA & risk copilot",
  description: "Drafts risk scenarios, control rationales, treatment plans, SoA justifications and risk action plans for review.",
  actions: {
    "scenario-draft": scenarioDraftAction,
    "scenario-draft-bulk": scenarioDraftBulk,
    "control-rationale": controlRationale,
    "rtp-draft": rtpDraft,
    "soa-justify": soaJustify,
    "risk-action-plan": riskActionPlan,
  },
});
