import { Op } from "sequelize";
import { z } from "zod";
import { AiGeneration, Framework, FrameworkRequirement } from "../../../db/models";
import { IP_CATEGORIES } from "../../../db/models/interestedParty.models";
import { NotFoundError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { ACTIONS } from "../../iam/actions.catalog";
import { createRecord, listRecords } from "../../implementation/implementation.service";
import { createParty, createRequirement, listParties } from "../../interested-parties/ip.service";
import { adoptCatalogProcesses, CATALOG_PROCESS_NAMES, listProcesses } from "../../processes/process.service";
import { isicNotes, kbliNotes, listIsic, listKbli } from "../../reference/reference.service";
import { createScope, listScopes } from "../../scope/scope.service";
import { jsonForPrompt, truncateForPrompt } from "./context";
import { hasActionPermission } from "./runtime";
import { defineAction, defineFeature } from "./types";

/**
 * "ISO in a day" — first-draft management-system set-up for a new tenant.
 *
 * POST /v1/ai/features/onboarding/suggest { kbli?, isic?, industryDescription, employees?, sites?, frameworks, answers? } →
 *   { scope, contextIssues[], interestedParties[], processes[], objectives[], generationId }
 * POST /v1/ai/features/onboarding/apply { generationId, selections } →
 *   { created: {section: n}, skipped: {section: n}, ids: {section: id[]} }
 *
 * `apply` only creates what the user ticked, through each register's own
 * service: a Draft scope, context issues (Open), interested parties (+ their
 * needs as Open requirements), catalog processes, and objectives (Open).
 * Anything already present (same title/name, case-insensitive) is skipped.
 */

/** The Organizational Context register's domain vocabulary (fe lib/implementation/config.ts `context.fields.domain`). */
export const CONTEXT_DOMAINS = [
  "Regulatory", "Political", "Environmental", "Technological", "Market", "Economics", "Human Resources",
  "Infrastructure", "Information Systems", "Culture", "Financial", "Strategic", "Operational",
] as const;
const MAX_REQUIREMENTS_IN_PROMPT = 200;

const norm = (s: string) => s.trim().toLowerCase();

const contextIssue = z.object({
  domain: z.enum(CONTEXT_DOMAINS),
  type: z.enum(["internal", "external"]),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(2000),
});
const party = z.object({
  name: z.string().trim().min(1).max(200),
  category: z.enum(IP_CATEGORIES),
  needs: z.array(z.string().trim().min(1).max(300)).max(10),
});
const objective = z.object({
  title: z.string().trim().min(1).max(300),
  target: z.string().max(200),
  measure: z.string().max(500),
  due: z.string().max(40),
});
const exclusion = z.object({ clauseRef: z.string().max(60), justification: z.string().max(1000) });

const modelSchema = z.object({
  scope: z.object({ statement: z.string(), exclusions: z.array(exclusion) }),
  contextIssues: z.array(contextIssue),
  interestedParties: z.array(party),
  processes: z.array(z.object({ catalogName: z.string(), reason: z.string() })),
  objectives: z.array(objective),
});
type Suggestions = z.infer<typeof modelSchema>;

export interface Existing {
  scopeStatements: string[];
  contextTitles: string[];
  partyNames: string[];
  processNames: string[];
  objectiveTitles: string[];
}

async function loadExisting(auth: AuthContext): Promise<Existing> {
  const orgId = auth.orgId;
  const [scopes, context, parties, processes, objectives] = await Promise.all([
    listScopes(auth), listRecords(auth, "context", { orgId }), listParties(auth),
    listProcesses(auth), listRecords(auth, "objectives", { orgId }),
  ]);
  return {
    scopeStatements: scopes.filter((s) => s.orgId === orgId).map((s) => s.statement ?? "").filter(Boolean),
    contextTitles: context.map((r) => r.title),
    partyNames: parties.filter((p) => p.orgId === orgId).map((p) => p.name),
    processNames: processes.map((p) => p.name),
    objectiveTitles: objectives.map((r) => r.title),
  };
}

/**
 * Keep only usable suggestions: process names must be exact catalog names,
 * exclusion clause refs must be requirement codes of the chosen frameworks,
 * and nothing that already exists in the org (or twice in the list).
 */
export function sanitizeSuggestions(s: Suggestions, existing: Existing, requirementCodes: Set<string>, catalog: readonly string[]): Suggestions {
  const catalogSet = new Set(catalog);
  const fresh = <T>(items: T[], key: (t: T) => string, taken: string[]) => {
    const seen = new Set(taken.map(norm));
    return items.filter((i) => {
      const k = norm(key(i));
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return {
    scope: { statement: s.scope.statement.trim(), exclusions: s.scope.exclusions.filter((e) => requirementCodes.has(e.clauseRef.trim())) },
    contextIssues: fresh(s.contextIssues, (c) => c.title, existing.contextTitles),
    interestedParties: fresh(s.interestedParties, (p) => p.name, existing.partyNames),
    processes: fresh(s.processes.filter((p) => catalogSet.has(p.catalogName)), (p) => p.catalogName, existing.processNames),
    objectives: fresh(s.objectives, (o) => o.title, existing.objectiveTitles),
  };
}

function industryContext(kbli?: string, isic?: string): string[] {
  const lines: string[] = [];
  if (kbli) {
    const node = listKbli(undefined, kbli).find((n) => n.code === kbli);
    const note = kbliNotes(kbli)?.note;
    if (node) lines.push(`KBLI ${node.code}: ${node.label}`);
    if (note) lines.push(`KBLI note: ${truncateForPrompt(note, 1200)}`);
    if (!isic && node?.isic) isic = node.isic;
  }
  if (isic) {
    const node = listIsic(undefined, isic).find((n) => n.code === isic);
    const note = isicNotes(isic);
    if (node) lines.push(`ISIC ${node.code}: ${node.label}`);
    if (note?.i) lines.push(`ISIC includes: ${truncateForPrompt(note.i, 800)}`);
    if (note?.e) lines.push(`ISIC excludes: ${truncateForPrompt(note.e, 500)}`);
  }
  return lines;
}

const suggestInput = z.object({
  kbli: z.string().trim().max(20).optional(),
  isic: z.string().trim().max(20).optional(),
  industryDescription: z.string().trim().min(3).max(4000),
  employees: z.number().int().min(1).max(1_000_000).optional(),
  sites: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  frameworks: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  answers: z.record(z.string().max(200), z.string().max(1000)).optional(),
});

const suggest = defineAction({
  permission: [ACTIONS.SCOPE_MANAGE, ACTIONS.MS_MANAGE],
  input: suggestInput,
  async run(ctx) {
    const { input } = ctx;
    // Framework catalog (library data, not tenant data): match by code, or by name as a fallback.
    const frameworks = await Framework.findAll({
      where: { [Op.or]: [{ code: { [Op.in]: input.frameworks } }, { name: { [Op.in]: input.frameworks } }] },
      attributes: ["id", "code", "name"],
    });
    const reqs = frameworks.length === 0 ? [] : await FrameworkRequirement.findAll({
      where: { frameworkId: { [Op.in]: frameworks.map((f) => f.id) }, status: "Active" },
      attributes: ["frameworkId", "code", "subject"],
      order: [["code", "ASC"]],
      limit: MAX_REQUIREMENTS_IN_PROMPT,
    });
    const fwName = new Map(frameworks.map((f) => [f.id, f.code ?? f.name]));
    const existing = await loadExisting(ctx.auth);

    const { data, generationId } = await ctx.ai.json(modelSchema, {
      system:
        "You help a small or medium organization set up its first management system for the listed standards. " +
        "From the company profile, propose first drafts for: a scope statement (with exclusions only where a listed clause genuinely does not apply, " +
        "using the exact clause code and a justification); 6–12 context issues (internal and external, each with one of the allowed domains); " +
        "5–10 interested parties (category from the allowed list) with their key needs; the business processes the organization most likely runs, " +
        "chosen ONLY by exact name from the process catalog; and 3–6 measurable objectives (target, how it is measured, due date YYYY-MM-DD within 12 months). " +
        "Do not repeat anything in the 'already recorded' lists. Keep titles short.",
      user: [
        `Today: ${ctx.today}`,
        `Industry: ${truncateForPrompt(input.industryDescription, 2000)}`,
        ...industryContext(input.kbli, input.isic),
        input.employees ? `Employees: ${input.employees}` : null,
        input.sites?.length ? `Sites: ${input.sites.join("; ")}` : null,
        input.answers && Object.keys(input.answers).length ? `Further answers: ${jsonForPrompt(input.answers, 3000)}` : null,
        `Standards: ${frameworks.map((f) => f.code ? `${f.code} (${f.name})` : f.name).join(", ") || input.frameworks.join(", ")}`,
        reqs.length ? `Clauses (code — subject):\n${reqs.map((r) => `${fwName.get(r.frameworkId)} ${r.code} — ${r.subject}`).join("\n")}` : null,
        `Allowed context domains: ${CONTEXT_DOMAINS.join(", ")}`,
        `Allowed interested-party categories: ${IP_CATEGORIES.join(", ")}`,
        `Process catalog: ${CATALOG_PROCESS_NAMES.join("; ")}`,
        `Already recorded: ${jsonForPrompt(existing, 6000)}`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 4000,
      target: { type: "onboarding", id: ctx.auth.orgId },
    });
    const clean = sanitizeSuggestions(data, existing, new Set(reqs.map((r) => r.code)), CATALOG_PROCESS_NAMES);
    return { ...clean, generationId };
  },
});

const applyInput = z.object({
  generationId: z.uuid(),
  selections: z.object({
    scope: z.object({ statement: z.string().trim().min(1).max(4000), exclusions: z.array(exclusion).max(30).default([]) }).optional(),
    contextIssues: z.array(contextIssue).max(40).default([]),
    interestedParties: z.array(party).max(40).default([]),
    processes: z.array(z.object({ catalogName: z.string().max(200) })).max(80).default([]),
    objectives: z.array(objective).max(20).default([]),
  }),
});

type Section = "scope" | "contextIssues" | "interestedParties" | "processes" | "objectives";

const apply = defineAction({
  permission: [ACTIONS.SCOPE_MANAGE, ACTIONS.MS_MANAGE],
  input: applyInput,
  async run(ctx) {
    const { auth, ip, input: { generationId, selections } } = ctx;
    const gen = await AiGeneration.findOne({ where: { id: generationId, orgId: auth.orgId, feature: "onboarding" } });
    if (!gen) throw new NotFoundError("Onboarding suggestions not found", "GENERATION_NOT_FOUND");

    const existing = await loadExisting(auth);
    const created: Record<Section, number> = { scope: 0, contextIssues: 0, interestedParties: 0, processes: 0, objectives: 0 };
    const skipped: Record<Section, number> = { ...created };
    const ids: Record<Section, string[]> = { scope: [], contextIssues: [], interestedParties: [], processes: [], objectives: [] };
    /** Sections the caller may not write are skipped as a whole, not failed. */
    const can = (action: string) => hasActionPermission(auth, action);
    const isNew = (taken: string[], name: string) => {
      if (taken.some((t) => norm(t) === norm(name))) return false;
      taken.push(name);
      return true;
    };

    if (selections.scope) {
      if (can(ACTIONS.SCOPE_MANAGE) && isNew(existing.scopeStatements, selections.scope.statement)) {
        const limitations = selections.scope.exclusions.map((e) => `${e.clauseRef} — ${e.justification}`).join("\n") || undefined;
        const row = await createScope(auth, { name: "Management System Scope", statement: selections.scope.statement, limitations }, undefined, ip);
        created.scope++; ids.scope.push(row.id);
      } else skipped.scope++;
    }

    for (const c of selections.contextIssues) {
      if (!can(ACTIONS.MS_MANAGE) || !isNew(existing.contextTitles, c.title)) { skipped.contextIssues++; continue; }
      const type = c.type === "internal" ? "Internal" : "External";
      const r = await createRecord(auth, "context", { title: c.title, data: { domain: c.domain, type, description: c.description } }, undefined, ip);
      created.contextIssues++; ids.contextIssues.push(r.id);
    }

    for (const p of selections.interestedParties) {
      if (!can(ACTIONS.IP_MANAGE) || !isNew(existing.partyNames, p.name)) { skipped.interestedParties++; continue; }
      const row = await createParty(auth, { name: p.name, category: p.category }, undefined, ip);
      for (const need of p.needs) await createRequirement(auth, { partyId: row.id, topic: need, type: "Need" }, ip);
      created.interestedParties++; ids.interestedParties.push(row.id);
    }

    const catalog = new Set(CATALOG_PROCESS_NAMES);
    const wanted = selections.processes.map((p) => p.catalogName)
      .filter((n) => catalog.has(n) && can(ACTIONS.PROCESS_MANAGE) && isNew(existing.processNames, n));
    skipped.processes += selections.processes.length - wanted.length;
    if (wanted.length) {
      const rows = await adoptCatalogProcesses(auth, wanted, ip);
      created.processes += rows.length; skipped.processes += wanted.length - rows.length;
      ids.processes.push(...rows.map((r) => r.id));
    }

    for (const o of selections.objectives) {
      if (!can(ACTIONS.MS_MANAGE) || !isNew(existing.objectiveTitles, o.title)) { skipped.objectives++; continue; }
      const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(o.due) ? o.due : undefined;
      const r = await createRecord(auth, "objectives", {
        title: o.title, data: { target: o.target, due: o.due, targetDate, description: o.measure ? `Measure: ${o.measure}` : undefined },
      }, undefined, ip);
      created.objectives++; ids.objectives.push(r.id);
    }

    return { created, skipped, ids, generationId };
  },
});

export default defineFeature({
  key: "onboarding",
  label: "ISO in a day",
  description: "Suggests a first scope, context issues, interested parties, processes and objectives from a company profile.",
  actions: { suggest, apply },
});
