import { createUser } from "./user.service";
import { OrgUnit, Site } from "../../db/models";
import { BadRequestError } from "../../lib/errors";
import type { AuthContext } from "../../lib/scope";
import { logPersonnelActivity } from "./personnelActivity.service";

/**
 * List-level "Add Profile" flow (OD `personAddProfile`, `modules.js:5522-5539`,
 * 11 fields). Creates the personnel record itself — a `User` row (this
 * backend has no separate person entity; `User` IS the personnel record,
 * `parity/backend.md`) — including the four HR-specific columns, in one
 * INSERT through `createUser` (Team Management's own create path).
 */
export interface AddProfileInput {
  orgId: string;
  fullName: string;
  username: string;
  email: string;
  position?: string | null;
  phone?: string | null;
  workUnit?: string | null;
  siteId?: string | null;
  personnelType?: string | null;
  orgUnitId?: string | null;
  empLevel?: string | null;
  company?: string | null;
}

export async function createPersonnelProfile(auth: AuthContext, input: AddProfileInput, ip: string | null) {
  // Site and org unit must belong to the org the profile is created in (as
  // `updateUser` enforces for siteId) — never another tenant's.
  if (input.siteId && !(await Site.findOne({ where: { id: input.siteId, orgId: input.orgId } }))) {
    throw new BadRequestError("Site does not belong to this organization", "SITE_NOT_FOUND");
  }
  if (input.orgUnitId && !(await OrgUnit.findOne({ where: { id: input.orgUnitId, orgId: input.orgId } }))) {
    throw new BadRequestError("Org unit does not belong to this organization", "ORG_UNIT_NOT_FOUND");
  }
  const user = await createUser(
    auth,
    {
      orgId: input.orgId,
      fullName: input.fullName,
      username: input.username,
      email: input.email,
      position: input.position ?? null,
      phone: input.phone ?? null,
      workUnit: input.workUnit ?? null,
      siteId: input.siteId ?? null,
      personnelType: input.personnelType ?? null,
      orgUnitId: input.orgUnitId ?? null,
      empLevel: input.empLevel ?? null,
      company: input.company ?? null,
    },
    ip,
  );
  await logPersonnelActivity(auth, user.orgId, user.id, "personnel.profile_created", user.fullName);
  // toJSON strips passwordHash and the activation/reset tokens.
  return user.toJSON();
}
