import { createUser } from "./user.service";
import type { AuthContext } from "../../lib/scope";
import { logPersonnelActivity } from "./personnelActivity.service";

/**
 * List-level "Add Profile" flow (OD `personAddProfile`, `modules.js:5522-5539`,
 * 11 fields). Creates the personnel record itself — a `User` row (this
 * backend has no separate person entity; `User` IS the personnel record,
 * `parity/backend.md`) — then applies the four HR-specific columns that
 * `createUser` (Team Management's own create path) doesn't set.
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
}

export async function createPersonnelProfile(auth: AuthContext, input: AddProfileInput, ip: string | null) {
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
    },
    ip,
  );
  user.siteId = input.siteId ?? null;
  user.personnelType = input.personnelType ?? null;
  user.orgUnitId = input.orgUnitId ?? null;
  user.empLevel = input.empLevel ?? null;
  await user.save();
  await logPersonnelActivity(auth, user.orgId, user.id, "personnel.profile_created", user.fullName);
  return user.get({ plain: true });
}
