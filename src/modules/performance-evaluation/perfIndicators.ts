/**
 * Performance Evaluation (ISO 9.1) — the 14 live indicators, ported 1:1 from
 * OD's `perfIndicatorsBase()` / `perfRag()` (app.html:11206-11236) and from
 * this app's own frontend port (`fe-vibes-new/lib/implementation/performance.ts`,
 * `computePerfIndicatorsBase`), which already resolved OD's two dead-code
 * status literals against this codebase's real vocabularies — see
 * `FINDING_OPEN_STATUSES_EXCLUDED` / `CONCERN_PENDING_STATUSES` below.
 *
 * Computed server-side (unlike the frontend port, which computes client-side
 * over already-fetched collections) so the values are the single source of
 * truth: `objectives`' `source.kind: indicator` override (a later stage)
 * reads these by `name`, and the dashboard/API get identical numbers.
 *
 * Pure functions only — no DB access, no AuthContext. `perfIndicators.service.ts`
 * fetches each source collection (org-scoped) and calls `computePerfIndicatorsBase`.
 */

export type PerfDirection = "up" | "down";
export type PerfRag = "green" | "amber" | "red" | "na";

export interface PerfIndicator {
  cat: string;
  name: string;
  /** OD's `tn-m-*` navigation key for the source module — a pass-through label, not a backend route. */
  route: string;
  src: string;
  unit: "%" | "#";
  dir: PerfDirection;
  target: number;
  num?: number;
  den: number;
  numLbl?: string;
  denLbl: string;
  calc: string;
  /** `null` means unmeasured (empty source collection) — never rendered as 0. */
  val: number | null;
  /** Set only when an Objective (`source.kind: 'indicator'`) overrides this indicator — OD `perfIndicators()`. */
  objId?: string;
  objTitle?: string;
}

export interface ObjectiveIndicatorLink {
  id: string;
  title: string;
  /** Objective `data.source` — only `kind: 'indicator'` objectives overlay a target. */
  source: { kind: string; indicator?: string } | null;
  target: unknown;
  dir: unknown;
}

/**
 * OD's `perfIndicators()` (app.html:11209-11211): an Objective whose
 * `source.kind==='indicator'` overrides the matching Performance Indicator's
 * target/direction, matched by indicator NAME (not id — `## Objectives`,
 * "overrides that indicator's target/direction"). Mutates a copy, never the
 * base computation; a name with no matching objective is left untouched.
 */
export function applyObjectiveOverrides(indicators: PerfIndicator[], objectives: ObjectiveIndicatorLink[]): PerfIndicator[] {
  const linked = objectives.filter((o) => o.source?.kind === "indicator" && o.source.indicator);
  return indicators.map((i) => {
    const o = linked.find((x) => x.source!.indicator === i.name);
    if (!o) return i;
    const next: PerfIndicator = { ...i, objId: o.id, objTitle: o.title };
    if (o.target != null && o.target !== "") {
      const n = Number(o.target);
      if (!Number.isNaN(n)) next.target = n;
    }
    if (typeof o.dir === "string" && (o.dir === "up" || o.dir === "down")) next.dir = o.dir;
    return next;
  });
}

/** OD `perfPct` (app.html:11206). */
export function perfPct(num: number, den: number): number | null {
  return den ? Math.round((num / den) * 100) : null;
}

/** OD `perfRag` (app.html:11207) — exact banding, including the direction inversion for `dir: 'down'`. */
export function perfRag(val: number | null, target: number, dir: PerfDirection): PerfRag {
  if (val == null) return "na";
  if (dir === "down") {
    if (val <= target) return "green";
    if (val <= target + Math.max(1, target * 0.15)) return "amber";
    return "red";
  }
  if (val >= target) return "green";
  if (val >= target * 0.85) return "amber";
  return "red";
}

interface RecordLike {
  status: string;
  data: Record<string, unknown>;
}
interface RiskLike {
  status: string;
  level: number | null;
}
interface FindingLike {
  issueStatus: string;
}

