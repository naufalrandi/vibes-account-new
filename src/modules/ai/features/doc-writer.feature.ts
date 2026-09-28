import { z } from "zod";
import type { AuthContext } from "../../../lib/scope";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../../lib/errors";
import { ACTIONS } from "../../iam/actions.catalog";
import { listRecords } from "../../implementation/implementation.service";
import { getOrgSettings } from "../../organizations/organization.service";
import { listScopes } from "../../scope/scope.service";
import { listParties, listRequirements as listPartyRequirements } from "../../interested-parties/ip.service";
import { listTemplates } from "../../roles-register/roleRegister.service";
import { getProcessById } from "../../processes/process.service";
import { listMyFrameworks } from "../../frameworks/myFramework.service";
import { listRequirements as listFrameworkRequirements } from "../../frameworks/requirement.service";
import { citeList, redactPii, truncateForPrompt } from "./context";
import { hasActionPermission } from "./runtime";
import { defineAction, defineFeature } from "./types";

/**
 * Policy & procedure drafter. Every action returns a draft; the client puts it
 * into the policy editor / block editor and saves through the normal
 * implementation endpoints (nothing is written here).
 */

const PERMISSION = ACTIONS.MS_MANAGE;
const SOURCE_CHARS = 400;
const MAX_SOURCES_PER_KIND = 25;
const MAX_REQUIREMENTS = 20;

export const POLICY_FIELDS = [
  "purpose", "scope", "references", "definitions", "responsibilities", "statement",
  "commitments", "roles", "apxResp", "apxDef", "apxRef", "freeText",
] as const;
type PolicyField = (typeof POLICY_FIELDS)[number];
const DEFAULT_POLICY_FIELDS: PolicyField[] = ["purpose", "scope", "references", "definitions", "responsibilities", "statement"];

const FIELD_HINT: Record<PolicyField, string> = {
  purpose: "why the policy exists (1 short paragraph)",
  scope: "what and who the policy applies to, consistent with the scope statement",
  references: "the framework clauses and internal documents it relates to",
  definitions: "key terms, one per line as 'Term — definition'",
  responsibilities: "who is responsible for what, one per line as 'Role — responsibility'",
  statement: "the policy statement itself: management's intentions and direction",
  commitments: "the commitments top management makes (e.g. to satisfy requirements, to continual improvement)",
  roles: "roles and authorities, one per line",
  apxResp: "appendix: detailed responsibilities",
  apxDef: "appendix: extended definitions",
  apxRef: "appendix: extended references",
  freeText: "the whole policy as one document with headings",
};

interface Source { id: string; label: string; text: string }

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const clip = (s: string) => redactPii(truncateForPrompt(s.replace(/\s+/g, " ").trim(), SOURCE_CHARS));
const can = (auth: AuthContext, key: string) => hasActionPermission(auth, key);

// ---- pure helpers (unit-tested) -------------------------------------------------------------------

/** Clause codes that are about policy / leadership in most ISO-style standards. */
const POLICY_CODE_RE = /^(A\.)?5\.[123](\.|$)/;

interface ReqLike { code: string; subject: string; description?: string | null; type?: string }

/**
 * Pick the framework requirements a draft should be grounded in, in code (not by the model):
 * codes matching `codeRe`, or whose subject contains one of the keywords.
 */
export function pickRequirements<R extends ReqLike>(reqs: R[], keywords: string[], codeRe: RegExp | null = null, limit = MAX_REQUIREMENTS): R[] {
  const kws = keywords.map((k) => k.toLowerCase()).filter((k) => k.length >= 4);
  return reqs
    .filter((r) => (codeRe && codeRe.test(r.code)) || kws.some((k) => r.subject.toLowerCase().includes(k)))
    .slice(0, limit);
}

/** Significant words of a title, for keyword matching. */
export function keywordsOf(text: string): string[] {
  const stop = new Set(["procedure", "process", "policy", "document", "management", "control", "with", "from", "that", "this", "their"]);
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !stop.has(w)))];
}

/** The first `n` sentences of `text`. */
export function firstSentences(text: string, n: number): string {
  const parts = text.trim().match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [];
  return parts.slice(0, n).join("").trim();
}

