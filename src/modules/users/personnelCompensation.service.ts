import { PersonnelCompensation, BusinessRecord } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { requireManagedUser } from "./user.service";
import { logPersonnelActivity } from "./personnelActivity.service";
import { actorName } from "../record-events/recordEvent.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

export interface CompensationInput {
  compRecordId?: string | null;
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountName?: string | null;
  taxId?: string | null;
  taxStatus?: string | null;
  effectiveDate?: string | null;
  minwageRecordId?: string | null;
}

async function getOrCreate(orgId: string, userId: string): Promise<PersonnelCompensation> {
  const [row] = await PersonnelCompensation.findOrCreate({ where: { userId }, defaults: { orgId, userId } });
  return row;
}

export async function getCompensation(auth: AuthContext, userId: string) {
  const user = await requireManagedUser(auth, userId);
  return (await getOrCreate(user.orgId, userId)).get({ plain: true });
}

function numericField(data: Record<string, unknown>, key: string): number | null {
  const v = data[key];
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Compares the bound `ent-comp` record's `amount` against the bound
 * `ent-minwage` record's `amount` (both stored as loosely-typed strings in
 * `BusinessRecord.data`, per `dataSchemas.ts`). Non-comparable inputs (either
 * record missing, or either amount not numeric) leave compliance `null`
 * ("unknown") rather than failing the save — the binding is still valid HR
 * data even before both reference records are wired up.
 */
async function computeMinwageCompliance(orgId: string, compRecordId: string | null, minwageRecordId: string | null): Promise<boolean | null> {
  if (!compRecordId || !minwageRecordId) return null;
  const [comp, minwage] = await Promise.all([
    BusinessRecord.findOne({ where: { id: compRecordId, orgId, module: "ent-comp" } }),
    BusinessRecord.findOne({ where: { id: minwageRecordId, orgId, module: "ent-minwage" } }),
  ]);
  if (!comp || !minwage) return null;
  const compAmount = numericField(comp.data, "amount");
  const minAmount = numericField(minwage.data, "amount");
  if (compAmount === null || minAmount === null) return null;
  return compAmount >= minAmount;
}

export async function updateCompensation(auth: AuthContext, userId: string, input: CompensationInput) {
  const user = await requireManagedUser(auth, userId);
  if (input.compRecordId) {
    const rec = await BusinessRecord.findOne({ where: { id: input.compRecordId, orgId: user.orgId, module: "ent-comp" } });
    if (!rec) throw new BadRequestError("Compensation record not found in this organization", "COMP_RECORD_NOT_FOUND");
  }
  if (input.minwageRecordId) {
    const rec = await BusinessRecord.findOne({ where: { id: input.minwageRecordId, orgId: user.orgId, module: "ent-minwage" } });
    if (!rec) throw new BadRequestError("Minimum-wage record not found in this organization", "MINWAGE_RECORD_NOT_FOUND");
  }

  const row = await getOrCreate(user.orgId, userId);
  const rec = row as unknown as Record<string, unknown>;
  const fields = ["compRecordId", "bankName", "bankAccountNo", "bankAccountName", "taxId", "taxStatus", "effectiveDate", "minwageRecordId"] as const;
  for (const k of fields) {
    if (input[k] !== undefined) rec[k] = input[k];
  }
  row.minwageCompliant = await computeMinwageCompliance(user.orgId, row.compRecordId, row.minwageRecordId);
  row.lastUpdatedBy = await actorName(auth);
  await row.save();
  await logPersonnelActivity(auth, user.orgId, userId, "compensation.updated", null, {
    compRecordId: row.compRecordId,
    minwageCompliant: row.minwageCompliant,
  });
  return row.get({ plain: true });
}

/** Re-run the minimum-wage compliance check against the currently-bound records (`ent-minwage` compliance banner). */
export async function checkMinWageCompliance(auth: AuthContext, userId: string) {
  const user = await requireManagedUser(auth, userId);
  const row = await PersonnelCompensation.findOne({ where: { userId, orgId: user.orgId } });
  if (!row) throw new NotFoundError("No compensation binding for this person", "COMPENSATION_NOT_FOUND");
  const compliant = await computeMinwageCompliance(user.orgId, row.compRecordId, row.minwageRecordId);
  if (compliant !== row.minwageCompliant) {
    row.minwageCompliant = compliant;
    await row.save();
  }
  return { compliant, compRecordId: row.compRecordId, minwageRecordId: row.minwageRecordId };
}
