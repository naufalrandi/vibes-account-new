/**
 * Reference datasets served read-only (decision R7 — never bundled into the FE).
 *
 * NOTE: the legacy `js/*.js` source datasets (ISIC 766, NACE 996, KBLI ~2442,
 * ISCED-F 116, exam-bank ~1194, role-suggestions 23) were not available in this
 * repo, so these are REPRESENTATIVE subsets with the correct schema + cross-refs.
 * Drop the full source arrays in here (same shape) to reach legacy counts —
 * the module, endpoints and FE loaders already handle any volume.
 */

export interface HierNode { code: string; label: string; level: number; parent: string | null; isic?: string }
export interface Note { i: string; e: string } // includes / excludes

// --- ISIC Rev.4 (21 sections + sample divisions) ----------------------------
export const ISIC: HierNode[] = [
  { code: "A", label: "Agriculture, forestry and fishing", level: 1, parent: null },
  { code: "B", label: "Mining and quarrying", level: 1, parent: null },
  { code: "C", label: "Manufacturing", level: 1, parent: null },
  { code: "D", label: "Electricity, gas, steam and air conditioning supply", level: 1, parent: null },
  { code: "E", label: "Water supply; sewerage, waste management and remediation", level: 1, parent: null },
  { code: "F", label: "Construction", level: 1, parent: null },
  { code: "G", label: "Wholesale and retail trade; repair of motor vehicles", level: 1, parent: null },
  { code: "H", label: "Transportation and storage", level: 1, parent: null },
  { code: "I", label: "Accommodation and food service activities", level: 1, parent: null },
  { code: "J", label: "Information and communication", level: 1, parent: null },
  { code: "K", label: "Financial and insurance activities", level: 1, parent: null },
  { code: "L", label: "Real estate activities", level: 1, parent: null },
  { code: "M", label: "Professional, scientific and technical activities", level: 1, parent: null },
  { code: "N", label: "Administrative and support service activities", level: 1, parent: null },
  { code: "O", label: "Public administration and defence", level: 1, parent: null },
  { code: "P", label: "Education", level: 1, parent: null },
  { code: "Q", label: "Human health and social work activities", level: 1, parent: null },
  { code: "R", label: "Arts, entertainment and recreation", level: 1, parent: null },
  { code: "S", label: "Other service activities", level: 1, parent: null },
  { code: "T", label: "Activities of households as employers", level: 1, parent: null },
  { code: "U", label: "Activities of extraterritorial organizations and bodies", level: 1, parent: null },
  // Sample divisions.
  { code: "10", label: "Manufacture of food products", level: 2, parent: "C" },
  { code: "26", label: "Manufacture of computer, electronic and optical products", level: 2, parent: "C" },
  { code: "62", label: "Computer programming, consultancy and related activities", level: 2, parent: "J" },
  { code: "63", label: "Information service activities", level: 2, parent: "J" },
];

export const ISIC_NOTES: Record<string, Note> = {
  C: { i: "Physical or chemical transformation of materials into new products.", e: "Excludes construction (section F)." },
  "62": { i: "Writing, modifying and testing software; consultancy.", e: "Excludes packaged software publishing (division 58)." },
};

// --- NACE Rev.2 (EU, cross-ref ISIC) ----------------------------------------
export const NACE: HierNode[] = [
  { code: "C", label: "Manufacturing", level: 1, parent: null, isic: "C" },
  { code: "J", label: "Information and communication", level: 1, parent: null, isic: "J" },
  { code: "62", label: "Computer programming, consultancy and related activities", level: 2, parent: "J", isic: "62" },
];
export const NACE_NOTES: Record<string, Note> = {
  "62": { i: "Provision of expertise in information technologies.", e: "Excludes hardware repair." },
};

// --- KBLI 2015 (Indonesia, cross-ref ISIC) ----------------------------------
export const KBLI: HierNode[] = [
  { code: "C", label: "Industri Pengolahan", level: 1, parent: null, isic: "C" },
  { code: "J", label: "Informasi dan Komunikasi", level: 1, parent: null, isic: "J" },
  { code: "62010", label: "Aktivitas Pemrograman Komputer", level: 2, parent: "J", isic: "62" },
];
export const KBLI_NOTES: Record<string, string> = {
  "62010": "Mencakup penulisan, modifikasi, dan pengujian perangkat lunak.",
};

// --- ISCED-F 2013 broad fields ----------------------------------------------
export const ISCEDF: HierNode[] = [
  { code: "00", label: "Generic programmes and qualifications", level: 1, parent: null },
  { code: "01", label: "Education", level: 1, parent: null },
  { code: "02", label: "Arts and humanities", level: 1, parent: null },
  { code: "03", label: "Social sciences, journalism and information", level: 1, parent: null },
  { code: "04", label: "Business, administration and law", level: 1, parent: null },
  { code: "05", label: "Natural sciences, mathematics and statistics", level: 1, parent: null },
  { code: "06", label: "Information and Communication Technologies (ICTs)", level: 1, parent: null },
  { code: "07", label: "Engineering, manufacturing and construction", level: 1, parent: null },
  { code: "08", label: "Agriculture, forestry, fisheries and veterinary", level: 1, parent: null },
  { code: "09", label: "Health and welfare", level: 1, parent: null },
  { code: "10", label: "Services", level: 1, parent: null },
];

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
