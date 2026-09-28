/**
 * Pure context builders for `mr-autopilot.feature.ts` — no DB, no AI.
 *
 * Every figure the model may quote is computed here and tagged with a source
 * id, so the prompt stays compact and the model only has to phrase it.
 */
import { truncateForPrompt } from "./context";

export interface Source { id: string; label: string }
export interface TopicData { topicKey: string; title: string; facts: string[]; sources: Source[] }
export interface Period { from: string; to: string; prevFrom: string }

export interface DigestRecord {
  code: string;
  title: string;
  status: string;
  createdAt: Date | string;
  data?: Record<string, unknown> | null;
}

export interface MrTopicLike {
  id?: string;
  title: string;
  action?: { title?: string; owner?: string; due?: string | null; status?: string } | null;
  [k: string]: unknown;
}

/** Where a topic's data comes from. `indicators`/`ia`/`prevReviews` are special collectors; the rest are register keys. */
export type SourceKey =
  | "prevReviews" | "indicators" | "ia"
  | "context" | "parties" | "policies" | "objectives" | "processes" | "customer-satisfaction" | "concerns"
  | "nonconformities" | "compliance" | "risks" | "training" | "awareness-campaigns" | "suppliers"
  | "incidents" | "improvements";

/** ISO 9.3 topic title (FE `MR_TOPICS`) → the data it is drafted from. `[]` = nothing in the system covers it. */
export const TOPIC_SOURCES: Record<string, SourceKey[]> = {
  "Status of actions from previous management reviews": ["prevReviews"],
  "Changes in external and internal issues": ["context"],
  "Changes in needs and expectations of interested parties": ["parties"],
  "Scope suitability": [],
  "Policy suitability": ["policies"],
  "Objective achievement": ["objectives"],
  "Process performance": ["indicators", "processes"],
  "Customer satisfaction and feedback": ["customer-satisfaction", "concerns"],
  "Nonconformities and corrective actions": ["nonconformities"],
  "Monitoring and measurement results": ["indicators"],
  "Internal audit results": ["ia"],
  "External audit results": [],
  "Compliance obligations fulfilment": ["compliance"],
  "Risk and opportunity status": ["risks"],
  "Resource adequacy": [],
  "Competence, awareness, and training status": ["training", "awareness-campaigns"],
  "Supplier and external provider performance": ["suppliers"],
  "Communication and consultation results": [],
  "Incident trends": ["incidents"],
  "Security event trends": ["incidents"],
  "Environmental performance": [],
  "OH&S performance": [],
  "Privacy performance": [],
  "Opportunities for improvement": ["improvements"],
  "Changes affecting the management system": ["context", "policies"],
};

export const REGISTER_LABELS: Record<string, string> = {
  context: "External & internal issues", parties: "Interested parties", policies: "Policies",
  objectives: "Objectives", processes: "Business processes", "customer-satisfaction": "Customer satisfaction",
  concerns: "Concerns / feedback", nonconformities: "Nonconformities", compliance: "Compliance obligations",
  risks: "Risks", training: "Training plan", "awareness-campaigns": "Awareness campaigns",
  suppliers: "Suppliers", incidents: "Incidents", improvements: "Improvements",
};

/** Data fields worth quoting per register (only those present are shown). */
const EXTRA_KEYS: Record<string, string[]> = {
  context: ["type", "category", "impact"],
  parties: ["category", "needs"],
  policies: ["version", "category"],
  objectives: ["target", "actual", "unit", "progress", "due"],
  "customer-satisfaction": ["score", "overall", "category", "priority"],
  concerns: ["category", "classification"],
  nonconformities: ["severity", "category", "capStatus", "due"],
  compliance: ["type", "priority", "dueDate"],
  risks: ["band", "riskScore", "category"],
  training: ["type", "due"],
  suppliers: ["criticality", "type"],
  incidents: ["type", "severity", "incidentDate"],
  improvements: ["priority", "type", "due"],
};

/** Registers whose numeric field is averaged per period. */
const NUMERIC_KEY: Record<string, string> = { "customer-satisfaction": "score" };

const MAX_ITEMS = 8;
const DAY_MS = 86_400_000;

const day = (d: Date | string): string => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const inRange = (d: string, from: string, to: string) => d >= from && d <= to;

/**
 * The review period: since the previous review (else the 12 months before this
 * one), plus an equally long previous period for the trend.
 */
export function reviewPeriod(reviewDate: string, previousDates: string[]): Period {
  const to = reviewDate.slice(0, 10);
  const earlier = previousDates.map((d) => d.slice(0, 10)).filter((d) => d && d < to).sort();
  const last = earlier[earlier.length - 1];
  const from = last ?? day(new Date(new Date(`${to}T00:00:00Z`).getTime() - 365 * DAY_MS));
  const span = new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime();
  const prevFrom = day(new Date(new Date(`${from}T00:00:00Z`).getTime() - span));
  return { from, to, prevFrom };
}