export const BLOCK_KINDS = ["h1", "h2", "h3", "p", "ul", "ol", "quote", "callout", "divider"] as const;
type BlockKind = (typeof BLOCK_KINDS)[number];

/** BlockEditor's ContentBlock shape (fe lib/implementation/documents.ts), minus kinds AI never writes. */
export type DocBlock =
  | { kind: "h1" | "h2" | "h3" | "quote" | "callout"; text: string }
  | { kind: "ul" | "ol"; items: string[] }
  | { kind: "p"; lines: string[] }
  | { kind: "divider" };

/** Strip markdown line markers the model may add — the stored format is line-based, so they would re-parse as other blocks. */
const unmark = (s: string) => s.replace(/^\s*(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|>\s+|\[[ xX]?\]\s+)/, "").trim();

const rawBlock = z.object({ kind: z.string(), text: z.string().optional(), items: z.array(z.string()).optional() });
type RawBlock = z.infer<typeof rawBlock>;

/** Validate model blocks against the editor's kinds; unknown kinds and empty blocks are dropped. */
export function toDocBlocks(raw: RawBlock[]): DocBlock[] {
  const out: DocBlock[] = [];
  for (const b of raw) {
    const kind = b.kind as BlockKind;
    if (!BLOCK_KINDS.includes(kind)) continue;
    if (kind === "divider") { out.push({ kind }); continue; }
    if (kind === "ul" || kind === "ol") {
      const items = (b.items ?? (b.text ? b.text.split("\n") : [])).map(unmark).filter(Boolean);
      if (items.length) out.push({ kind, items });
      continue;
    }
    const lines = (b.text ?? (b.items ?? []).join("\n")).split("\n").map(unmark).filter(Boolean);
    if (!lines.length) continue;
    if (kind === "p") out.push({ kind, lines });
    else out.push({ kind, text: lines.join(" ") });
  }
  return out;
}

// ---- context loading (tenant-scoped services only) ------------------------------------------------

async function orgProfile(auth: AuthContext): Promise<string> {
  const o = await getOrgSettings(auth);
  return [`Organisation: ${o.legalName || o.name}`, o.industry && `Industry: ${o.industry}`, o.country && `Country: ${o.country}`]
    .filter(Boolean).join("\n");
}

async function scopeSources(auth: AuthContext): Promise<Source[]> {
  if (!can(auth, ACTIONS.SCOPE_READ)) return [];
  const active = (await listScopes(auth)).find((s) => s.orgId === auth.orgId && s.status === "Active");
  if (!active?.statement) return [];
  return [{ id: active.code, label: `${active.code} Scope statement`, text: clip(`Scope statement: ${active.statement}${active.limitations ? ` Exclusions/limitations: ${active.limitations}` : ""}`) }];
}

async function contextSources(auth: AuthContext): Promise<Source[]> {
  const rows = (await listRecords(auth, "context", { orgId: auth.orgId })).filter((r) => r.status !== "Archived");
  return rows.slice(0, MAX_SOURCES_PER_KIND).map((r) => ({
    id: r.code, label: `${r.code} ${r.title}`,
    text: clip(`Context issue (${str(r.data.type) || "issue"}${str(r.data.category) ? `, ${str(r.data.category)}` : ""}): ${r.title}. ${str(r.data.description)}`),
  }));
}

async function partySources(auth: AuthContext): Promise<Source[]> {
  if (!can(auth, ACTIONS.IP_READ)) return [];
  const parties = new Map((await listParties(auth)).map((p) => [p.id, p.name]));
  const reqs = (await listPartyRequirements(auth))
    .filter((r) => r.orgId === auth.orgId && r.status !== "Dismissed" && r.status !== "Archived");
  return reqs.slice(0, MAX_SOURCES_PER_KIND).map((r) => ({
    id: r.code, label: `${r.code} ${r.topic}`,
    text: clip(`Interested party ${parties.get(r.partyId) ?? "?"} requires: ${r.topic}. ${r.description ?? ""}`),
  }));
}

