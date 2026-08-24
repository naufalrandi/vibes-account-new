/**
 * Competence skill library + training catalog + topic classifier — OD
 * `compSkillLib()` (index.html:13409-13441), the live seeding path inside
 * `rolesInit()` (index.html:16740-16762 — `db.compSkills` base 8 + top-up via
 * `compSkillLib()`/`compSkillDesc`, `db.compTraining` 6 standards x 3 tiers +
 * 3 fixed courses via `trainDesc`), and the topic classifier
 * (`SKILL_TOPICS`/`skillTopic`, index.html:17834-17866).
 *
 * `SKILL_LIBRARY_HARD`/`SKILL_LIBRARY_SOFT` are `compSkillLib()`'s HARD+HARD2
 * / SOFT+SOFT2 arrays, concatenated and case-insensitively de-duplicated
 * exactly as OD does (172 unique hard names, 116 unique soft names). Ported
 * verbatim — do not paraphrase, invent, or drop any entry.
 *
 * This is the *live* competence-skill seed path: OD's `db.compSkills` (lower-
 * case `type: 'hard'/'soft'`, no `category` field) — not the older, unrelated
 * `db.skills`/`compSeedIfNeeded`/`compTopUpSkills` path (index.html:13437-
 * 13460, `type: 'Hard Skill'/'Soft Skill'` + a `category` field), which this
 * backend's `CompetenceSkill` model (`SKILL_TYPES = ["hard","soft"]`, no
 * `category` column) does not mirror and was never wired to.
 */

export interface BaseSkillSeed { name: string; type: "hard" | "soft"; methods: string[] }

/** OD `db.compSkills` base 8 (index.html:16741-16750, sk1..sk8) — seeded
 * before the `compSkillLib()` top-up, exactly as OD does. */
export const BASE_SKILLS: readonly BaseSkillSeed[] = [
  { name: "Internal Auditing", type: "hard", methods: ["Written exam", "Practical assessment"] },
  { name: "Risk Assessment", type: "hard", methods: ["Written exam", "Portfolio review"] },
  { name: "Statistical Process Control", type: "hard", methods: ["Written exam"] },
  { name: "Technical Report Writing", type: "hard", methods: ["Portfolio review"] },
  { name: "Communication", type: "soft", methods: ["Interview", "Observation"] },
  { name: "Leadership", type: "soft", methods: ["Interview", "Observation"] },
  { name: "Problem Solving", type: "soft", methods: ["Interview", "Practical assessment"] },
  { name: "Stakeholder Management", type: "soft", methods: ["Interview"] },
];

