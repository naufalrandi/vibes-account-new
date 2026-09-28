/** Pure prompt/context builders for `audit-copilot.feature.ts` — no DB, no AI. */
import { citeList, redactPii, truncateForPrompt } from "./context";

export interface ReqLike { id: string; code: string; subject: string; description: string }
export interface SessionLike {
  code: string; title: string; process: string; workUnit: string | null; auditee: string | null;
  criteria: string[]; methods: string[]; notes: string | null;
}
export interface ProcessLike { code: string; title: string; data: Record<string, unknown> }

const MAX_REQS = 40;
const FWRC_PER_REQ = 3;

/** Process fields worth giving an auditor: inputs/outputs/KPIs/steps, compact. */
export function processBlock(p: ProcessLike | undefined): string {
  if (!p) return "Process record: not found in the business process register.";
  const d = p.data;
  const pick = (k: string) => (d[k] === undefined || d[k] === null || d[k] === "" ? null : `${k}: ${truncateForPrompt(JSON.stringify(d[k]), 400)}`);
  return [`[${p.code}] Process: ${p.title}`, ...["owner", "inputs", "outputs", "kpis", "steps", "resources"].map(pick).filter(Boolean)].join("\n");
}

/** The session's clauses with their subjects and (a few) FWRC maturity statements, citeable by clause code. */
export function clauseBlock(reqs: ReqLike[], fwrc: Map<string, string[]>): string {
  if (reqs.length === 0) return "Clauses: none selected on this session.";
  return citeList(reqs.slice(0, MAX_REQS).map((r) => {
    const statements = (fwrc.get(r.id) ?? []).slice(0, FWRC_PER_REQ).map((s) => truncateForPrompt(s, 200));
    return {
      id: r.code,
      text: `${r.subject}. ${truncateForPrompt(r.description, 400)}${statements.length ? ` Criteria statements: ${statements.join(" | ")}` : ""}`,
    };
  }));
}

export function sessionBlock(s: SessionLike): string {
  return [
    `Session ${s.code}: ${s.title}`,
    `Process: ${s.process}${s.workUnit ? ` · Work unit: ${s.workUnit}` : ""}`,
    `Standards: ${s.criteria.join(", ") || "—"}`,
    `Methods: ${s.methods.join(", ") || "—"}`,
  ].join("\n");
}

/** Model clauseRefs are kept only when they are real clause codes of the session. */
export function keepKnownClauses(refs: string[], reqs: ReqLike[]): string[] {
  const codes = new Set(reqs.map((r) => r.code));
  return [...new Set(refs.filter((r) => codes.has(r)))];
}

export interface ReportFindingLike { code: string; title: string; type: string; issueStatus: string; process: string; description: string }
export interface ReportSessionLike { code: string; title: string; process: string; status: string; date: string }

/** The actual findings/sessions of a report's programme, as citeable lines. */
export function reportContext(
  program: { code: string; name: string; period: string; scope: string | null; objective: string | null },
  sessions: ReportSessionLike[], findings: ReportFindingLike[],
): string {
  const byType = new Map<string, number>();
  for (const f of findings) byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
  return [
    `Programme [${program.code}] ${program.name} — period ${program.period}`,
    program.scope ? `Scope: ${truncateForPrompt(program.scope, 600)}` : null,
    program.objective ? `Objective: ${truncateForPrompt(program.objective, 600)}` : null,
    `Sessions (${sessions.length}):`,
    citeList(sessions.map((s) => ({ id: s.code, text: `${s.title} — process ${s.process} — ${s.date} — ${s.status}` }))) || "none",
    `Findings (${findings.length}; by type: ${[...byType].map(([t, n]) => `${t} ${n}`).join(", ") || "none"}):`,
    citeList(findings.map((f) => ({
      id: f.code,
      text: `${f.type}: ${f.title} — process ${f.process} — ${f.issueStatus} — ${truncateForPrompt(redactPii(f.description), 300)}`,
    }))) || "none",
  ].filter((l) => l !== null).join("\n");
}
