import { PersonnelOnboardingItem } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { requireManagedUser } from "./user.service";
import { logPersonnelActivity } from "./personnelActivity.service";
import { actorName } from "../record-events/recordEvent.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

/**
 * OD `ONBOARD_TEMPLATE` (js/modules.js), verbatim — the checklist a new hire's
 * onboarding is seeded from, in OD's order.
 *
 * `internalOnly` tasks are the ones that assume a desk and a badge. OD drops
 * them for External-category personnel (`ONBOARD_TEMPLATE.filter(t => !(ext &&
 * t.internalOnly))`), so a contractor is not held to "Building / badge access
 * issued".
 */
export const ONBOARD_TEMPLATE: readonly {
  key: string; label: string; group: string; required: boolean; internalOnly?: boolean;
}[] = [
  { key: "contract", label: "Signed contract / agreement on file", group: "Documentation", required: true },
  { key: "idtax", label: "ID & tax documents collected", group: "Documentation", required: true },
  { key: "bank", label: "Bank / payment details confirmed", group: "Documentation", required: true },
  { key: "emergency", label: "Emergency contact recorded", group: "Documentation", required: false },
  { key: "email", label: "Email account created", group: "Accounts & Access", required: true },
  { key: "access", label: "System access & permissions granted", group: "Accounts & Access", required: true },
  { key: "badge", label: "Building / badge access issued", group: "Accounts & Access", required: false, internalOnly: true },
  { key: "laptop", label: "Laptop / workstation issued", group: "Equipment", required: false },
  { key: "comms", label: "Phone / SIM / comms set up", group: "Equipment", required: false, internalOnly: true },
  { key: "welcome", label: "Welcome & orientation session", group: "Orientation", required: true, internalOnly: true },
  { key: "policy", label: "Policy & code-of-conduct acknowledgement", group: "Orientation", required: true },
  { key: "manager1on1", label: "Manager 1:1 / expectations set", group: "Orientation", required: false },
  { key: "role", label: "Role assigned", group: "Role & Competence", required: true },
  { key: "competence", label: "Competence baseline assessment scheduled", group: "Role & Competence", required: false },
];

/**
 * OD `personCategory` (js/modules.js): `type==='Contractor' ? 'External' :
 * 'Internal'`. The category is derived from the personnel type, not stored
 * alongside it, so there is one source of truth when a contract is converted.
 */
export function personCategory(personnelType: string | null | undefined): "Internal" | "External" {
  return personnelType === "Contractor" ? "External" : "Internal";
}

/** OD's External-personnel filter over the template. */
export function onboardTemplateFor(isExternal: boolean) {
  return ONBOARD_TEMPLATE.filter((t) => !(isExternal && t.internalOnly));
}

export async function listOnboardingItems(auth: AuthContext, userId: string) {
  const user = await requireManagedUser(auth, userId);
  const existing = await PersonnelOnboardingItem.findAll({ where: { userId, orgId: user.orgId }, order: [["seq", "ASC"]] });
  if (existing.length > 0) return existing.map((r) => r.get({ plain: true }));
  // Lazily seed the default checklist on first read, same pattern as the
  // 1:1 personnel-profile findOrCreate.
  const template = onboardTemplateFor(personCategory(user.personnelType) === "External");
  const seeded = await Promise.all(
    template.map((t, seq) =>
      PersonnelOnboardingItem.create({
        orgId: user.orgId, userId, label: t.label, group: t.group, required: t.required, seq,
      }),
    ),
  );
  return seeded.map((r) => r.get({ plain: true }));
}

export async function addOnboardingItem(auth: AuthContext, userId: string, label: string) {
  const user = await requireManagedUser(auth, userId);
  if (!label || !label.trim()) throw new BadRequestError("label is required", "LABEL_REQUIRED");
  const count = await PersonnelOnboardingItem.count({ where: { userId, orgId: user.orgId } });
  const row = await PersonnelOnboardingItem.create({ orgId: user.orgId, userId, label: label.trim(), seq: count });
  await logPersonnelActivity(auth, user.orgId, userId, "onboarding.item_added", row.label);
  return row.get({ plain: true });
}

export async function setOnboardingItemDone(auth: AuthContext, userId: string, id: string, done: boolean) {
  const user = await requireManagedUser(auth, userId);
  const row = await PersonnelOnboardingItem.findOne({ where: { id, userId, orgId: user.orgId } });
  if (!row) throw new NotFoundError("Onboarding item not found", "ONBOARDING_ITEM_NOT_FOUND");
  const who = await actorName(auth);
  row.done = done;
  row.doneAt = done ? new Date() : null;
  row.doneBy = done ? who : null;
  await row.save();
  await logPersonnelActivity(auth, user.orgId, userId, done ? "onboarding.item_completed" : "onboarding.item_reopened", row.label);
  return row.get({ plain: true });
}
