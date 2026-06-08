import { FrameworkGroup } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { ForbiddenError } from "../../lib/errors";

export interface FrameworkGroupView {
  id: string;
  name: string;
}

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can view framework groups");
  }
}

/** The fixed framework groups (Standards / Regulations), seeded by migration. */
export async function listFrameworkGroups(auth: AuthContext): Promise<FrameworkGroupView[]> {
  assertServiceOwner(auth);
  const rows = await FrameworkGroup.findAll({ order: [["name", "ASC"]] });
  return rows.map((g) => ({ id: g.id, name: g.name }));
}
