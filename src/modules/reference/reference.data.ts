/**
 * Reference datasets served read-only (decision R7 — never bundled into the FE).
 *
 * ISIC/NACE/KBLI/ISCED-F + notes, exam-bank, and role-suggestions are all
 * generated from the OD legacy `js/*.js` sources into ./data/* (see the
 * header comment of each generated file for the source path and schema).
 * Served read-only, BE-only (never bundled to the FE — decision R7).
 */

import { ISIC as ISIC_RAW } from "./data/isic";
import { NACE as NACE_RAW } from "./data/nace";
import { KBLI as KBLI_RAW } from "./data/kbli";
import { ISCEDF as ISCEDF_RAW } from "./data/iscedf";
import { ISIC_NOTES as ISIC_NOTES_RAW } from "./data/isicNotes";
import { NACE_NOTES as NACE_NOTES_RAW } from "./data/naceNotes";
import { KBLI_NOTES as KBLI_NOTES_RAW } from "./data/kbliNotes";
import { EXAM_BANK as EXAM_BANK_RAW, type ExamBankQuestion, type ExamBankSkill } from "./data/examBank";
import { ROLE_SUGGESTIONS as ROLE_SUGGESTIONS_RAW, ROLE_SUGGEST_COMMON as ROLE_SUGGEST_COMMON_RAW, type RoleSuggestionEntry } from "./data/roleSuggestions";

export interface HierNode { code: string; label: string; level: number; parent: string | null; isic?: string }
export interface Note { i?: string; e?: string } // includes / excludes (either may be absent)

// Full OD reference datasets generated from the legacy js/ sources into ./data/*
// (ISIC 766, NACE 996, KBLI 2443, ISCED-F 116, + explanatory notes). Served
// read-only, BE-only (never bundled to the FE — decision R7).
export const ISIC: HierNode[] = ISIC_RAW;
export const ISIC_NOTES: Record<string, Note> = ISIC_NOTES_RAW;
export const NACE: HierNode[] = NACE_RAW;
export const NACE_NOTES: Record<string, Note> = NACE_NOTES_RAW;
export const KBLI: HierNode[] = KBLI_RAW;
export const KBLI_NOTES: Record<string, string> = KBLI_NOTES_RAW;
export const ISCEDF: HierNode[] = ISCEDF_RAW;

// --- Exam bank (competence written exams; full OD volume) -------------------
// OD schema preserved verbatim (see ./data/examBank.ts): levels keyed
// "1"/"2"/"3"; question = {t,q,o:[[text,correct]],a,m,p,ref}. 15 skills,
// 1,194 questions.
export type ExamQuestion = ExamBankQuestion;
export const EXAM_BANK: Record<string, ExamBankSkill> = EXAM_BANK_RAW;

// --- Role suggestions (autofill archetypes; full OD volume) -----------------
// OD schema preserved verbatim (see ./data/roleSuggestions.ts): 23 curated
// archetypes + a cross-cutting common pool merged in after any template match.
export type RoleSuggestion = RoleSuggestionEntry;
export const ROLE_SUGGESTIONS: RoleSuggestion[] = ROLE_SUGGESTIONS_RAW;
export const ROLE_SUGGEST_COMMON: { responsibilities: string[]; authorities: string[] } = ROLE_SUGGEST_COMMON_RAW;
