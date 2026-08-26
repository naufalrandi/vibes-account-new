import { PersonnelOnboardingItem } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { requireManagedUser } from "./user.service";
import { logPersonnelActivity } from "./personnelActivity.service";
import { actorName } from "../record-events/recordEvent.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

const DEFAULT_CHECKLIST = [
  "Offer letter signed",
  "ID / tax documents collected",
  "Workstation & access provisioned",
  "Company orientation completed",
  "Probation review scheduled",
];

export async function listOnboardingItems(auth: AuthContext, userId: string) {
  const user = await requireManagedUser(auth, userId);
  const existing = await PersonnelOnboardingItem.findAll({ where: { userId, orgId: user.orgId }, order: [["seq", "ASC"]] });
  if (existing.length > 0) return existing.map((r) => r.get({ plain: true }));
  // Lazily seed the default checklist on first read, same pattern as the
  // 1:1 personnel-profile findOrCreate.
  const seeded = await Promise.all(
    DEFAULT_CHECKLIST.map((label, seq) => PersonnelOnboardingItem.create({ orgId: user.orgId, userId, label, seq })),
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
