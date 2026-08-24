import { SaasSubscription, SaasWorkspace } from "../../db/models";

/**
 * SaaS lifecycle state resolution (G-73/G-75). Ported 1:1 from OD's
 * date-driven resolver (app.html:5952-5988: saasSubState / saasWsState /
 * saasWsAccess) — the frontend already carries the same port for its own
 * (currently mock-data-backed) SaaS Subscriptions screen at
 * fe-vibes-new/lib/saas/lifecycle.ts. Keep the two in sync if the grace
 * windows ever change.
 */

export const SAAS_GRACE1_DAYS = 30;
export const SAAS_GRACE2_DAYS = 30;
export const SAAS_RETENTION_MONTHS = 12;

export type SaasSubState = "Active" | "Grace 1" | "Grace 2" | "Archived" | "Purged" | "Provisioning";
export type SaasWsState = "Active" | "Read-only" | "Locked" | "Archived" | "Failed" | "Provisioning";
/** full = unrestricted; read = GET/HEAD only; none = every request refused. */
export type SaasAccessLevel = "full" | "read" | "none";

export interface SaasSubStateResult {
  state: SaasSubState;
  phase?: "Read-only" | "Locked";
  daysLeft?: number;
  graceEndsAt?: string;
  retentionEndsAt?: string;
  renewalDate?: string;
}

const DAY_MS = 86400000;

function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + n);
  return d.getTime();
}

/**
 * Date-driven subscription state resolver. `renewalDate` = end of the current
 * paid term. Past renewal -> 30d Grace 1 (read-only) -> 30d Grace 2 (locked)
 * -> Archived (retained 12 months from the start of Grace 2, i.e. from the
 * end of Grace 1) -> Purged. 1:1 with OD's saasSubState (app.html:5977).
 */
export function resolveSaasSubState(
  sub: Pick<SaasSubscription, "status" | "renewalDate"> | null,
  nowMs: number = Date.now(),
): SaasSubStateResult {
  if (!sub) return { state: "Active" };
  if (sub.status === "Purged") return { state: "Purged" };
  if (sub.status === "Provisioning") return { state: "Provisioning" };
  if (!sub.renewalDate) return { state: "Active" };

  const rd = sub.renewalDate.getTime();
  if (nowMs <= rd) {
    return { state: "Active", daysLeft: Math.ceil((rd - nowMs) / DAY_MS), renewalDate: sub.renewalDate.toISOString() };
  }

  const g1 = rd + SAAS_GRACE1_DAYS * DAY_MS;
  const g2 = g1 + SAAS_GRACE2_DAYS * DAY_MS;
  if (nowMs <= g1) {
    return { state: "Grace 1", phase: "Read-only", graceEndsAt: new Date(g1).toISOString(), daysLeft: Math.ceil((g1 - nowMs) / DAY_MS) };
  }
  if (nowMs <= g2) {
    return { state: "Grace 2", phase: "Locked", graceEndsAt: new Date(g2).toISOString(), daysLeft: Math.ceil((g2 - nowMs) / DAY_MS) };
  }

  const ret = addMonths(g1, SAAS_RETENTION_MONTHS);
  if (nowMs <= ret) {
    return { state: "Archived", retentionEndsAt: new Date(ret).toISOString(), daysLeft: Math.ceil((ret - nowMs) / DAY_MS) };
  }
  return { state: "Purged" };
}

const WS_STATE_FROM_SUB: Record<SaasSubState, SaasWsState> = {
  Active: "Active",
  "Grace 1": "Read-only",
  "Grace 2": "Locked",
  Archived: "Archived",
  Purged: "Archived",
  Provisioning: "Provisioning",
};

/**
 * Workspace effective state cascades from its subscription; Provisioning/
 * Failed are local overrides. 1:1 with OD's saasWsState (app.html:5985).
 */
export function resolveSaasWsState(
  ws: Pick<SaasWorkspace, "status"> | null,
  sub: Pick<SaasSubscription, "status" | "renewalDate"> | null,
  nowMs: number = Date.now(),
): SaasWsState {
  if (!ws) return "Active";
  if (ws.status === "Provisioning" || ws.status === "Failed") return ws.status as SaasWsState;
  return WS_STATE_FROM_SUB[resolveSaasSubState(sub, nowMs).state] ?? "Active";
}

/** 1:1 with OD's saasWsAccess (app.html:5988). */
export function resolveSaasAccess(wsState: SaasWsState): SaasAccessLevel {
  if (wsState === "Active") return "full";
  if (wsState === "Read-only") return "read";
  return "none"; // Locked, Archived, Failed, Provisioning
}

/**
 * Pick the workspace that represents a tenant's access to *this* backend. OD
 * picks the workspace matching the active client profile, falling back to
 * 'ms' then the first workspace (saasTenantWorkspace, app.html:10834). This
 * backend implements exactly one SaaS product line — every route here IS the
 * 'ms' (management-system) product — so that fallback order collapses to:
 * prefer a workspace whose product is 'ms', else the earliest-provisioned one.
 */
export function pickRepresentativeWorkspace(workspaces: SaasWorkspace[]): SaasWorkspace | null {
  if (workspaces.length === 0) return null;
  const ms = workspaces.find((w) => w.product === "ms");
  if (ms) return ms;
  return [...workspaces].sort((a, b) => a.provisionedAt.getTime() - b.provisionedAt.getTime())[0];
}

export interface TenantAccessResult {
  access: SaasAccessLevel;
  wsState: SaasWsState;
  subState: SaasSubStateResult;
}

/**
 * A tenant with no provisioned workspace has never entered the SaaS pipeline
 * (true today for every pre-existing tenant, since this lifecycle layer is
 * new) and keeps full access — 1:1 with OD's saasTenantAccess: `if(!w) return
 * 'full'`. Only a tenant explicitly enrolled via saas_workspaces, whose
 * subscription has lapsed past its renewal date, is ever restricted.
 */
export async function getTenantAccess(tenantId: string, nowMs: number = Date.now()): Promise<TenantAccessResult> {
  const workspaces = await SaasWorkspace.findAll({ where: { tenantId } });
  const ws = pickRepresentativeWorkspace(workspaces);
  if (!ws) return { access: "full", wsState: "Active", subState: { state: "Active" } };

  const sub = await SaasSubscription.findByPk(ws.subId);
  const subState = resolveSaasSubState(sub, nowMs);
  const wsState = resolveSaasWsState(ws, sub, nowMs);
  return { access: resolveSaasAccess(wsState), wsState, subState };
}
