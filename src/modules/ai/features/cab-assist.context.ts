/** Pure prompt/context builders for `cab-assist` — no DB, no AI. */
import { canIssueCertificate, type CabNcGrade } from "../../business/cabPricing";
import type { BusinessRecordView } from "../../business/business.service";
import { citeList, jsonForPrompt, redactPii, truncateForPrompt } from "./context";

export const CAB_PHASES = ["initial", "surveillance", "recertification"] as const;
export type CabPhase = (typeof CAB_PHASES)[number];

export const RECOMMENDATIONS = ["recommend", "recommend with conditions", "do not recommend"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export interface CabFindingData {
  id: string;
  audit?: string;
  clause?: string;
  grade: CabNcGrade;
  desc?: string;
  open: boolean;
  date?: string;
}

const s = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/** `data.findings[]` normalised exactly like `issueCabCertificate` reads it (missing grade → Minor). */
export function cabFindings(record: BusinessRecordView): CabFindingData[] {
  const raw = Array.isArray(record.data.findings) ? (record.data.findings as Record<string, unknown>[]) : [];
  return raw
    .filter((f) => f && typeof f === "object")
    .map((f, i) => ({
      id: s(f.id) || `F${i + 1}`,
      audit: s(f.audit) || undefined,
      clause: s(f.clause) || undefined,
      grade: (["Major", "Minor", "OFI"].includes(s(f.grade)) ? s(f.grade) : "Minor") as CabNcGrade,
      desc: s(f.desc) || undefined,
      open: !!f.open,
      date: s(f.date) || undefined,
    }));
}

export function openMajorCount(findings: CabFindingData[]): number {
  return findings.filter((f) => f.open && f.grade === "Major").length;
}

/**
 * The model's suggestion, forced by the same deterministic gate `issueCabCertificate` uses:
 * while a Major nonconformity is open the suggestion can only be "do not recommend".
 */
export function enforceRecommendation(suggested: Recommendation, findings: CabFindingData[]): Recommendation {
  return canIssueCertificate(findings) ? suggested : "do not recommend";
}

function workflowFor(record: BusinessRecordView, phase?: CabPhase): unknown {
  const wf = (record.data.workflow ?? {}) as Record<string, unknown>;
  return phase ? wf[phase] ?? {} : wf;
}

/** The stored audit data a report is written from. Only the CAB's own business data — no personal contact details. */
export function cabReportContext(record: BusinessRecordView, phase?: CabPhase): string {
  const d = record.data;
  const findings = cabFindings(record);
  const profile = {
    client: record.title,
    legalName: d.legalName, sector: d.sector, scope: d.scope, standards: d.standards,
    sites: d.sites, personnel: d.personnel, ims: d.ims, stage: record.status, scheme: d.scheme,
    leadAuditor: d.leadAuditor, cycleStart: d.cycleStart,
    complexity: d.complexity, factorScores: d.factorScores, pricing: d.pricing,
  };
  return [
    `Client record ${record.code}:\n${redactPii(jsonForPrompt(profile, 4000))}`,
    `Audit workflow (${phase ?? "all phases"}: plan / work order / report / decision):\n${redactPii(jsonForPrompt(workflowFor(record, phase), 3000))}`,
    findings.length
      ? `Findings (cite by id):\n${citeList(findings.map((f) => ({
        id: f.id,
        text: `${f.grade} ${f.open ? "OPEN" : "closed"} · ${f.audit ?? "audit n/a"} · clause ${f.clause ?? "n/a"} · ${redactPii(truncateForPrompt(f.desc ?? "", 800))}`,
      })))}`
      : "Findings: none recorded.",
    `Open major nonconformities: ${openMajorCount(findings)}.`,
  ].join("\n\n");
}

export interface RelatedWork {
  id: string;
  module: string;
  code: string;
  title: string;
  status: string;
  detail: string;
}

const norm = (v: unknown) => s(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Consultancy/service records (another group company's projects/contracts) whose client matches this CAB client's name. */
export function matchRelatedWork(record: BusinessRecordView, candidates: BusinessRecordView[]): RelatedWork[] {
  const names = [record.title, record.data.name, record.data.legalName].map(norm).filter((n) => n.length >= 3);
  if (!names.length) return [];
  return candidates
    .filter((c) => {
      const hay = [c.title, c.data.client, c.data.leadName].map(norm).join(" | ");
      return names.some((n) => hay.includes(n));
    })
    .map((c) => ({
      id: c.id, module: c.module, code: c.code, title: c.title, status: c.status,
      detail: [s(c.data.serviceName || c.data.service), s(c.data.startDate), s(c.data.endDate)].filter(Boolean).join(" · "),
    }));
}

/** Auditor → cycles they led or sat on, from the record's own workflow work orders. */
export function auditorHistory(record: BusinessRecordView): { auditor: string; roles: string[] }[] {
  const wf = (record.data.workflow ?? {}) as Record<string, { workOrder?: { leadAuditor?: string; team?: string } }>;
  const map = new Map<string, string[]>();
  const add = (name: string, role: string) => {
    const n = name.trim();
    if (!n) return;
    map.set(n, [...(map.get(n) ?? []), role]);
  };
  add(s(record.data.leadAuditor), "client lead auditor");
  for (const phase of CAB_PHASES) {
    const wo = wf[phase]?.workOrder;
    if (!wo) continue;
    add(s(wo.leadAuditor), `${phase} lead auditor`);
    for (const m of s(wo.team).split(/[,;\n]/)) add(m, `${phase} team`);
  }
  return [...map.entries()].map(([auditor, roles]) => ({ auditor, roles }));
}

export function impartialityContext(record: BusinessRecordView, related: RelatedWork[]): string {
  const history = auditorHistory(record);
  return [
    `Certification client ${record.code} "${record.title}" (stage ${record.status}), sector ${s(record.data.sector) || "n/a"}, standards ${jsonForPrompt(record.data.standards ?? [], 400)}, cycle start ${s(record.data.cycleStart) || "n/a"}, certificate ${s(record.data.certNo) || "none"}.`,
    history.length
      ? `Auditor assignments recorded for this client:\n${citeList(history.map((h, i) => ({ id: `AUD${i + 1}`, text: `${h.auditor}: ${h.roles.join(", ")}` })))}`
      : "Auditor assignments: none recorded.",
    related.length
      ? `Consultancy/service work for this client by the group (cite by id):\n${citeList(related.map((r) => ({ id: r.id, text: `${r.code} (${r.module}) ${r.title} — ${r.status}${r.detail ? ` · ${r.detail}` : ""}` })))}`
      : "Consultancy/service work for this client by the group: none found in the enterprise projects/contracts registers.",
  ].map((t) => redactPii(t)).join("\n\n");
}