function countBy<T>(items: T[], key: (t: T) => string): string {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(key(i) || "—", (counts.get(key(i) || "—") ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k} ${n}`).join(", ") || "none";
}

function average(values: unknown[]): string {
  const nums = values.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2) : "n/a";
}

function describe(rec: DigestRecord, extra: string[]): string {
  const d = rec.data ?? {};
  const bits = extra
    .filter((k) => d[k] !== undefined && d[k] !== null && d[k] !== "")
    .map((k) => `${k}: ${String(d[k]).slice(0, 80)}`);
  return [rec.title.slice(0, 120), `status: ${rec.status}`, ...bits].join(" — ");
}

/** One register → counts by status, period vs previous-period volume, and the most recent items. */
export function registerDigest(key: string, records: DigestRecord[], period: Period): { facts: string[]; sources: Source[] } {
  const label = REGISTER_LABELS[key] ?? key;
  const regId = `register:${key}`;
  const inPeriod = records.filter((r) => inRange(day(r.createdAt), period.from, period.to));
  const inPrev = records.filter((r) => inRange(day(r.createdAt), period.prevFrom, period.from) && day(r.createdAt) < period.from);
  const facts = [
    `[${regId}] ${label}: ${records.length} records in total; by status: ${countBy(records, (r) => r.status)}. ` +
      `New in review period (${period.from} to ${period.to}): ${inPeriod.length}; in previous period (${period.prevFrom} to ${period.from}): ${inPrev.length}.`,
  ];
  const numKey = NUMERIC_KEY[key];
  if (numKey) {
    facts.push(`[${regId}] Average ${numKey} in review period: ${average(inPeriod.map((r) => r.data?.[numKey]))}; previous period: ${average(inPrev.map((r) => r.data?.[numKey]))}.`);
  }
  const sources: Source[] = [{ id: regId, label: `${label} register` }];
  const recent = [...records].sort((a, b) => day(b.createdAt).localeCompare(day(a.createdAt))).slice(0, MAX_ITEMS);
  for (const r of recent) {
    facts.push(`[${r.code}] ${describe(r, EXTRA_KEYS[key] ?? [])}`);
    sources.push({ id: r.code, label: `${r.code} — ${r.title}` });
  }
  return { facts, sources };
}

export interface IndicatorLike { name: string; val: number | null; unit: string; target: number; dir: string; cat: string }

/** The 14 live performance indicators (perfIndicators.ts), each as `[PI-n]`. */
export function indicatorDigest(indicators: IndicatorLike[]): { facts: string[]; sources: Source[] } {
  const facts: string[] = [];
  const sources: Source[] = [];
  indicators.forEach((i, n) => {
    const id = `PI-${n + 1}`;
    const val = i.val == null ? "not measured (no data)" : `${i.val}${i.unit === "%" ? "%" : ""}`;
    facts.push(`[${id}] ${i.cat} — ${i.name}: ${val}; target ${i.dir === "down" ? "≤" : "≥"} ${i.target}${i.unit === "%" ? "%" : ""}`);
    sources.push({ id, label: `Performance indicator: ${i.name}` });
  });
  return { facts, sources };
}

export interface FindingLike { code: string; title: string; type: string; issueStatus: string; createdAt: Date | string }
export interface ReportLike { code: string; summary: string | null; conclusion: string | null; reportDate: Date | string | null; status: string }

/** Internal audit findings by type/status plus the latest report conclusions. */
export function auditDigest(findings: FindingLike[], reports: ReportLike[], period: Period): { facts: string[]; sources: Source[] } {
  const inPeriod = findings.filter((f) => inRange(day(f.createdAt), period.from, period.to));
  const open = findings.filter((f) => !["Closed", "Rejected"].includes(f.issueStatus));
  const facts = [
    `[register:ia-findings] Internal audit findings: ${findings.length} in total; by type: ${countBy(findings, (f) => f.type)}; ` +
      `open: ${open.length}; raised in review period: ${inPeriod.length} (by type: ${countBy(inPeriod, (f) => f.type)}).`,
  ];
  const sources: Source[] = [{ id: "register:ia-findings", label: "Internal audit findings" }];
  for (const f of open.slice(0, MAX_ITEMS)) {
    facts.push(`[${f.code}] ${f.type}: ${f.title.slice(0, 120)} — ${f.issueStatus}`);
    sources.push({ id: f.code, label: `${f.code} — ${f.title}` });
  }
  for (const r of reports.slice(0, 2)) {
    const text = [r.summary, r.conclusion].filter(Boolean).join(" ");
    facts.push(`[${r.code}] Audit report (${r.status}${r.reportDate ? `, ${day(r.reportDate)}` : ""}): ${truncateForPrompt(text, 400)}`);
    sources.push({ id: r.code, label: `Audit report ${r.code}` });
  }
  return { facts, sources };
}

export interface ReviewLike { id: string; code: string; status: string; data: Record<string, unknown> | null }

/** Follow-up actions recorded on earlier reviews (topic.action), with their status. */
export function previousActionsDigest(reviews: ReviewLike[], currentId: string, beforeDate: string): { facts: string[]; sources: Source[] } {
  const prior = reviews.filter((r) => r.id !== currentId && r.status !== "Cancelled" && String(r.data?.date ?? "") < beforeDate);
  const actions = prior.flatMap((r) =>
    ((Array.isArray(r.data?.topics) ? r.data.topics : []) as MrTopicLike[])
      .filter((t) => t.action)
      .map((t) => ({ review: r, topic: t, action: t.action! })),
  );
  const open = actions.filter((a) => !["Completed", "Cancelled"].includes(String(a.action.status)));
  const facts = [
    `[register:mr-actions] Actions from previous management reviews: ${actions.length} in total; by status: ${countBy(actions, (a) => String(a.action.status ?? ""))}; still open: ${open.length}.`,
  ];
  const sources: Source[] = [{ id: "register:mr-actions", label: "Previous management review actions" }];
  for (const a of [...open, ...actions.filter((x) => !open.includes(x))].slice(0, MAX_ITEMS)) {
    const id = a.topic.id ? `${a.review.code}/${a.topic.id}` : a.review.code;
    facts.push(`[${id}] ${String(a.action.title ?? a.topic.title).slice(0, 120)} — owner: ${a.action.owner || "—"} — due: ${a.action.due || "—"} — ${a.action.status || "Open"}`);
    sources.push({ id, label: `${a.review.code}: ${a.action.title || a.topic.title}` });
  }
  return { facts, sources };
}

export const topicKeyOf = (t: MrTopicLike): string => t.id || t.title;

export function findTopic<T extends MrTopicLike>(topics: T[], key: string): T | undefined {
  return topics.find((t) => t.id === key) ?? topics.find((t) => t.title === key);
}

/** The prompt body for a batch of topics: each topic's facts, compact and tagged. */
export function buildInputsPrompt(topics: TopicData[], period: Period, maxCharsPerTopic = 3000): string {
  const blocks = topics.map((t) =>
    `### topicKey: ${t.topicKey}\nTopic: ${t.title}\n${truncateForPrompt(t.facts.join("\n"), maxCharsPerTopic)}`,
  );
  return `Review period: ${period.from} to ${period.to} (previous period for trends: ${period.prevFrom} to ${period.from}).\n\n${blocks.join("\n\n")}`;
}

