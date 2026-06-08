import { Plan } from "../../db/models";
import type { BillingFrequency, PlanStatus } from "../../db/models/plan.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { ForbiddenError, NotFoundError } from "../../lib/errors";

export interface CreatePlanInput {
  name: string;
  description?: string | null;
  billingFrequency?: BillingFrequency;
  status?: PlanStatus;
}

export type UpdatePlanInput = Partial<CreatePlanInput>;

export interface PlanView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  billingFrequency: BillingFrequency;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
}

export function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") throw new ForbiddenError("Only the Service Owner can manage billing");
}

function toView(p: Plan): PlanView {
  return {
    id: p.id, code: p.code, name: p.name, description: p.description,
    billingFrequency: p.billingFrequency, status: p.status,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  };
}

async function nextPlanCode(): Promise<string> {
  const rows = await Plan.findAll({ attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    if (r.code.startsWith("PLN-")) {
      const n = parseInt(r.code.slice(4), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `PLN-${String(max + 1).padStart(4, "0")}`;
}

export async function listPlans(auth: AuthContext): Promise<PlanView[]> {
  assertServiceOwner(auth);
  const rows = await Plan.findAll({ order: [["code", "ASC"]] });
  return rows.map(toView);
}

export async function createPlan(auth: AuthContext, input: CreatePlanInput, ip: string | null): Promise<PlanView> {
  assertServiceOwner(auth);
  const plan = await Plan.create({
    code: await nextPlanCode(),
    name: input.name,
    description: input.description ?? null,
    billingFrequency: input.billingFrequency ?? "Monthly",
    status: input.status ?? "Active",
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, tenantId: null, action: "plan.created", entityType: "Plan", entityId: plan.id, sourceIp: ip, result: "Success" });
  return toView(plan);
}

export async function updatePlan(auth: AuthContext, id: string, input: UpdatePlanInput, ip: string | null): Promise<PlanView> {
  assertServiceOwner(auth);
  const plan = await Plan.findByPk(id);
  if (!plan) throw new NotFoundError("Plan does not exist", "PLAN_NOT_FOUND");
  if (input.name !== undefined) plan.name = input.name;
  if (input.description !== undefined) plan.description = input.description ?? null;
  if (input.billingFrequency !== undefined) plan.billingFrequency = input.billingFrequency;
  if (input.status !== undefined) plan.status = input.status;
  await plan.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, tenantId: null, action: "plan.updated", entityType: "Plan", entityId: plan.id, sourceIp: ip, result: "Success" });
  return toView(plan);
}
