/**
 * Reference datasets served read-only (decision R7 — never bundled into the FE).
 *
 * NOTE: the legacy `js/*.js` source datasets (ISIC 766, NACE 996, KBLI ~2442,
 * ISCED-F 116, exam-bank ~1194, role-suggestions 23) were not available in this
 * repo, so these are REPRESENTATIVE subsets with the correct schema + cross-refs.
 * Drop the full source arrays in here (same shape) to reach legacy counts —
 * the module, endpoints and FE loaders already handle any volume.
 */

import { ISIC as ISIC_RAW } from "./data/isic";
import { NACE as NACE_RAW } from "./data/nace";
import { KBLI as KBLI_RAW } from "./data/kbli";
import { ISCEDF as ISCEDF_RAW } from "./data/iscedf";
import { ISIC_NOTES as ISIC_NOTES_RAW } from "./data/isicNotes";
import { NACE_NOTES as NACE_NOTES_RAW } from "./data/naceNotes";
import { KBLI_NOTES as KBLI_NOTES_RAW } from "./data/kbliNotes";

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

// --- Exam bank (competence written exams; sample) ---------------------------
export interface ExamQuestion { t: string; q: string; o: string[]; a: number; m: number; p: number; ref: string }
export const EXAM_BANK: Record<string, { levels: Record<string, ExamQuestion[]> }> = {
  "Internal Auditing": {
    levels: {
      L1: [
        { t: "mcq", q: "What is the primary purpose of an internal audit?", o: ["To assign blame", "To verify conformity and effectiveness", "To replace management review", "To market the company"], a: 1, m: 10, p: 70, ref: "ISO 19011" },
        { t: "mcq", q: "Audit evidence should be:", o: ["Anecdotal", "Verifiable", "Confidential only", "Optional"], a: 1, m: 10, p: 70, ref: "ISO 19011 6.4" },
      ],
      L2: [
        { t: "mcq", q: "A nonconformity is best described as:", o: ["An opportunity", "Non-fulfilment of a requirement", "A compliment", "A risk score"], a: 1, m: 10, p: 70, ref: "ISO 9000 3.6.9" },
      ],
    },
  },
  "Risk Management": {
    levels: {
      L1: [
        { t: "mcq", q: "Risk is the effect of uncertainty on:", o: ["Profits only", "Objectives", "Employees", "Suppliers"], a: 1, m: 10, p: 70, ref: "ISO 31000" },
      ],
    },
  },
};

// --- Role suggestions (autofill archetypes) ---------------------------------
export interface RoleSuggestion { name: string; aliases: string[]; frameworks: string[]; description: string; responsibilities: string[]; authorities: string[] }
export const ROLE_SUGGESTIONS: RoleSuggestion[] = [
  { name: "Quality Manager", aliases: ["QA Manager", "Quality Assurance Manager"], frameworks: ["ISO 9001:2015"], description: "Owns the quality management system.", responsibilities: ["Maintain the QMS", "Plan internal audits", "Drive continual improvement"], authorities: ["Approve quality procedures", "Halt nonconforming output"] },
  { name: "Information Security Manager", aliases: ["CISO", "ISM", "Security Manager"], frameworks: ["ISO/IEC 27001:2022"], description: "Owns the information security management system.", responsibilities: ["Maintain the ISMS", "Manage risk treatment", "Coordinate incident response"], authorities: ["Approve security controls", "Grant/revoke access"] },
  { name: "Environmental Manager", aliases: ["EHS Manager", "Sustainability Manager"], frameworks: ["ISO 14001:2015"], description: "Owns the environmental management system.", responsibilities: ["Track environmental aspects", "Ensure legal compliance", "Set environmental objectives"], authorities: ["Approve environmental procedures"] },
  { name: "Health & Safety Officer", aliases: ["OHS Officer", "Safety Officer"], frameworks: ["ISO 45001:2018"], description: "Owns occupational health & safety.", responsibilities: ["Assess OH&S risks", "Investigate incidents", "Run safety training"], authorities: ["Stop unsafe work"] },
  { name: "Internal Auditor", aliases: ["Auditor", "Lead Auditor"], frameworks: ["ISO 9001:2015", "ISO/IEC 27001:2022"], description: "Conducts independent internal audits.", responsibilities: ["Plan and perform audits", "Report findings", "Verify corrective actions"], authorities: ["Access records and areas in scope"] },
];