/** Keep only source ids the model cited that were really provided; fall back to the register-level sources. */
export function citedSources(provided: Source[], citedIds: string[]): Source[] {
  const cited = provided.filter((s) => citedIds.includes(s.id));
  return cited.length ? cited : provided.filter((s) => s.id.startsWith("register:") || s.id.startsWith("PI-"));
}

export interface SelectedAction { topicKey: string; action: string; ownerName?: string | null; due?: string | null; priority?: string }

/**
 * Attach selected actions to their topics the way Record Outputs does
 * (`topic.action`, owner/due mirrored onto the topic). A topic holds one
 * action, so a topic that already has one, or two actions for one topic, is an error.
 */
export function attachActions<T extends MrTopicLike>(topics: T[], selected: SelectedAction[]): { topics: T[]; errors: string[] } {
  const errors: string[] = [];
  const byTopic = new Map<string, SelectedAction>();
  for (const s of selected) {
    const topic = findTopic(topics, s.topicKey);
    if (!topic) { errors.push(`Unknown topic "${s.topicKey}"`); continue; }
    if (topic.action) { errors.push(`"${topic.title}" already has a follow-up action`); continue; }
    const key = topicKeyOf(topic);
    if (byTopic.has(key)) { errors.push(`More than one action selected for "${topic.title}"`); continue; }
    byTopic.set(key, s);
  }
  const next = topics.map((t) => {
    const s = byTopic.get(topicKeyOf(t));
    if (!s) return t;
    const owner = s.ownerName?.trim() ?? "";
    const due = s.due ?? "";
    return {
      ...t,
      action: { title: s.action.trim(), desc: "", owner, due, priority: s.priority ?? "Medium", status: "Open" },
      responsible: owner,
      due,
    };
  });
  return { topics: next, errors };
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
