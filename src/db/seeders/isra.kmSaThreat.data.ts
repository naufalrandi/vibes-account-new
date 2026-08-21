// GENERATED FILE — do not edit by hand.
// RE-DERIVED (not a straight port — no hand-authored V2 dataset exists anywhere in this
// repo or in OD; see docs/isra-schema-design.md §1.2/§4 F-2b). OD's own migration
// (_israSaTaxonV1, fe-vibes-new-od/app.html:20889-20907) builds its LIVE V2 SA-subgroup ->
// Threat knowledge map by resolving every legacy V1 ISRA_KM_SATHREAT row's flat
// (saType, saSubtype) key through ISRA_SA_OLD2NEW (app.html:21848-21868) to a Sub-group id
// (SSG-...), then unions all V1 rows that land on the same (subgroupId, threat) pair,
// recording every distinct contributing v1 subtype as `sources` (OD's own provenance field)
// This file reproduces that exact algorithm against OD's own source arrays:
//   1. resolve(subtype, type): ISRA_SA_OLD2NEW[subtype] ?? ISRA_SA_OLD2NEW[type]; a string
//      value is the target Sub-group id; an object value ({review:true,...}) or a missing
//      key means "no confident mapping" -> the v1 row is DROPPED, never guessed (OD's own
//      rule — see the 4 ambiguous v1 subtypes below).
//   2. group by (subgroupId, threat); sources = the sorted distinct v1 subtypes that fed it.
//   3. groupId is read from ISRA_SA_TAXONOMY (app.html:21786-21847) for that Sub-group.
//   4. threatId resolves the v1 row's free-text threat name against isra.threatLibrary.data.ts
//      (case-insensitive, trimmed) — 80/80 V1 rows that survive step 1 resolve cleanly, 0 misses.
//
// Of OD's 80 V1 ISRA_KM_SATHREAT rows, 19 do not resolve to a single confident Sub-group and
// are correctly EXCLUDED here, exactly as OD's own migration excludes them (never falls back
// to a guess): all 5 "Document Repository" rows (SSG-020 app / SSG-029 storage / SSG-035
// cloud-storage — ambiguous), all 5 "File Transfer Service" rows (SSG-025 vs SSG-039), all 4
// "Secrets Store" rows (SSG-024 vs DBMS-adjacent), all 5 "Backup Storage" rows (SSG-029 vs
// SSG-030 vs SSG-035). This yields the 56 rows below (KST2-0001..0056) covering 6 Sub-groups:
// SSG-011, SSG-020, SSG-021, SSG-023, SSG-025, SSG-026.
//
// Regenerate from app.html if OD's V1 knowledge map or Group/Subgroup taxonomy changes.

export interface IsraKmSaThreatSeedRow {
  id: string;
  subgroupId: string;
  groupId: string;
  threatId: string;
  sources: readonly string[];
}