async function objectiveSources(auth: AuthContext): Promise<Source[]> {
  const rows = (await listRecords(auth, "objectives", { orgId: auth.orgId })).filter((r) => r.status === "Open");
  return rows.slice(0, MAX_SOURCES_PER_KIND).map((r) => ({
    id: r.code, label: `${r.code} ${r.title}`,
    text: clip(`Objective: ${str(r.data.name) || r.title}. Target: ${String(r.data.target ?? "?")} ${str(r.data.unit)}. ${str(r.data.description)}`),
  }));
}

async function roleSources(auth: AuthContext): Promise<Source[]> {
  if (!can(auth, ACTIONS.ORGROLE_READ)) return [];
  const rows = (await listTemplates(auth)).filter((t) => t.status !== "Archived" && t.status !== "Inactive");
  return rows.slice(0, MAX_SOURCES_PER_KIND).map((t) => ({
    id: t.code, label: `${t.code} ${t.name}`,
    text: clip(`Role ${t.name}: ${t.purpose ?? ""} Responsibilities: ${(t.responsibilities as unknown[]).map(String).join("; ")}`),
  }));
}

/** The subscribed framework with this name (case-insensitive), or null. */
async function findFramework(auth: AuthContext, name: string) {
  const n = name.trim().toLowerCase();
  const subs = await listMyFrameworks(auth);
  return subs.find((s) => s.frameworkName.toLowerCase() === n || s.frameworkCode.toLowerCase() === n)
    ?? subs.find((s) => s.frameworkName.toLowerCase().includes(n) || n.includes(s.frameworkName.toLowerCase()))
    ?? null;
}

async function requirementSources(auth: AuthContext, framework: string, keywords: string[], codeRe: RegExp | null): Promise<Source[]> {
  const fw = await findFramework(auth, framework);
  if (!fw) return [];
  // ponytail: listRequirements counts criteria per row (N+1); fine for one framework, add a lean query if it shows up in latency.
  const reqs = (await listFrameworkRequirements(auth, fw.frameworkId)).filter((r) => r.status !== "Archived");
  return pickRequirements(reqs, keywords, codeRe).map((r) => ({
    id: `${fw.frameworkCode || fw.frameworkName} ${r.code}`,
    label: `${fw.frameworkName} ${r.code} ${r.subject}`,
    text: clip(`${fw.frameworkName} clause ${r.code} — ${r.subject}: ${r.description ?? ""}`),
  }));
}

const sourceList = (sources: Source[]) => (sources.length ? citeList(sources) : "(none on record)");

/** Only citations of ids we actually supplied survive, labelled from our side. */
function resolveCitations(ids: string[], sources: Source[]) {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return [...new Set(ids.map((i) => i.replace(/^\[|\]$/g, "").trim()))]
    .filter((id) => byId.has(id))
    .map((id) => ({ id, label: byId.get(id)!.label }));
}

// ---- policy-draft ---------------------------------------------------------------------------------

