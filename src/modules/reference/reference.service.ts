import {
  ISIC, ISIC_NOTES, NACE, NACE_NOTES, KBLI, KBLI_NOTES, ISCEDF, EXAM_BANK, ROLE_SUGGESTIONS, ROLE_SUGGEST_COMMON,
  SKILL_TOPICS,
  type HierNode, type ExamQuestion, type RoleSuggestion,
} from "./reference.data";

function filterHier(rows: HierNode[], parent?: string, search?: string): HierNode[] {
  let out = rows;
  if (parent !== undefined) out = out.filter((r) => (parent === "" ? r.parent === null : r.parent === parent));
  if (search) {
    const s = search.toLowerCase();
    out = out.filter((r) => r.code.toLowerCase().includes(s) || r.label.toLowerCase().includes(s));
  }
  return out;
}

export const listIsic = (parent?: string, search?: string) => filterHier(ISIC, parent, search);
export const isicNotes = (code: string) => ISIC_NOTES[code] ?? null;
export const listNace = (parent?: string, search?: string) => filterHier(NACE, parent, search);
export const naceNotes = (code: string) => NACE_NOTES[code] ?? null;
export const listKbli = (parent?: string, search?: string) => filterHier(KBLI, parent, search);
export const kbliNotes = (code: string) => (KBLI_NOTES[code] !== undefined ? { note: KBLI_NOTES[code] } : null);
export const listIscedf = (search?: string) => filterHier(ISCEDF, undefined, search);

/** Exam bank filtered by skill and/or level (question banks for auto-generated exams). */
export function examBank(skill?: string, level?: string): { skill: string; level: string; questions: ExamQuestion[] }[] {
  // Levels are keyed "1"/"2"/"3" in the data but referenced app-wide (org-units,
  // the competence exam ladder) as "L1"/"L2"/"L3" — accept either.
  const wantLevel = level?.toLowerCase().replace(/^l/, "");
  const out: { skill: string; level: string; questions: ExamQuestion[] }[] = [];
  for (const [sk, def] of Object.entries(EXAM_BANK)) {
    if (skill && sk.toLowerCase() !== skill.toLowerCase()) continue;
    for (const [lvl, qs] of Object.entries(def.levels)) {
      if (wantLevel && lvl.toLowerCase() !== wantLevel) continue;
      out.push({ skill: sk, level: lvl, questions: qs });
    }
  }
  return out;
}

export interface RoleSuggestionsResult {
  roles: RoleSuggestion[];
  /** OD `ROLE_SUGGEST_COMMON`: cross-cutting items offered regardless of the matched archetype. */
  common: { responsibilities: string[]; authorities: string[] };
}

/** Fuzzy role-archetype match: rank by name/alias substring hit, then framework overlap. */
export function roleSuggestions(q?: string): RoleSuggestionsResult {
  if (!q || !q.trim()) return { roles: ROLE_SUGGESTIONS, common: ROLE_SUGGEST_COMMON };
  const s = q.toLowerCase();
  const scored = ROLE_SUGGESTIONS.map((r) => {
    const hay = [r.name, ...r.aliases].map((x) => x.toLowerCase());
    let score = 0;
    if (hay.some((h) => h === s)) score += 3;
    else if (hay.some((h) => h.includes(s) || s.includes(h))) score += 2;
    if (r.description.toLowerCase().includes(s)) score += 1;
    return { r, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return { roles: scored.map((x) => x.r), common: ROLE_SUGGEST_COMMON };
}

/** OD `SKILL_TOPICS` (app.html:34022) — the canonical, ordered topic list
 * the Competence Library groups skills under (OD `clibSkills()`, 17862-17868).
 * Each skill's own topic is served pre-computed on `GET /competence/skills`
 * (via `skillTopic`) so the frontend doesn't re-implement the classifier. */
export function skillTopics(): readonly string[] {
  return SKILL_TOPICS;
}