/** OD `compSkillLib()` HARD+HARD2, de-duplicated case-insensitively (172). */
export const SKILL_LIBRARY_HARD: readonly string[] = [
  "Audit planning", "Audit interviewing", "Audit evidence sampling",
  "Audit reporting", "Nonconformity writing", "Root cause analysis",
  "Corrective action planning", "ISO 9001 interpretation", "ISO 14001 interpretation",
  "ISO 45001 interpretation", "ISO/IEC 27001 interpretation", "ISO/IEC 27701 interpretation",
  "ISO 22301 interpretation", "Compliance obligation evaluation", "Legal register maintenance",
  "Risk assessment", "Risk treatment planning", "Control effectiveness review",
  "Document control", "Record management", "Procedure writing",
  "Policy drafting", "Process mapping", "KPI monitoring",
  "Management review preparation", "Supplier evaluation", "Customer feedback analysis",
  "Incident handling", "Information asset identification", "Access control management",
  "Vulnerability management", "Backup management", "Business continuity planning",
  "Privacy impact assessment", "Data mapping", "Data retention management",
  "Training needs analysis", "Competence assessment", "Change management",
  "Internal communication planning", "Operational control review", "Evidence management",
  "Project management", "Stakeholder analysis", "Problem solving methods",
  "Statistical analysis", "Data analysis", "System administration",
  "Cloud security basics", "SaaS administration", "Log review",
  "Security monitoring", "Asset inventory management", "Configuration management",
  "Service desk management", "Customer complaint handling", "Supplier performance monitoring",
  "Environmental aspect identification", "Hazard identification", "Emergency preparedness planning",
  "Audit programme management", "Audit checklist development", "Remote auditing",
  "Audit follow-up", "Audit finding classification", "Supplier (second-party) auditing",
  "Witness auditing", "Opening and closing meetings", "Corrective action verification",
  "Audit sampling design", "Audit evidence evaluation", "Nonconformity grading",
  "Audit report review", "Certification readiness assessment", "Audit nonconformity root cause analysis",
  "Network security", "Endpoint security management", "Identity and access governance",
  "Privileged access management", "Encryption key management", "Security incident response",
  "Threat intelligence analysis", "Penetration test coordination", "Firewall configuration review",
  "Patch management", "Data classification", "Data loss prevention",
  "Cloud security architecture", "Secure software development", "SIEM administration",
  "Security metrics reporting", "Mobile device management", "Email security",
  "Physical access control", "Vulnerability remediation", "Security log analysis",
  "Access recertification", "Privacy by design", "Data subject request handling",
  "Records of processing maintenance", "Security awareness delivery", "Risk identification",
  "Risk analysis", "Risk evaluation", "Risk register maintenance",
  "Risk appetite setting", "Risk monitoring and review", "Enterprise risk management",
  "Residual risk evaluation", "Risk criteria definition", "Risk reporting",
  "Operational risk assessment", "Supplier risk assessment", "Third-party risk management",
  "ISO 9001 implementation", "ISO 14001 implementation", "ISO 45001 implementation",
  "ISO/IEC 27001 implementation", "ISO 22301 implementation", "ISO/IEC 27701 implementation",
  "ISO 50001 interpretation", "ISO 13485 interpretation", "ISO/IEC 17025 interpretation",
  "Integrated management system coordination", "Documented information control", "Management of change",
  "Operational planning and control", "Compliance obligation register maintenance", "Legal compliance evaluation",
  "Policy deployment", "Procedure development", "Process performance review",
  "Records retention scheduling", "Management review facilitation", "Statistical process control",
  "Supplier quality management", "Procurement management", "Inventory control",
  "Calibration management", "Maintenance planning", "Production planning",
  "Customer service management", "Service level management", "Contract management",
  "Project scheduling", "Resource planning", "Budget management",
  "Performance reporting", "Continuous improvement (Kaizen)", "Lean methods",
  "Six Sigma methods", "5S workplace organization", "Value stream mapping",
  "Failure mode and effects analysis (FMEA)", "Benchmarking", "Customer satisfaction measurement",
  "Complaint resolution", "Logistics coordination", "Occupational health and safety management",
  "Environmental management", "Energy management", "Waste management",
  "Emergency response coordination", "Incident investigation", "Permit-to-work administration",
  "Contractor safety management", "Sustainability reporting", "Carbon footprint assessment",
  "Quality control inspection", "Measurement system analysis", "Capacity planning",
  "Demand forecasting",
];