const policyDraft = defineAction({
  permission: PERMISSION,
  input: z.object({
    policyId: z.uuid().optional(),
    framework: z.string().trim().min(1).max(200),
    fields: z.array(z.enum(POLICY_FIELDS)).min(1).max(POLICY_FIELDS.length).optional(),
    instructions: z.string().trim().max(1000).optional(),
  }),
  async run(ctx) {
    const { auth, input } = ctx;
    const fields = [...new Set(input.fields ?? DEFAULT_POLICY_FIELDS)];
    let existing = "";
    let title = "";
    if (input.policyId) {
      const policy = (await listRecords(auth, "policies", { orgId: auth.orgId })).find((r) => r.id === input.policyId);
      if (!policy) throw new NotFoundError("Policy does not exist", "RECORD_NOT_FOUND");
      title = policy.title;
      existing = POLICY_FIELDS.filter((f) => str(policy.data[f])).map((f) => `${f}: ${str(policy.data[f])}`).join("\n");
    }
    const [profile, scope, issues, parties, objectives, roles, reqs] = await Promise.all([
      orgProfile(auth), scopeSources(auth), contextSources(auth), partySources(auth),
      objectiveSources(auth), roleSources(auth), requirementSources(auth, input.framework, ["polic", "leadership", "commitment", "roles"], POLICY_CODE_RE),
    ]);
    const sources = [...scope, ...issues, ...parties, ...objectives, ...roles, ...reqs];

    const schema = z.object({
      fields: z.record(z.string(), z.string()),
      citations: z.array(z.string()).default([]),
    });
    const { data, generationId } = await ctx.ai.json(schema, {
      system:
        `You draft management-system policies (e.g. an ${input.framework} top-level policy) for the organisation described. ` +
        "Write clear, specific, auditable policy text tailored to this organisation's context, scope, interested-party requirements, objectives and roles — not generic boilerplate. " +
        "Use the framework clauses provided to make sure the policy meets their requirements (e.g. appropriate to purpose, framework for objectives, commitment to satisfy requirements and to continual improvement). " +
        'Answer with JSON only: { "fields": { "<field>": "<text>" }, "citations": ["<source id>", …] } containing exactly the requested fields as plain text (no markdown headings). ' +
        "Cite source ids inline as [id] where you rely on them and list every cited id in \"citations\".",
      user: [
        `Framework: ${input.framework}`,
        title && `Policy name: ${title}`,
        `Fields to write:\n${fields.map((f) => `- ${f}: ${FIELD_HINT[f]}`).join("\n")}`,
        input.instructions && `Additional instructions from the author: ${input.instructions}`,
        existing && `Current policy content (keep what is good, improve the rest):\n${truncateForPrompt(existing, 6000)}`,
        profile,
        `Sources:\n${sourceList(sources)}`,
        reqs.length ? null : `No clauses of "${input.framework}" are on record — do not quote clause numbers.`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 4000,
      target: input.policyId ? { type: "policy", id: input.policyId } : undefined,
    });

    const out: Partial<Record<PolicyField, string>> = {};
    for (const f of fields) {
      const v = str(data.fields[f]);
      if (v) out[f] = v;
    }
    const inline = Object.values(out).join(" ").match(/\[([^\]\n]{1,80})\]/g) ?? [];
    return { fields: out, citations: resolveCitations([...data.citations, ...inline], sources), generationId };
  },
});

// ---- procedure-draft ------------------------------------------------------------------------------

