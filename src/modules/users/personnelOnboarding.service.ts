import { PersonnelOnboardingItem, type User } from "../../db/models";
import { withCodeLock } from "../../lib/codeSeq";
import type { AuthContext } from "../../lib/scope";
import { requireManagedUser } from "./user.service";
import { getOrCreateProfile } from "./personnelProfile.service";
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

/** Id a template task carries on a read before the checklist is persisted. */
const TEMPLATE_ID_PREFIX = "template:";

function templateFor(user: User) {
  return onboardTemplateFor(personCategory(user.personnelType) === "External");
}

/**
 * The person's persisted checklist, seeded from the template on the first
 * write that needs it (reads never write). Serialised per person so two
 * concurrent first writes can't seed it twice.
 */
async function ensureChecklist(user: User): Promise<PersonnelOnboardingItem[]> {
  return withCodeLock(`ONBOARDING:${user.id}`, null, async (tx) => {
    const where = { userId: user.id, orgId: user.orgId };
    const existing = await PersonnelOnboardingItem.findAll({ where, order: [["seq", "ASC"]], transaction: tx });
    if (existing.length > 0) return existing;
    return PersonnelOnboardingItem.bulkCreate(
      templateFor(user).map((t, seq) => ({ ...where, label: t.label, group: t.group, required: t.required, seq })),
      { transaction: tx, returning: true },
    );
  });
}

export async function listOnboardingItems(auth: AuthContext, userId: string) {
  const user = await requireManagedUser(auth, userId);
  const existing = await PersonnelOnboardingItem.findAll({ where: { userId, orgId: user.orgId }, order: [["seq", "ASC"]] });
  if (existing.length > 0) return existing.map((r) => r.get({ plain: true }));
  // Nothing persisted yet: show the default checklist without writing it. Its
  // tasks carry `template:<key>` ids, which the first toggle resolves after seeding.
  return templateFor(user).map((t, seq) => ({
    ...PersonnelOnboardingItem.build({ orgId: user.orgId, userId, label: t.label, group: t.group, required: t.required, seq, doneAt: null, doneBy: null }).get({ plain: true }),
    id: `${TEMPLATE_ID_PREFIX}${t.key}`,
  }));
}

export async function addOnboardingItem(auth: AuthContext, userId: string, label: string) {
  const user = await requireManagedUser(auth, userId);
  if (!label || !label.trim()) throw new BadRequestError("label is required", "LABEL_REQUIRED");
  const items = await ensureChecklist(user);
  const row = await PersonnelOnboardingItem.create({ orgId: user.orgId, userId, label: label.trim(), seq: items.length });
  await logPersonnelActivity(auth, user.orgId, userId, "onboarding.item_added", row.label);
  return row.get({ plain: true });
}

export async function setOnboardingItemDone(auth: AuthContext, userId: string, id: string, done: boolean) {
  const user = await requireManagedUser(auth, userId);
  const items = await ensureChecklist(user);
  const tpl = id.startsWith(TEMPLATE_ID_PREFIX) ? ONBOARD_TEMPLATE.find((t) => t.key === id.slice(TEMPLATE_ID_PREFIX.length)) : undefined;
  const row = tpl ? items.find((i) => i.label === tpl.label) : items.find((i) => i.id === id);
  if (!row) throw new NotFoundError("Onboarding item not found", "ONBOARDING_ITEM_NOT_FOUND");
  const who = await actorName(auth);
  row.done = done;
  row.doneAt = done ? new Date() : null;
  row.doneBy = done ? who : null;
  await row.save();
  await logPersonnelActivity(auth, user.orgId, userId, done ? "onboarding.item_completed" : "onboarding.item_reopened", row.label);
  return row.get({ plain: true });
}

/**
 * OD `personOnboardComplete` (js/modules.js) — close out onboarding and bring
 * the employee fully on.
 *
 * The gate is OD's: every REQUIRED task must be done ("Complete all required
 * tasks first"). Optional tasks may be left open. On success the employment
 * status moves Onboarding -> Active, which is the transition the Onboarding
 * status exists to carry.
 */
export async function completeOnboarding(auth: AuthContext, userId: string) {
  const user = await requireManagedUser(auth, userId);
  const items = await ensureChecklist(user);
  const outstanding = items.filter((i) => i.required && !i.done);
  if (outstanding.length > 0) {
    throw new BadRequestError("Complete all required tasks first", "ONBOARDING_REQUIRED_OUTSTANDING");
  }
  const profile = await getOrCreateProfile(userId);
  profile.employmentStatus = "Active";
  await profile.save();
  await logPersonnelActivity(auth, user.orgId, userId, "onboarding.completed", null);
  return profile.get({ plain: true });
}

/** OD `personOnboardReopen` — put someone back into onboarding. */
export async function reopenOnboarding(auth: AuthContext, userId: string) {
  const user = await requireManagedUser(auth, userId);
  const profile = await getOrCreateProfile(userId);
  profile.employmentStatus = "Onboarding";
  await profile.save();
  await logPersonnelActivity(auth, user.orgId, userId, "onboarding.reopened", null);
  return profile.get({ plain: true });
}
