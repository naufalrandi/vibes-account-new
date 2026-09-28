import { randomUUID } from "node:crypto";
import type { ExamQuestion } from "../../../db/models/competence.models";
import type { ExamBankQuestion } from "../../reference/data/examBank";
import type { RoleSuggestionEntry } from "../../reference/data/roleSuggestions";

/** Pure helpers for competence-assist (no DB, no AI) — unit-tested in competence-assist.unit.test.ts. */

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => norm(s).toLowerCase();

/** Trimmed, non-empty, de-duplicated (case-insensitive) lines that are not already in `existing`. */
export function newLines(lines: string[], existing: string[] = []): string[] {
  const seen = new Set(existing.map(key));
  const out: string[] = [];
  for (const raw of lines) {
    const t = norm(raw);
    if (!t || seen.has(key(t))) continue;
    seen.add(key(t));
    out.push(t);
  }
  return out;
}

// ---- role archetypes ------------------------------------------------------------------------------

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);

/** Same preference order as the deterministic FE assistant: exact > contains > shared words. */
function score(query: string, candidate: string): number {
  const q = query.toLowerCase().trim();
  const c = candidate.toLowerCase().trim();
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (q.includes(c) || c.includes(q)) return 60 + Math.min(q.length, c.length);
  const cw = new Set(words(c));
  const hits = words(q).filter((w) => cw.has(w)).length;
  return hits ? 20 + hits * 8 : 0;
}

