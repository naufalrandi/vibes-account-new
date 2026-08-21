// GENERATED FILE — do not edit by hand.
// Extracted programmatically from the OD prototype (fe-vibes-new-od/app.html:17175-17267,
// ISRA_ANNEXA — the 93-row ISO/IEC 27002:2022 Annex A control master) by evaluating OD's
// own array literal in Node, then applying OD's own P/D/C default-profile derivation
// (app.html:18140, isra2DefProfile — OD has no explicit fnP/fnD/fnC/dedL/dedC on this array;
// every row falls through to the type-based default: Detective -> {fnD,dedL,dedC},
// Corrective -> {fnC,dedC}, everything else (Directive/Preventive) -> {fnP,dedL}).
// OD's ISRA_ANNEXA carries no description field either — `description` is null for all 93
// rows, matching the source verbatim rather than inventing text.
// Regenerate from app.html if OD's Annex A list changes.

export interface IsraAnnexASeedRow {
  ref: string;
  name: string;
  category: string;
  csf: string;
  type: string;
  fnP: boolean;
  fnD: boolean;
  fnC: boolean;
  dedL: boolean;
  dedC: boolean;
}

export const ISRA_ANNEXA_SEED: readonly IsraAnnexASeedRow[] = [
  { ref: "A.5.1", name: "Policies for information security", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.2", name: "Information security roles and responsibilities", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.3", name: "Segregation of duties", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.4", name: "Management responsibilities", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.5", name: "Contact with authorities", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.6", name: "Contact with special interest groups", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.7", name: "Threat intelligence", category: "Organizational", csf: "Detect", type: "Detective", fnP: false, fnD: true, fnC: false, dedL: true, dedC: true },
  { ref: "A.5.8", name: "Information security in project management", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.9", name: "Inventory of information and other associated assets", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.10", name: "Acceptable use of information and other associated assets", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.11", name: "Return of assets", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.12", name: "Classification of information", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.13", name: "Labelling of information", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.14", name: "Information transfer", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.15", name: "Access control", category: "Organizational", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.16", name: "Identity management", category: "Organizational", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.17", name: "Authentication information", category: "Organizational", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.18", name: "Access rights", category: "Organizational", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.19", name: "Information security in supplier relationships", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.20", name: "Addressing information security within supplier agreements", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.21", name: "Managing information security in the ICT supply chain", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.22", name: "Monitoring, review and change management of supplier services", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.23", name: "Information security for use of cloud services", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.24", name: "Information security incident management planning and preparation", category: "Organizational", csf: "Respond", type: "Corrective", fnP: false, fnD: false, fnC: true, dedL: false, dedC: true },
  { ref: "A.5.25", name: "Assessment and decision on information security events", category: "Organizational", csf: "Detect", type: "Detective", fnP: false, fnD: true, fnC: false, dedL: true, dedC: true },
  { ref: "A.5.26", name: "Response to information security incidents", category: "Organizational", csf: "Respond", type: "Corrective", fnP: false, fnD: false, fnC: true, dedL: false, dedC: true },
  { ref: "A.5.27", name: "Learning from information security incidents", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.28", name: "Collection of evidence", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.29", name: "Information security during disruption", category: "Organizational", csf: "Recover", type: "Corrective", fnP: false, fnD: false, fnC: true, dedL: false, dedC: true },
  { ref: "A.5.30", name: "ICT readiness for business continuity", category: "Organizational", csf: "Recover", type: "Corrective", fnP: false, fnD: false, fnC: true, dedL: false, dedC: true },
  { ref: "A.5.31", name: "Legal, statutory, regulatory and contractual requirements", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.32", name: "Intellectual property rights", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.33", name: "Protection of records", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.34", name: "Privacy and protection of PII", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.35", name: "Independent review of information security", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.36", name: "Compliance with policies, rules and standards for information security", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.5.37", name: "Documented operating procedures", category: "Organizational", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.6.1", name: "Screening", category: "People", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.6.2", name: "Terms and conditions of employment", category: "People", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.6.3", name: "Information security awareness, education and training", category: "People", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.6.4", name: "Disciplinary process", category: "People", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.6.5", name: "Responsibilities after termination or change of employment", category: "People", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.6.6", name: "Confidentiality or non-disclosure agreements", category: "People", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.6.7", name: "Remote working", category: "People", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.6.8", name: "Information security event reporting", category: "People", csf: "Respond", type: "Corrective", fnP: false, fnD: false, fnC: true, dedL: false, dedC: true },
  { ref: "A.7.1", name: "Physical security perimeters", category: "Physical", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.2", name: "Physical entry", category: "Physical", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.3", name: "Securing offices, rooms and facilities", category: "Physical", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.4", name: "Physical security monitoring", category: "Physical", csf: "Detect", type: "Detective", fnP: false, fnD: true, fnC: false, dedL: true, dedC: true },
  { ref: "A.7.5", name: "Protecting against physical and environmental threats", category: "Physical", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.6", name: "Working in secure areas", category: "Physical", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.7", name: "Clear desk and clear screen", category: "Physical", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.8", name: "Equipment siting and protection", category: "Physical", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.9", name: "Security of assets off-premises", category: "Physical", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.10", name: "Storage media", category: "Physical", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.11", name: "Supporting utilities", category: "Physical", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.12", name: "Cabling security", category: "Physical", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.13", name: "Equipment maintenance", category: "Physical", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.7.14", name: "Secure disposal or reuse of equipment", category: "Physical", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.1", name: "User endpoint devices", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.2", name: "Privileged access rights", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.3", name: "Information access restriction", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.4", name: "Access to source code", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.5", name: "Secure authentication", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.6", name: "Capacity management", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.7", name: "Protection against malware", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.8", name: "Management of technical vulnerabilities", category: "Technological", csf: "Respond", type: "Corrective", fnP: false, fnD: false, fnC: true, dedL: false, dedC: true },
  { ref: "A.8.9", name: "Configuration management", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.10", name: "Information deletion", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.11", name: "Data masking", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.12", name: "Data leakage prevention", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.13", name: "Information backup", category: "Technological", csf: "Recover", type: "Corrective", fnP: false, fnD: false, fnC: true, dedL: false, dedC: true },
  { ref: "A.8.14", name: "Redundancy of information processing facilities", category: "Technological", csf: "Recover", type: "Corrective", fnP: false, fnD: false, fnC: true, dedL: false, dedC: true },
  { ref: "A.8.15", name: "Logging", category: "Technological", csf: "Detect", type: "Detective", fnP: false, fnD: true, fnC: false, dedL: true, dedC: true },
  { ref: "A.8.16", name: "Monitoring activities", category: "Technological", csf: "Detect", type: "Detective", fnP: false, fnD: true, fnC: false, dedL: true, dedC: true },
  { ref: "A.8.17", name: "Clock synchronization", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.18", name: "Use of privileged utility programs", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.19", name: "Installation of software on operational systems", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.20", name: "Network security", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.21", name: "Security of network services", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.22", name: "Segregation of networks", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.23", name: "Web filtering", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.24", name: "Use of cryptography", category: "Technological", csf: "Protect", type: "Preventive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.25", name: "Secure development life cycle", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.26", name: "Application security requirements", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.27", name: "Secure system architecture and engineering principles", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.28", name: "Secure coding", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.29", name: "Security testing in development and acceptance", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.30", name: "Outsourced development", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.31", name: "Separation of development, test and production environments", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.32", name: "Change management", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.33", name: "Test information", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
  { ref: "A.8.34", name: "Protection of information systems during audit testing", category: "Technological", csf: "Identify", type: "Directive", fnP: true, fnD: false, fnC: false, dedL: true, dedC: false },
];