export interface PerfIndicatorInputs {
  /** ImplementationRecord module "processes" — OD `db.bizProcesses`. */
  processes: RecordLike[];
  /** Risk register views (module "risks", `level` already enriched). */
  risks: RiskLike[];
  /** Internal Audit findings. */
  iaFindings: FindingLike[];
  /** ImplementationRecord module "nonconformities". */
  nonconformities: RecordLike[];
  /** ImplementationRecord module "concerns". */
  concerns: RecordLike[];
  /** ImplementationRecord module "training" (already decorated with `data.overdue`). */
  trainingPlans: RecordLike[];
  /** ImplementationRecord module "awareness-campaigns" (nested `data.acks[]`/`data.evals[]`). */
  awarenessCampaigns: RecordLike[];
  /** ImplementationRecord module "documents" (internal documents). */
  internalDocuments: RecordLike[];
  /** ImplementationRecord module "records" (external documents). */
  externalDocuments: RecordLike[];
  /** ImplementationRecord module "suppliers". */
  suppliers: RecordLike[];
}

const RISK_CONTROLLED_STATUSES = ["In Treatment", "Monitored", "Pending Approval", "Pending TM Approval"];

/**
 * OD's literal `f.status!=='Open'`/`f.status==='Open'` is dead code here — no
 * `IaFinding` ever has a `status` field, only `issueStatus`. Matches the
 * "open" definition already established at the Internal Audit dashboard
 * (`f.issueStatus !== "Closed" && f.issueStatus !== "Rejected"`).
 */
const FINDING_OPEN_STATUSES_EXCLUDED = ["Closed", "Rejected"];

/**
 * OD's literal `'Open'|'Pending Review'|'Pending'` never occurs in this
 * backend's concerns vocabulary (`Draft/Submitted/Under Review/Routed/
 * Closed/Cancelled/Archived`) — also dead code. Matches this app's own
 * "pending review" definition for the concerns register.
 */
const CONCERN_PENDING_STATUSES = ["Submitted", "Under Review"];

/** OD `cdReviewDue` — internal document review-due predicate (no server port existed before this). */
const CD_REVIEW_DUE_EXCLUDED_STATUSES = ["Draft", "Under Review", "Superseded", "Obsolete", "Archived", "Rejected"];
function cdReviewDue(rec: RecordLike): boolean {
  const nextReview = rec.data?.nextReview;
  if (!nextReview || typeof nextReview !== "string") return false;
  if (CD_REVIEW_DUE_EXCLUDED_STATUSES.includes(rec.status)) return false;
  const t = new Date(nextReview).getTime();
  if (Number.isNaN(t)) return false;
  return t <= Date.now() + 30 * 86400000;
}

/** OD `edReviewStatus` (5-branch precedence) — external document review-due predicate. */
function edReviewDue(rec: RecordLike): boolean {
  if (["Superseded", "Obsolete", "Archived"].includes(rec.status)) return false;
  if (rec.status === "Updated Version Available") return false;
  if (rec.status === "Under Review") return false;
  const nextReview = rec.data?.nextReview;
  if (typeof nextReview === "string" && nextReview) {
    const t = new Date(nextReview).getTime();
    if (!Number.isNaN(t) && t <= Date.now()) return true;
  }
  return false;
}

function processSteps(rec: RecordLike): { targets?: unknown }[] {
  const steps = rec.data?.steps;
  return Array.isArray(steps) ? (steps as { targets?: unknown }[]) : [];
}

function campaignAcks(rec: RecordLike): { status?: unknown }[] {
  const acks = rec.data?.acks;
  return Array.isArray(acks) ? (acks as { status?: unknown }[]) : [];
}

function campaignEvals(rec: RecordLike): { result?: unknown }[] {
  const evals = rec.data?.evals;
  return Array.isArray(evals) ? (evals as { result?: unknown }[]) : [];
}

/**
 * OD `perfIndicatorsBase()` (app.html:11208-11236). Fourteen indicators
 * computed live from real collections. The 14th ("Approved suppliers") is
 * omitted entirely when there are no suppliers yet, mirroring OD's
 * `if(sup.length)` guard, rather than shown as a zero or an unmeasured 0-of-0.
 */
