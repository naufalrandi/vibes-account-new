/**
 * Read-only tools for `ask-vibes`. Each one calls an EXISTING tenant-scoped
 * service with the caller's AuthContext and returns compact JSON whose items
 * carry a `ref` (record code) the model cites. No tool reads HR / personnel
 * data: the deadline scan's personnel, competence and commercial sources are
 * filtered out below, and no tool touches the personnel modules.
 */
import { z } from "zod";
import type { AuthContext } from "../../../lib/scope";
import { listAssessments } from "../../assessments/assessment.service";
import { ACTIONS } from "../../iam/actions.catalog";
import { listRecords, type RecordView } from "../../implementation/implementation.service";
import { listFindings } from "../../internal-audit/internalAudit.service";
import { listScenarios } from "../../isra/israScenario.service";
import { getPerfIndicators } from "../../performance-evaluation/perfEval.service";
import { listRisks } from "../../risks/risk.service";
import { addDays, isDone, scanOrg, toDay } from "../deadlines/scan";
import type { AskTool, ToolResult } from "./askVibes.loop";

export interface ToolEnv {
  auth: AuthContext;
  /** Org-local YYYY-MM-DD. */
  today: string;
}

const LIST_LIMIT = 25;
const TOP = 10;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : v == null ? undefined : String(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function countBy<T>(items: T[], key: (t: T) => unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    const k = str(key(i)) ?? "—";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Citation for an implementation-register record. */
const rec = (type: string, r: RecordView) => ({ ref: r.code, type, id: r.id, code: r.code, label: `${r.code} — ${r.title}` });

/** Deadline-scan sources this agent may show, with the permission each needs. Everything else (personnel, competence, billing, leads, approvals) is left out. */
const DEADLINE_SOURCES: Record<string, string> = {
  "documents-review": ACTIONS.MS_READ,
  "policies-review": ACTIONS.MS_READ,
  "nc-due": ACTIONS.MS_READ,
  "cap-effectiveness": ACTIONS.MS_READ,
  "capa-due": ACTIONS.MS_READ,
  "mr-action": ACTIONS.MS_READ,
  "training-due": ACTIONS.MS_READ,
  "training-reassess": ACTIONS.MS_READ,
  "supplier-requal": ACTIONS.MS_READ,
  calibration: ACTIONS.MS_READ,
  "cab-surveillance": ACTIONS.MS_READ,
  "ia-finding": ACTIONS.IAUDIT_READ,
  "ia-review": ACTIONS.IAUDIT_READ,
  "isra-review": ACTIONS.ISRA_LIBRARY_READ,
  "rtp-action": ACTIONS.ISRA_LIBRARY_READ,
};

const canRead = (auth: AuthContext, key: string) => auth.isSuperAdmin || auth.actions.includes(key);

const noArgs = z.object({}).strict();

type Tool = AskTool<ToolEnv>;

const overdueItems: Tool = {
  description: "Overdue items across nonconformities/CAPA, document & policy reviews, training, supplier requalification, calibration, audit findings, MR actions and ISRA reviews/treatment actions. Returns count by type and up to 25 items (most overdue first).",
  args: noArgs,
  permission: [ACTIONS.MS_READ, ACTIONS.IAUDIT_READ, ACTIONS.ISRA_LIBRARY_READ],
  async run(_args, { auth, today }): Promise<ToolResult> {
    const items = (await scanOrg(auth.orgId, auth.orgType, today))
      .filter((i) => i.daysLeft < 0 && DEADLINE_SOURCES[i.source] && canRead(auth, DEADLINE_SOURCES[i.source]));
    const shown = items.slice(0, LIST_LIMIT); // scanOrg sorts by due date ascending = most overdue first
    return {
      data: {
        total: items.length,
        byType: countBy(items, (i) => i.sourceLabel),
        items: shown.map((i) => ({ ref: i.code ?? i.key, type: i.sourceLabel, title: i.title, due: i.due, daysOverdue: -i.daysLeft })),
      },
      records: shown.map((i) => ({ ref: i.code ?? i.key, type: i.source, id: i.key, ...(i.code ? { code: i.code } : {}), label: i.code ? `${i.code} — ${i.title}` : i.title, link: i.link })),
    };
  },
};

const listNonconformities: Tool = {
  description: "Nonconformities with status, severity and due date. Without `status` only open ones are returned. `due_before` (YYYY-MM-DD) keeps those due before that date.",
  args: z.object({ status: z.string().max(60).optional(), due_before: z.iso.date().optional() }),
  permission: [ACTIONS.MS_READ],
  async run(args: { status?: string; due_before?: string }, { auth }) {
    const due = (r: RecordView) => toDay(r.data.due ?? obj(r.data.cap).due);
    const rows = (await listRecords(auth, "nonconformities"))
      .filter((r) => (args.status ? r.status.toLowerCase() === args.status.toLowerCase() : !isDone(r.status)))
      .filter((r) => !args.due_before || ((due(r) ?? "9999") < args.due_before))
      .sort((a, b) => (due(a) ?? "9999").localeCompare(due(b) ?? "9999"));
    const shown = rows.slice(0, LIST_LIMIT);
    return {
      data: {
        total: rows.length,
        byStatus: countBy(rows, (r) => r.status),
        items: shown.map((r) => ({ ref: r.code, title: r.title, status: r.status, severity: str(r.data.severity), due: due(r) })),
      },
      records: shown.map((r) => rec("nonconformity", r)),
    };
  },
};

const riskSummary: Tool = {
  description: "Risk register: counts of open risks by level/band and by status, and the top 10 open risks by level.",
  args: noArgs,
  permission: [ACTIONS.MS_READ],
  async run(_args, { auth }) {
    const open = (await listRisks(auth)).filter((r) => !isDone(r.status));
    const top = [...open].sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).slice(0, TOP);
    return {
      data: {
        openTotal: open.length,
        byLevel: countBy(open, (r) => r.band || "Not rated"),
        byStatus: countBy(open, (r) => r.status),
        top: top.map((r) => ({ ref: r.code, title: r.title, level: r.level, band: r.band, status: r.status, category: r.category })),
      },
      records: top.map((r) => ({ ref: r.code, type: "risk", id: r.id, code: r.code, label: `${r.code} — ${r.title}` })),
    };
  },
};

const israStatus: Tool = {
  description: "Information-security risk assessment (ISRA): scenarios by inherent risk level, risk treatment plan (RTP) status counts, and the 10 highest scenarios.",
  args: noArgs,
  permission: [ACTIONS.ISRA_LIBRARY_READ],
  async run(_args, { auth }) {
    type Scen = { id: string; code: string; title: string; status: string; inherentScore: number; inherentBand: string; rtp: { status?: string } | null };
    const scenarios = (await listScenarios(auth)) as Scen[];
    const top = [...scenarios].sort((a, b) => b.inherentScore - a.inherentScore).slice(0, TOP);
    return {
      data: {
        total: scenarios.length,
        byLevel: countBy(scenarios, (s) => s.inherentBand || "Not assessed"),
        byStatus: countBy(scenarios, (s) => s.status),
        rtpStatus: countBy(scenarios, (s) => s.rtp?.status ?? "No RTP"),
        top: top.map((s) => ({ ref: s.code, title: s.title, level: s.inherentBand || "Not assessed", score: s.inherentScore, status: s.status, rtp: s.rtp?.status ?? null })),
      },
      records: top.map((s) => ({ ref: s.code, type: "isra-scenario", id: s.id, code: s.code, label: `${s.code} — ${s.title}` })),
    };
  },
};

const gapStatus: Tool = {
  description: "Gap assessments: for each framework, the latest assessment's status, maturity score, answered questions and number of gaps.",
  args: noArgs,
  permission: [ACTIONS.ASSESSMENT_RUN_READ],
  async run(_args, { auth }) {
    const latest = new Map<string, Awaited<ReturnType<typeof listAssessments>>[number]>();
    for (const a of await listAssessments(auth)) { // newest first
      const k = a.frameworkId ?? a.frameworkName ?? a.id;
      if (!latest.has(k)) latest.set(k, a);
    }
    const rows = [...latest.values()];
    return {
      data: rows.map((a) => ({
        ref: a.code, framework: a.frameworkName, status: a.status, maturityScore: a.maturityScore,
        answered: `${a.answeredCount}/${a.questionCount}`, gaps: a.gapCount, completed: toDay(a.completedAt),
      })),
      records: rows.map((a) => ({ ref: a.code, type: "assessment", id: a.id, code: a.code, label: `${a.code} — ${a.frameworkName ?? a.title}` })),
    };
  },
};

const PERIOD_DAYS: Record<string, number> = { last_30_days: 30, last_90_days: 90, last_12_months: 365 };

const auditFindings: Tool = {
  description: "Internal audit findings raised in a period: counts by type and by status, and the open findings.",
  args: z.object({ period: z.enum(["last_30_days", "last_90_days", "last_12_months", "all"]).default("all") }),
  permission: [ACTIONS.IAUDIT_READ],
  async run(args: { period: string }, { auth, today }) {
    type Finding = { id: string; code: string; title: string; type: string; issueStatus: string; createdAt: Date };
    const from = PERIOD_DAYS[args.period] ? addDays(today, -PERIOD_DAYS[args.period]) : null;
    const rows = ((await listFindings(auth)) as Finding[]).filter((f) => !from || (toDay(f.createdAt) ?? "") >= from);
    const open = rows.filter((f) => !isDone(f.issueStatus)).slice(0, LIST_LIMIT);
    return {
      data: {
        period: args.period, total: rows.length,
        byType: countBy(rows, (f) => f.type), byStatus: countBy(rows, (f) => f.issueStatus),
        open: open.map((f) => ({ ref: f.code, title: f.title, type: f.type, status: f.issueStatus, raised: toDay(f.createdAt) })),
      },
      records: open.map((f) => ({ ref: f.code, type: "ia-finding", id: f.id, code: f.code, label: `${f.code} — ${f.title}` })),
    };
  },
};

const objectivesStatus: Tool = {
  description: "Objectives: counts by status and each objective's target, actual, progress and due date.",
  args: noArgs,
  permission: [ACTIONS.MS_READ],
  async run(_args, { auth }) {
    const rows = await listRecords(auth, "objectives");
    const shown = rows.slice(0, LIST_LIMIT);
    return {
      data: {
        total: rows.length, byStatus: countBy(rows, (r) => r.status),
        items: shown.map((r) => ({
          ref: r.code, title: r.title, status: r.status, target: str(r.data.target), actual: str(r.data.actual),
          unit: str(r.data.unit), progress: str(r.data.progress), due: toDay(r.data.due),
        })),
      },
      records: shown.map((r) => rec("objective", r)),
    };
  },
};

const supplierStatus: Tool = {
  description: "Suppliers: counts by status and criticality, and approved suppliers whose requalification is overdue or due within 30 days.",
  args: noArgs,
  permission: [ACTIONS.MS_READ],
  async run(_args, { auth, today }) {
    const rows = await listRecords(auth, "suppliers");
    const soon = addDays(today, 30);
    const requal = rows
      .map((r) => ({ r, due: toDay(r.data.requalDate) }))
      .filter(({ r, due }) => r.status === "Approved" && due && due <= soon)
      .sort((a, b) => a.due!.localeCompare(b.due!))
      .slice(0, LIST_LIMIT);
    return {
      data: {
        total: rows.length, byStatus: countBy(rows, (r) => r.status), byCriticality: countBy(rows, (r) => r.data.criticality),
        requalificationDue: requal.map(({ r, due }) => ({ ref: r.code, name: r.title, criticality: str(r.data.criticality), requalDate: due, overdue: due! < today })),
      },
      records: requal.map(({ r }) => rec("supplier", r)),
    };
  },
};

const documentReviewsDue: Tool = {
  description: "Documents and policies whose review is overdue or due within 30 days (status Review Due, or next review date passed/near).",
  args: noArgs,
  permission: [ACTIONS.MS_READ],
  async run(_args, { auth, today }) {
    const soon = addDays(today, 30);
    const [docs, policies] = await Promise.all([listRecords(auth, "documents"), listRecords(auth, "policies")]);
    const due = [...docs.map((r) => ({ r, kind: "document" })), ...policies.map((r) => ({ r, kind: "policy" }))]
      .map((x) => ({ ...x, next: toDay(x.r.data.nextReview) }))
      .filter(({ r, next }) => r.status === "Review Due" || (["Published", "Approved"].includes(r.status) && next && next <= soon))
      .sort((a, b) => (a.next ?? "").localeCompare(b.next ?? ""));
    const shown = due.slice(0, LIST_LIMIT);
    return {
      data: {
        total: due.length,
        items: shown.map(({ r, kind, next }) => ({ ref: r.code, kind, title: r.title, status: r.status, nextReview: next, overdue: r.status === "Review Due" || (!!next && next < today) })),
      },
      records: shown.map(({ r, kind }) => rec(kind, r)),
    };
  },
};

const kpiStatus: Tool = {
  description: "The live performance indicators (KPIs): value, target and whether each meets its target.",
  args: noArgs,
  permission: [ACTIONS.PERFEVAL_READ],
  async run(_args, { auth }) {
    const pis = await getPerfIndicators(auth);
    const items = pis.map((p, n) => ({
      ref: `PI-${n + 1}`, name: p.name, category: p.cat, value: p.val, unit: p.unit, target: p.target, direction: p.dir,
      meetsTarget: p.val == null ? null : p.dir === "down" ? p.val <= p.target : p.val >= p.target,
    }));
    return { data: items, records: items.map((i) => ({ ref: i.ref, type: "kpi", id: i.ref, code: i.ref, label: i.name })) };
  },
};

export const ASK_TOOLS: Record<string, Tool> = {
  overdue_items: overdueItems,
  list_nonconformities: listNonconformities,
  risk_summary: riskSummary,
  isra_status: israStatus,
  gap_status: gapStatus,
  audit_findings: auditFindings,
  objectives_status: objectivesStatus,
  supplier_status: supplierStatus,
  document_reviews_due: documentReviewsDue,
  kpi_status: kpiStatus,
};