const procedureDraft = defineAction({
  permission: PERMISSION,
  input: z.object({
    documentId: z.uuid().optional(),
    title: z.string().trim().min(1).max(300),
    purpose: z.string().trim().max(2000).optional(),
    processId: z.uuid().optional(),
    framework: z.string().trim().max(200).optional(),
    instructions: z.string().trim().max(1000).optional(),
  }),
  async run(ctx) {
    const { auth, input } = ctx;
    let existing = "";
    if (input.documentId) {
      // listRecords applies the documents module's per-user view scoping.
      const doc = (await listRecords(auth, "documents", { orgId: auth.orgId })).find((r) => r.id === input.documentId);
      if (!doc) throw new NotFoundError("Document does not exist", "RECORD_NOT_FOUND");
      existing = str(doc.data.content);
    }
    let process = "";
    if (input.processId) {
      if (!can(auth, ACTIONS.PROCESS_READ)) throw new ForbiddenError("You cannot read business processes");
      const p = await getProcessById(auth, input.processId);
      process = [
        `Process ${p.code} ${p.name}: ${p.description ?? ""}`,
        ...p.steps.map((s) => `${s.seq}. ${s.name}${s.description ? ` — ${s.description}` : ""}${s.responsible ? ` (responsible: ${s.responsible})` : ""}${s.kpi ? ` [KPI: ${s.kpi}]` : ""}`),
      ].join("\n");
    }
    const [profile, roles, reqs] = await Promise.all([
      orgProfile(auth), roleSources(auth),
      input.framework ? requirementSources(auth, input.framework, keywordsOf(`${input.title} ${input.purpose ?? ""}`), null) : Promise.resolve([]),
    ]);
    const sources = [...roles, ...reqs];

    const { data, generationId } = await ctx.ai.json(z.object({ blocks: z.array(rawBlock).min(1).max(120) }), {
      system:
        "You draft controlled procedures for a management system. Produce a complete, practical procedure: " +
        "Purpose, Scope, References, Definitions, Responsibilities, Procedure (numbered steps in order, each an action with who does it), Records (what is kept, where, retention), Revision history note. " +
        'Answer with JSON only: { "blocks": [ { "kind": "h1"|"h2"|"h3"|"p"|"ul"|"ol"|"callout", "text"?: string, "items"?: string[] } ] }. ' +
        "Use one h1 for the title, h2 per section, p for prose (text), ol for procedure steps (items), ul for lists (items) — write Responsibilities as ul items 'Role — responsibility'. " +
        "Plain text only: no markdown markers, no HTML. Cite source ids as [id] where you rely on them.",
      user: [
        `Title: ${input.title}`,
        input.purpose && `Purpose: ${input.purpose}`,
        input.framework && `Framework: ${input.framework}`,
        input.instructions && `Additional instructions from the author: ${input.instructions}`,
        process && `Business process this procedure covers:\n${redactPii(truncateForPrompt(process, 5000))}`,
        existing && `Current document content (build on it):\n${truncateForPrompt(existing, 6000)}`,
        profile,
        `Sources:\n${sourceList(sources)}`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 4000,
      target: input.documentId ? { type: "document", id: input.documentId } : undefined,
    });
    const blocks = toDocBlocks(data.blocks);
    if (!blocks.length) throw new BadRequestError("The AI returned no usable content. Try again.", "AI_EMPTY_DRAFT");
    return { blocks, generationId };
  },
});

// ---- improve-text ---------------------------------------------------------------------------------

export const IMPROVE_MODES = {
  clarify: "Rewrite the text so it is clearer and unambiguous. Keep the meaning, facts and length roughly the same.",
  shorten: "Shorten the text to about half its length, keeping every obligation, owner, date and figure.",
  formal: "Rewrite the text in a formal, controlled-document register (use 'shall' for requirements). Keep the meaning.",
  "translate-id": "Translate the text into Indonesian (Bahasa Indonesia). This overrides any other output-language instruction.",
  "translate-en": "Translate the text into English. This overrides any other output-language instruction.",
} as const;

const improveText = defineAction({
  permission: PERMISSION,
  input: z.object({
    text: z.string().trim().min(1).max(8000),
    mode: z.enum(Object.keys(IMPROVE_MODES) as [keyof typeof IMPROVE_MODES, ...(keyof typeof IMPROVE_MODES)[]]),
  }),
  async run(ctx) {
    const { text, generationId } = await ctx.ai.text({
      system:
        `You edit text in policies and procedures. ${IMPROVE_MODES[ctx.input.mode]} ` +
        "Keep inline HTML formatting tags (<b>, <i>, <u>, <a>, <br>) where they are. Reply with the resulting text only — no preamble, no quotes.",
      user: ctx.input.text,
      maxTokens: 3000,
    });
    return { text: text.trim(), generationId };
  },
});

// ---- change-summary -------------------------------------------------------------------------------

const changeSummary = defineAction({
  permission: PERMISSION,
  input: z.object({
    before: z.string().max(30_000),
    after: z.string().max(30_000),
  }).refine((v) => v.before.trim() || v.after.trim(), { message: "Nothing to compare" }),
  async run(ctx) {
    const { data, generationId } = await ctx.ai.json(
      z.object({ summary: z.string(), changes: z.array(z.string()).default([]) }),
      {
        system:
          "You write the change summary for a new version of a controlled document. Compare the previous and the current version. " +
          'Answer with JSON only: { "summary": "<at most 3 sentences>", "changes": ["<one concrete change per item>"] }. ' +
          "Describe substantive changes (requirements, responsibilities, steps, records), not formatting. If nothing substantive changed, say so.",
        user: `Previous version:\n${ctx.input.before.trim() || "(empty — this is the first version)"}\n\nCurrent version:\n${ctx.input.after.trim() || "(empty)"}`,
        maxTokens: 1200,
      },
    );
    return {
      summary: firstSentences(data.summary, 3),
      changes: data.changes.map((c) => c.trim()).filter(Boolean).slice(0, 20),
      generationId,
    };
  },
});

export default defineFeature({
  key: "doc-writer",
  label: "Policy & procedure writer",
  description: "Drafts policy fields and procedures from your context, improves selected text and suggests version change summaries.",
  actions: { "policy-draft": policyDraft, "procedure-draft": procedureDraft, "improve-text": improveText, "change-summary": changeSummary },
});