export function computePerfIndicatorsBase(inputs: PerfIndicatorInputs): PerfIndicator[] {
  const out: PerfIndicator[] = [];

  // Process control (§4.4)
  const steps = inputs.processes.flatMap(processSteps);
  const stepsWithTargets = steps.filter((s) => Boolean(s.targets)).length;
  out.push({
    cat: "Process control (§4.4)", name: "Process steps with defined KPIs / targets",
    route: "tn-m-processes", src: "Business Processes", unit: "%", dir: "up", target: 80,
    num: stepsWithTargets, den: steps.length, numLbl: "with targets", denLbl: "steps",
    calc: "Steps with KPIs/targets ÷ all process steps", val: perfPct(stepsWithTargets, steps.length),
  });

  // Risk management (§6.1)
  const risks = inputs.risks;
  const controlledRisks = risks.filter((r) => RISK_CONTROLLED_STATUSES.includes(r.status)).length;
  out.push({
    cat: "Risk management (§6.1)", name: "Risks under active control",
    route: "tn-m-risk", src: "Risk Register", unit: "%", dir: "up", target: 75,
    num: controlledRisks, den: risks.length, numLbl: "under control", denLbl: "risks",
    calc: "Risks in treatment/monitored/pending ÷ all risks", val: perfPct(controlledRisks, risks.length),
  });
  const openHighCriticalRisks = risks.filter((r) => (r.level ?? 0) >= 10 && r.status !== "Monitored").length;
  out.push({
    cat: "Risk management (§6.1)", name: "Open High / Critical risks",
    route: "tn-m-risk", src: "Risk Register", unit: "#", dir: "down", target: 0,
    den: risks.length, denLbl: "risks", calc: "Risks with level ≥ 10 not yet monitored", val: openHighCriticalRisks,
  });

  // Internal audit (§9.2)
  const finds = inputs.iaFindings;
  const closedFindings = finds.filter((f) => f.issueStatus === "Closed").length;
  out.push({
    cat: "Internal audit (§9.2)", name: "Audit finding closure rate",
    route: "tn-m-audit", src: "Internal Audit", unit: "%", dir: "up", target: 85,
    num: closedFindings, den: finds.length, numLbl: "closed", denLbl: "findings",
    calc: "Closed findings ÷ all audit findings", val: perfPct(closedFindings, finds.length),
  });
  const openFindings = finds.filter((f) => !FINDING_OPEN_STATUSES_EXCLUDED.includes(f.issueStatus)).length;
  out.push({
    cat: "Internal audit (§9.2)", name: "Open audit findings",
    route: "tn-m-audit", src: "Internal Audit", unit: "#", dir: "down", target: 3,
    den: finds.length, denLbl: "findings", calc: "Audit findings still open", val: openFindings,
  });

  // Improvement (§10)
  const ncs = inputs.nonconformities;
  const closedNcs = ncs.filter((n) => n.status === "Closed").length;
  out.push({
    cat: "Improvement (§10)", name: "Nonconformity closure rate",
    route: "tn-m-nc", src: "Nonconformities", unit: "%", dir: "up", target: 90,
    num: closedNcs, den: ncs.length, numLbl: "closed", denLbl: "NCs",
    calc: "Closed NCs ÷ all nonconformities", val: perfPct(closedNcs, ncs.length),
  });
  const concerns = inputs.concerns;
  const pendingConcerns = concerns.filter((c) => CONCERN_PENDING_STATUSES.includes(c.status)).length;
  out.push({
    cat: "Improvement (§10)", name: "Concerns pending review",
    route: "tn-m-concerns", src: "Concerns", unit: "#", dir: "down", target: 0,
    den: concerns.length, denLbl: "concerns", calc: "Concerns open or pending review", val: pendingConcerns,
  });

  // Competence & awareness (§7.2 / 7.3)
  const trainingPlans = inputs.trainingPlans;
  const activeTrainingPlans = trainingPlans.filter((x) => x.status !== "Cancelled");
  const completedTrainingPlans = trainingPlans.filter((x) => ["Completed", "Closed"].includes(x.status)).length;
  out.push({
    cat: "Competence & awareness (§7.2 / 7.3)", name: "Training completion rate",
    route: "tn-m-training", src: "Training Plan", unit: "%", dir: "up", target: 90,
    num: completedTrainingPlans, den: activeTrainingPlans.length, numLbl: "completed", denLbl: "active plans",
    calc: "Completed plans ÷ active (non-cancelled) plans", val: perfPct(completedTrainingPlans, activeTrainingPlans.length),
  });
  const overdueTraining = trainingPlans.filter((x) => Boolean(x.data?.overdue)).length;
  out.push({
    cat: "Competence & awareness (§7.2 / 7.3)", name: "Overdue training actions",
    route: "tn-m-training", src: "Training Plan", unit: "#", dir: "down", target: 0,
    den: trainingPlans.length, denLbl: "plans", calc: "Training actions past their due date", val: overdueTraining,
  });

  const campaigns = inputs.awarenessCampaigns;
  const ackRates = campaigns
    .map((c) => {
      const acks = campaignAcks(c);
      return acks.length ? Math.round((acks.filter((a) => a.status === "Acknowledged").length / acks.length) * 100) : null;
    })
    .filter((r): r is number => r != null);
  out.push({
    cat: "Competence & awareness (§7.2 / 7.3)", name: "Awareness acknowledgment rate",
    route: "tn-m-awareness", src: "Awareness", unit: "%", dir: "up", target: 95,
    den: ackRates.length, denLbl: "campaigns", calc: "Average acknowledgment rate across campaigns",
    val: ackRates.length ? Math.round(ackRates.reduce((a, b) => a + b, 0) / ackRates.length) : null,
  });
  const evals = campaigns.flatMap(campaignEvals);
  const passedEvals = evals.filter((e) => e.result === "Passed").length;
  out.push({
    cat: "Competence & awareness (§7.2 / 7.3)", name: "Awareness evaluation pass rate",
    route: "tn-m-awareness", src: "Awareness", unit: "%", dir: "up", target: 80,
    num: passedEvals, den: evals.length, numLbl: "passed", denLbl: "evaluations",
    calc: "Passed evaluations ÷ all evaluations", val: perfPct(passedEvals, evals.length),
  });

  // Documented information (§7.5)
  const internalDocuments = inputs.internalDocuments;
  const internalDocsWithinDate = internalDocuments.filter((x) => !cdReviewDue(x)).length;
  out.push({
    cat: "Documented information (§7.5)", name: "Internal documents within review date",
    route: "tn-m-documents", src: "Internal Documents", unit: "%", dir: "up", target: 95,
    num: internalDocsWithinDate, den: internalDocuments.length, numLbl: "within date", denLbl: "documents",
    calc: "Docs within review date ÷ all internal docs", val: perfPct(internalDocsWithinDate, internalDocuments.length),
  });
  const externalDocuments = inputs.externalDocuments;
  const externalDocsCurrent = externalDocuments.filter((x) => !edReviewDue(x)).length;
  out.push({
    cat: "Documented information (§7.5)", name: "External documents current",
    route: "tn-m-records", src: "External Documents", unit: "%", dir: "up", target: 90,
    num: externalDocsCurrent, den: externalDocuments.length, numLbl: "current", denLbl: "documents",
    calc: "Current docs ÷ all external documents", val: perfPct(externalDocsCurrent, externalDocuments.length),
  });

  // External providers (§8.4) — only added when at least one supplier exists.
  const suppliers = inputs.suppliers;
  if (suppliers.length) {
    const approvedSuppliers = suppliers.filter((s) => s.status === "Approved").length;
    out.push({
      cat: "External providers (§8.4)", name: "Approved suppliers",
      route: "tn-m-suppliers", src: "Suppliers", unit: "%", dir: "up", target: 80,
      num: approvedSuppliers, den: suppliers.length, numLbl: "approved", denLbl: "suppliers",
      calc: "Approved suppliers ÷ all suppliers", val: perfPct(approvedSuppliers, suppliers.length),
    });
  }

  return out;
}