/** OD `compSkillLib()` SOFT+SOFT2, de-duplicated case-insensitively (116). */
export const SKILL_LIBRARY_SOFT: readonly string[] = [
  "Communication", "Active listening", "Interviewing confidence",
  "Professional skepticism", "Objectivity", "Integrity",
  "Confidentiality awareness", "Critical thinking", "Analytical thinking",
  "Decision making", "Problem solving", "Attention to detail",
  "Time management", "Prioritization", "Accountability",
  "Adaptability", "Collaboration", "Teamwork",
  "Conflict management", "Negotiation", "Influencing",
  "Leadership", "Coaching", "Mentoring",
  "Facilitation", "Presentation skills", "Writing clarity",
  "Meeting management", "Stakeholder management", "Customer orientation",
  "Service mindset", "Learning agility", "Resilience",
  "Stress management", "Independence", "Initiative",
  "Curiosity", "Patience", "Empathy",
  "Cultural awareness", "Ethical judgment", "Follow-through",
  "Ownership", "Constructive feedback", "Openness to feedback",
  "Planning discipline", "Consistency", "Reliability",
  "Self-management", "Professional conduct", "Escalation judgment",
  "Assertiveness", "Diplomacy", "Emotional control",
  "Situational awareness", "Adaptable communication", "Facilitative leadership",
  "Trustworthiness", "Decision discipline", "Continuous improvement mindset",
  "Verbal communication", "Written communication", "Report writing",
  "Public speaking", "Questioning techniques", "Persuasion",
  "Storytelling", "Tactfulness", "Email etiquette",
  "Listening for understanding", "Conflict resolution", "Consensus building",
  "Cross-functional collaboration", "Remote collaboration", "Relationship building",
  "Delegation", "Motivating others", "Performance feedback",
  "Change leadership", "Team building", "Servant leadership",
  "Mediation", "Coaching for performance", "Giving recognition",
  "Strategic thinking", "Systems thinking", "Creative thinking",
  "Innovation mindset", "Root cause reasoning", "Judgment under pressure",
  "Decisiveness", "Tolerance for ambiguity", "Commercial awareness",
  "Business acumen", "Quality mindset", "Safety awareness",
  "Risk awareness", "Honesty", "Discretion",
  "Dependability", "Punctuality", "Receiving criticism",
  "Organization", "Goal setting", "Self-discipline",
  "Proactivity", "Perseverance", "Composure",
  "Humility", "Flexibility", "Open-mindedness",
  "Continuous learning", "Multitasking", "Networking",
  "Cultural sensitivity", "Inclusive behaviour",
];

/** Default assessment methods the top-up assigns to a library-sourced skill
 * (OD's `add` closure, index.html:16750) — distinct from a base skill's own
 * per-skill `methods` array above. */
export const DEFAULT_HARD_METHODS: readonly string[] = ["Written exam", "Practical assessment"];
export const DEFAULT_SOFT_METHODS: readonly string[] = ["Interview", "Observation"];

// --- Training catalog (OD `db.compTraining`, index.html:16751-16759) ------
export interface TrainingCourseSeed { name: string; source: "SP" | "Tenant" }

export const TRAINING_STANDARDS: readonly string[] = [
  "ISO 9001", "ISO 14001", "ISO 45001", "ISO/IEC 27001", "ISO/IEC 27701", "ISO 22301",
];
export const TRAINING_TIERS: readonly string[] = ["Awareness / Foundation", "Lead Auditor", "Lead Implementer"];

/** 6 standards x 3 tiers (18, source 'SP') + 3 fixed courses = 21 total. */
export const TRAINING_LIBRARY: readonly TrainingCourseSeed[] = [
  ...TRAINING_STANDARDS.flatMap((standard) => TRAINING_TIERS.map((tier) => ({ name: `${standard} ${tier}`, source: "SP" as const }))),
  { name: "Risk Management Fundamentals", source: "SP" },
  { name: "Data Privacy Awareness", source: "Tenant" },
  { name: "Root Cause Analysis", source: "Tenant" },
];

// --- Topic classifier (OD `SKILL_TOPICS`/`skillTopic`, index.html:17834-17866) ---
export const SKILL_TOPICS: readonly string[] = [
  "Audit & Assurance", "Standards & Compliance", "Risk Management", "Information Security & Privacy",
  "Health, Safety & Environment", "Operations & Quality", "Data & Technology", "Communication",
  "Leadership & Teamwork", "Personal Effectiveness", "Professional Conduct", "Other",
];
export type SkillTopic = (typeof SKILL_TOPICS)[number];

/** OD `skillTopic(s)` (index.html:17835-17853): keyword classifier grouping a
 * skill for the Competence Library display. `type` is OD's lowercase
 * `'hard'/'soft'` vocabulary. Ported verbatim — same regex substrings, same
 * branch order (first match wins). */