export const ISRA_KM_SA_THREAT_SEED: readonly IsraKmSaThreatSeedRow[] = [
  { id: "KST2-0001", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0002", sources: ["HR System","Public Web Application","SaaS Business Application"] },
  { id: "KST2-0002", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0005", sources: ["Public Web Application"] },
  { id: "KST2-0003", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0011", sources: ["Public Web Application"] },
  { id: "KST2-0004", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0010", sources: ["Public Web Application"] },
  { id: "KST2-0005", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0039", sources: ["Public Web Application"] },
  { id: "KST2-0006", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0003", sources: ["Public Web Application"] },
  { id: "KST2-0007", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0022", sources: ["HR System","SaaS Business Application"] },
  { id: "KST2-0008", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0024", sources: ["SaaS Business Application"] },
  { id: "KST2-0009", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0210", sources: ["Payroll System","SaaS Business Application"] },
  { id: "KST2-0010", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0025", sources: ["SaaS Business Application"] },
  { id: "KST2-0011", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0026", sources: ["HR System"] },
  { id: "KST2-0012", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0008", sources: ["HR System"] },
  { id: "KST2-0013", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0303", sources: ["HR System"] },
  { id: "KST2-0014", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0001", sources: ["Payroll System"] },
  { id: "KST2-0015", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0239", sources: ["Payroll System"] },
  { id: "KST2-0016", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0235", sources: ["Payroll System"] },
  { id: "KST2-0017", subgroupId: "SSG-020", groupId: "SAG-007", threatId: "THR-0241", sources: ["Payroll System"] },
  { id: "KST2-0018", subgroupId: "SSG-023", groupId: "SAG-007", threatId: "THR-0001", sources: ["Relational Database"] },
  { id: "KST2-0019", subgroupId: "SSG-023", groupId: "SAG-007", threatId: "THR-0091", sources: ["Relational Database"] },
  { id: "KST2-0020", subgroupId: "SSG-023", groupId: "SAG-007", threatId: "THR-0019", sources: ["Relational Database"] },
  { id: "KST2-0021", subgroupId: "SSG-023", groupId: "SAG-007", threatId: "THR-0026", sources: ["Relational Database"] },
  { id: "KST2-0022", subgroupId: "SSG-023", groupId: "SAG-007", threatId: "THR-0020", sources: ["Relational Database"] },
  { id: "KST2-0023", subgroupId: "SSG-023", groupId: "SAG-007", threatId: "THR-0014", sources: ["Managed Database Service"] },
  { id: "KST2-0024", subgroupId: "SSG-023", groupId: "SAG-007", threatId: "THR-0128", sources: ["Managed Database Service"] },
  { id: "KST2-0025", subgroupId: "SSG-023", groupId: "SAG-007", threatId: "THR-0093", sources: ["Managed Database Service"] },
  { id: "KST2-0026", subgroupId: "SSG-023", groupId: "SAG-007", threatId: "THR-0118", sources: ["Managed Database Service"] },
  { id: "KST2-0027", subgroupId: "SSG-023", groupId: "SAG-007", threatId: "THR-0058", sources: ["Managed Database Service"] },
  { id: "KST2-0028", subgroupId: "SSG-025", groupId: "SAG-007", threatId: "THR-0038", sources: ["Integration API"] },
  { id: "KST2-0029", subgroupId: "SSG-025", groupId: "SAG-007", threatId: "THR-0073", sources: ["Integration API"] },
  { id: "KST2-0030", subgroupId: "SSG-025", groupId: "SAG-007", threatId: "THR-0019", sources: ["Integration API"] },
  { id: "KST2-0031", subgroupId: "SSG-025", groupId: "SAG-007", threatId: "THR-0021", sources: ["Integration API"] },
  { id: "KST2-0032", subgroupId: "SSG-025", groupId: "SAG-007", threatId: "THR-0012", sources: ["Integration API"] },
  { id: "KST2-0033", subgroupId: "SSG-025", groupId: "SAG-007", threatId: "THR-0254", sources: ["Integration API"] },
  { id: "KST2-0034", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0151", sources: ["Source Code Repository"] },
  { id: "KST2-0035", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0150", sources: ["Source Code Repository"] },
  { id: "KST2-0036", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0002", sources: ["Source Code Repository"] },
  { id: "KST2-0037", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0163", sources: ["Source Code Repository"] },
  { id: "KST2-0038", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0001", sources: ["Artifact Repository","Source Code Repository"] },
  { id: "KST2-0039", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0154", sources: ["CI/CD Pipeline"] },
  { id: "KST2-0040", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0160", sources: ["CI/CD Pipeline"] },
  { id: "KST2-0041", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0157", sources: ["CI/CD Pipeline"] },
  { id: "KST2-0042", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0167", sources: ["CI/CD Pipeline"] },
  { id: "KST2-0043", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0041", sources: ["CI/CD Pipeline"] },
  { id: "KST2-0044", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0155", sources: ["Artifact Repository"] },
  { id: "KST2-0045", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0023", sources: ["Artifact Repository"] },
  { id: "KST2-0046", subgroupId: "SSG-026", groupId: "SAG-007", threatId: "THR-0171", sources: ["Artifact Repository"] },
  { id: "KST2-0047", subgroupId: "SSG-011", groupId: "SAG-004", threatId: "THR-0004", sources: ["Endpoint Workstation"] },
  { id: "KST2-0048", subgroupId: "SSG-011", groupId: "SAG-004", threatId: "THR-0057", sources: ["Endpoint Workstation"] },
  { id: "KST2-0049", subgroupId: "SSG-011", groupId: "SAG-004", threatId: "THR-0150", sources: ["Endpoint Workstation"] },
  { id: "KST2-0050", subgroupId: "SSG-011", groupId: "SAG-004", threatId: "THR-0266", sources: ["Endpoint Workstation"] },
  { id: "KST2-0051", subgroupId: "SSG-011", groupId: "SAG-004", threatId: "THR-0180", sources: ["Endpoint Workstation"] },
  { id: "KST2-0052", subgroupId: "SSG-021", groupId: "SAG-007", threatId: "THR-0039", sources: ["Application Backend"] },
  { id: "KST2-0053", subgroupId: "SSG-021", groupId: "SAG-007", threatId: "THR-0010", sources: ["Application Backend"] },
  { id: "KST2-0054", subgroupId: "SSG-021", groupId: "SAG-007", threatId: "THR-0040", sources: ["Application Backend"] },
  { id: "KST2-0055", subgroupId: "SSG-021", groupId: "SAG-007", threatId: "THR-0037", sources: ["Application Backend"] },
  { id: "KST2-0056", subgroupId: "SSG-021", groupId: "SAG-007", threatId: "THR-0020", sources: ["Application Backend"] },
];