/** The `limit` archetypes closest to the role name (best first), used as few-shot examples. */
export function closestArchetypes(roleName: string, all: RoleSuggestionEntry[], limit = 2): RoleSuggestionEntry[] {
  return all
    .map((a) => ({ a, s: Math.max(...[a.name, ...a.aliases].map((n) => score(roleName, n))) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, limit)
    .map((x) => x.a);
}

// ---- role-draft sanitising -----------------------------------------------------------------------

export interface RoleDraftModelOut {
  description: string;
  responsibilities: string[];
  authorities: string[];
  skills: { name: string; level: number }[];
  eduFields: string[];
  expReqs: { sector: string; years: number }[];
}

export interface RoleDraftCurrent { description?: string; responsibilities?: string[]; authorities?: string[] }

export interface RoleDraftResult {
  description: string;
  responsibilities: string[];
  authorities: string[];
  skills: { name: string; level: number; inLibrary: boolean }[];
  eduFields: string[];
  expReqs: { sector: string; years: string }[];
}

const clampLevel = (n: number) => Math.min(4, Math.max(1, Math.round(Number(n) || 1)));

/**
 * Keep only what is new and valid: lines already in the draft are dropped (never duplicate),
 * skills are mapped onto the exact library name when one matches, and ISCED-F / ISIC codes the
 * reference lists don't know are dropped.
 */
export function sanitizeRoleDraft(
  out: RoleDraftModelOut,
  current: RoleDraftCurrent,
  lib: { skillNames: string[]; eduCodes: Set<string>; sectorCodes: Set<string> },
): RoleDraftResult {
  const desc = norm(out.description ?? "");
  const byKey = new Map(lib.skillNames.map((n) => [key(n), n]));
  const skills: RoleDraftResult["skills"] = [];
  const seenSkill = new Set<string>();
  for (const s of out.skills ?? []) {
    const n = norm(s.name ?? "");
    if (!n || seenSkill.has(key(n))) continue;
    seenSkill.add(key(n));
    const exact = byKey.get(key(n));
    skills.push({ name: exact ?? n, level: clampLevel(s.level), inLibrary: Boolean(exact) });
  }
  const seenSector = new Set<string>();
  const expReqs: RoleDraftResult["expReqs"] = [];
  for (const e of out.expReqs ?? []) {
    const sector = norm(e.sector ?? "").toUpperCase();
    if (!lib.sectorCodes.has(sector) || seenSector.has(sector)) continue;
    seenSector.add(sector);
    expReqs.push({ sector, years: String(Math.min(40, Math.max(0, Math.round(Number(e.years) || 0)))) });
  }
  return {
    description: desc && key(desc) !== key(current.description ?? "") ? desc : "",
    responsibilities: newLines(out.responsibilities ?? [], current.responsibilities),
    authorities: newLines(out.authorities ?? [], current.authorities),
    skills,
    eduFields: [...new Set((out.eduFields ?? []).map((c) => norm(c)).filter((c) => lib.eduCodes.has(c)))],
    expReqs,
  };
}

// ---- exam items -----------------------------------------------------------------------------------

export type ExamItemType = "mcq" | "short" | "mixed";

export interface ExamItemModelOut {
  type: string;
  question: string;
  options?: { text: string; correct: boolean }[];
  answerTrue?: boolean;
  modelAnswer?: string;
  points?: number;
  ref?: string;
  explanation?: string;
  sourceIds?: string[];
}

export type GeneratedExamItem = ExamQuestion & { sourceIds: string[] };

const ALLOWED_TYPES: Record<ExamItemType, string[]> = {
  mcq: ["single", "multi", "truefalse"],
  short: ["short"],
  mixed: ["single", "multi", "truefalse", "short"],
};

/**
 * Model items → instrument questions (`ExamQuestion`, what the exam editor stores). Items of the
 * wrong type, with broken answer keys (the same rules as the publish gate), duplicates, or
 * citing unknown sources are dropped / cleaned.
 */
export function toExamQuestions(items: ExamItemModelOut[], type: ExamItemType, sourceIds: Set<string>, existing: string[] = []): GeneratedExamItem[] {
  const seen = new Set(existing.map(key));
  const out: GeneratedExamItem[] = [];
  for (const it of items) {
    const text = norm(it.question ?? "");
    const t = it.type === "tf" || it.type === "true_false" ? "truefalse" : it.type;
    if (!text || seen.has(key(text)) || !ALLOWED_TYPES[type].includes(t)) continue;
    const base = {
      id: randomUUID(), type: t, text,
      points: Math.min(10, Math.max(1, Math.round(Number(it.points) || 1))),
      ref: norm(it.ref ?? ""), explanation: norm(it.explanation ?? ""),
      sourceIds: (it.sourceIds ?? []).filter((id) => sourceIds.has(id)),
    };
    let q: GeneratedExamItem | null = null;
    if (t === "single" || t === "multi") {
      const options = (it.options ?? []).map((o) => ({ id: randomUUID(), text: norm(o.text ?? ""), correct: o.correct === true })).filter((o) => o.text);
      const correct = options.filter((o) => o.correct).length;
      if (options.length >= 2 && (t === "single" ? correct === 1 : correct >= 1)) q = { ...base, options };
    } else if (t === "truefalse") {
      if (typeof it.answerTrue === "boolean") q = { ...base, answerTrue: it.answerTrue };
    } else if (t === "short") {
      const model = norm(it.modelAnswer ?? "");
      if (model) q = { ...base, model };
    }
    if (!q) continue;
    seen.add(key(text));
    out.push(q);
  }
  return out;
}

/** Up to `n` bank questions of the wanted type(s) at the level (nearest level as fallback), as compact few-shot JSON. */
export function fewShotFromBank(levels: Record<string, ExamBankQuestion[]> | undefined, level: number, type: ExamItemType, n = 4): ExamBankQuestion[] {
  if (!levels) return [];
  const wanted = type === "short" ? ["short"] : type === "mcq" ? ["single", "multi", "tf"] : ["single", "multi", "tf", "short"];
  const order = [level, level - 1, level + 1, 1, 2, 3].filter((l, i, a) => l >= 1 && l <= 3 && a.indexOf(l) === i);
  const out: ExamBankQuestion[] = [];
  for (const l of order) {
    for (const q of levels[String(l)] ?? []) {
      if (out.length >= n) return out;
      if (wanted.includes(q.t) && !out.includes(q)) out.push(q);
    }
  }
  return out;
}

// ---- short-answer grading -----------------------------------------------------------------------

export interface GradeSuggestion { questionId: string; suggestedScore: number; maxScore: number; rationale: string }

/** Keep one suggestion per short question, score clamped to 0..points (whole points). */
export function sanitizeGrades(
  raw: { questionId: string; suggestedScore: number; rationale: string }[],
  shorts: { id: string; points: number }[],
): GradeSuggestion[] {
  const max = new Map(shorts.map((q) => [q.id, q.points]));
  const out = new Map<string, GradeSuggestion>();
  for (const r of raw) {
    const m = max.get(r.questionId);
    if (m === undefined || out.has(r.questionId)) continue;
    out.set(r.questionId, {
      questionId: r.questionId,
      suggestedScore: Math.min(m, Math.max(0, Math.round(Number(r.suggestedScore) || 0))),
      maxScore: m,
      rationale: norm(r.rationale ?? ""),
    });
  }
  return shorts.filter((q) => out.has(q.id)).map((q) => out.get(q.id)!);
}

// ---- awareness quiz -------------------------------------------------------------------------------

export interface AwarenessQuizItem {
  id: string; type: "single" | "truefalse"; text: string; points: number;
  options?: { id: string; text: string; correct: boolean }[]; answerTrue?: boolean;
}

/** Model items → the awareness quiz question shape (`{id, type, text, points, options, answerTrue}`). */
export function toAwarenessQuestions(items: { type: string; question: string; options?: { text: string; correct: boolean }[]; answerTrue?: boolean }[]): AwarenessQuizItem[] {
  const seen = new Set<string>();
  const out: AwarenessQuizItem[] = [];
  for (const it of items) {
    const text = norm(it.question ?? "");
    if (!text || seen.has(key(text))) continue;
    if (it.type === "truefalse") {
      if (typeof it.answerTrue !== "boolean") continue;
      out.push({ id: `awq-${randomUUID()}`, type: "truefalse", text, points: 1, answerTrue: it.answerTrue });
    } else {
      const options = (it.options ?? []).map((o) => ({ id: `o-${randomUUID()}`, text: norm(o.text ?? ""), correct: o.correct === true })).filter((o) => o.text);
      if (options.length < 2 || options.filter((o) => o.correct).length !== 1) continue;
      out.push({ id: `awq-${randomUUID()}`, type: "single", text, points: 1, options });
    }
    seen.add(key(text));
  }
  return out;
}