export function skillTopic(skill: { name: string; type: string }): SkillTopic {
  const n = (skill.name || "").toLowerCase();
  const has = (needles: string[]): boolean => needles.some((s) => n.includes(s));

  if (skill.type === "soft") {
    if (has(["communicat", "listen", "writing", "written", "report", "present", "public speaking", "email", "question", "storytell", "persuas", "tact", "verbal", "facilitat"])) return "Communication";
    if (has(["leader", "coach", "mentor", "deleg", "motivat", "team", "collaborat", "conflict", "negotiat", "influenc", "mediat", "consensus", "recognition", "relationship", "servant"])) return "Leadership & Teamwork";
    if (has(["integrity", "objectivity", "confidential", "skeptic", "ethical", "independen", "trust", "professional conduct", "diplomacy", "cultural", "empathy", "patience", "curiosity", "accountab", "ownership", "follow-through", "reliab", "consistency", "professional", "assertive", "escalation"])) return "Professional Conduct";
    return "Personal Effectiveness";
  }
  if (has(["audit", "nonconformity", "corrective action", "root cause", "certification", "finding", "witness", "evidence", "opening and closing", "meeting"])) return "Audit & Assurance";
  if (has(["risk"])) return "Risk Management";
  if (has(["security", "encryption", "vulnerab", "siem", "threat", "penetration", "firewall", "patch", "data classification", "data loss", "privacy", "data subject", "records of processing", "identity", "access", "endpoint", "network", "mobile device", "email security", "secure software", "log analysis", "log review", "recertification", "physical access", "information asset", "backup", "business continuity", "continuity", "disaster", "data mapping", "data retention"])) return "Information Security & Privacy";
  if (has(["hazard", "incident", "emergency", "occupational", "health and safety", "safety", "environmental", "energy", "waste", "contractor", "permit", "sustainab", "carbon", "aspect"])) return "Health, Safety & Environment";
  if (has(["statistic", "data analysis", "data science", "system administration", "cloud", "saas", "configuration", "measurement system", "six sigma", "spc"])) return "Data & Technology";
  if (has(["report writing", "technical writing", "technical report", "communication planning", "presentation"])) return "Communication";
  if (has(["iso ", "iso/iec", "management system", "documented information", "document control", "record", "management review", "policy", "procedure", "process", "compliance obligation", "obligation", "legal", "integrated management", "operational control", "control effectiveness", "control review", "change management", "management of change", "operational planning"])) return "Standards & Compliance";
  if (has(["supplier", "procurement", "inventory", "calibration", "maintenance", "production", "fmea", "lean", "5s", "value stream", "benchmark", "capacity", "demand", "logistics", "complaint", "customer", "service level", "service desk", "contract", "project", "resource", "budget", "kaizen", "quality control", "inspection", "kpi", "performance", "continuous improvement", "training needs", "competence assessment", "stakeholder", "problem solving"])) return "Operations & Quality";
  return "Other";
}

// --- Description generators (OD `compGuessCat`/`compSkillDesc`/`trainDesc`) ---

/** OD `compGuessCat(type,n)` (app.html:33986) — an internal category
 * bucket used only to pick a `compSkillDesc` template; not persisted (this
 * backend's `CompetenceSkill` has no `category` column). `type` here is OD's
 * `'Hard Skill'/'Soft Skill'` vocabulary, distinct from `skillTopic`'s
 * `'hard'/'soft'` — kept as OD wrote it since both feed different templates. */
function guessSkillCategory(type: "Hard Skill" | "Soft Skill", name: string): string {
  const n = name.toLowerCase();
  if (type === "Hard Skill") {
    if (/audit|nonconformity|root cause|corrective/.test(n)) return "Audit & Assurance";
    if (/security|access|vulnerability|backup|asset|log|configuration|cloud|privacy|data|monitoring/.test(n)) return "Information Security";
    if (/risk/.test(n)) return "Risk Management";
    if (/iso|interpret|document|record|procedure|policy|process|management review|competence|change|operational|evidence|legal|compliance|obligation/.test(n)) return "Management System";
    return "Operations";
  }
  if (/communicat|listening|present|writing|meeting|facilitat|negoti|influenc|diploma|assertive/.test(n)) return "Communication";
  if (/think|analy|decision|problem|judgment|judgement|curio|learning|situational/.test(n)) return "Cognitive";
  if (/lead|coach|mentor|stakeholder|conflict|team|collab|facilitative/.test(n)) return "Leadership & Teamwork";
  if (/integrity|object|confiden|ethic|trust|account|owner|reliab|consist|profession|independ|skeptic/.test(n)) return "Professionalism";
  return "Personal Effectiveness";
}

/** OD `compSkillDesc(name,type)` (index.html:17798-17811). `type` is the
 * backend's own lowercase `'hard'/'soft'` vocabulary (matches `CompetenceSkill.type`). */
export function skillDescription(name: string, type: "hard" | "soft"): string {
  const cat = guessSkillCategory(type === "hard" ? "Hard Skill" : "Soft Skill", name);
  const n = name;
  if (type === "hard") {
    if (cat === "Audit & Assurance") return `Carrying out ${n} to gather objective evidence and reach reliable, ISO 19011-aligned audit conclusions.`;
    if (cat === "Information Security") return `Applying ${n} to protect the confidentiality, integrity and availability of information in line with ISO/IEC 27001 controls.`;
    if (cat === "Risk Management") return `Performing ${n} to identify, evaluate and treat risk consistently against defined criteria.`;
    if (cat === "Management System") return `Applying ${n} to establish, maintain and continually improve the management system and demonstrate conformity.`;
    return `Applying ${n} to deliver consistent, efficient and compliant operational results.`;
  }
  if (cat === "Communication") return `Using ${n} to convey information clearly and build shared understanding with stakeholders.`;
  if (cat === "Leadership & Teamwork") return `Demonstrating ${n} to guide, support and collaborate with others toward shared goals.`;
  if (cat === "Cognitive") return `Applying ${n} to analyse situations and make sound, well-reasoned decisions.`;
  if (cat === "Professionalism") return `Upholding ${n} consistently to act with integrity and earn stakeholder trust.`;
  return `Practising ${n} to manage work effectively and adapt to changing demands.`;
}

/** OD `trainDesc(name)` (index.html:17813-17822). */
export function trainingDescription(name: string): string {
  name = name || "";
  const subj: Record<string, string> = {
    "ISO 9001": "quality management",
    "ISO 14001": "environmental management",
    "ISO 45001": "occupational health & safety",
    "ISO/IEC 27001": "information security management",
    "ISO/IEC 27701": "privacy information management",
    "ISO 22301": "business continuity management",
  };
  const std = Object.keys(subj)
    .filter((s) => name.indexOf(s) === 0)
    .sort((a, b) => b.length - a.length)[0];
  if (std) {
    const s = subj[std];
    if (/Awareness|Foundation/i.test(name)) return `Introductory training on ${std} (${s}) — its purpose, key concepts and core requirements — to build organization-wide awareness.`;
    if (/Lead Auditor/i.test(name)) return `Certified-level training to plan, conduct, report and follow up audits of an ${std} (${s}) management system, aligned with ISO 19011.`;
    if (/Lead Implementer/i.test(name)) return `Practitioner training to establish, implement, maintain and continually improve an ${std} (${s}) management system and prepare it for certification.`;
    return `Training on the ${std} (${s}) management system.`;
  }
  const fixed: Record<string, string> = {
    "Risk Management Fundamentals": "Foundational training on identifying, analysing, evaluating and treating risk using a structured, criteria-based approach.",
    "Data Privacy Awareness": "Awareness training on personal-data protection principles, lawful processing, data-subject rights and everyday privacy responsibilities.",
    "Root Cause Analysis": "Practical training on structured problem-solving techniques (5 Whys, fishbone, etc.) to identify and address the underlying causes of nonconformities.",
  };
  return fixed[name] || `Training course covering ${name}.`;
}
