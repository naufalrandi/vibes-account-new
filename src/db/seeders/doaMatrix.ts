/**
 * SOF-407 (design: SOF-386, revision 8c8dc4ed) — seeds the demo tenant's
 * Delegation-of-Authority spend matrix: 11 `PR_ITEM_CATS` categories x 2
 * bands (Role, Finance) = 22 `DoaMatrixEntry` rows, per OD's `doaSeedIfNeeded`
 * (modules.js:4293-4306).
 *
 * `DoaMatrixEntry.approver` is a plain string column with no FK — the Role
 * band is always the literal "Line Manager"; the Finance band uses the
 * `fullName` of the org's tier-A/L1 (CEO) user created by `seedOrgUnits`,
 * falling back to the literal "Head of Department" if that user doesn't
 * exist (matches OD's own `doaSeniorUsers()` fallback). Must run after
 * `seedOrgUnits(orgId)`.
 */
import { DoaMatrixEntry, User } from "../models";

/** OD `PR_ITEM_CATS`, app.html:30734 — copied verbatim (see `lib/procurement/suppliers.ts`). */
const PR_ITEM_CATS = [
  "Vehicle", "Electronics - Endpoint Devices", "Electronics - Network and Infrastructure",
  "Electronics - Other Devices", "Non-Electronics", "Software", "Professional Services",
  "Land", "Buildings", "Machinery", "Furniture and Fixtures",
] as const;

const FINANCE_FALLBACK_APPROVER = "Head of Department";

export async function seedDoaMatrix(orgId: string): Promise<void> {
  const ceo = await User.findOne({ where: { orgId, empLevel: "L1" } });
  const financeApprover = ceo?.fullName ?? FINANCE_FALLBACK_APPROVER;

  for (const type of PR_ITEM_CATS) {
    await DoaMatrixEntry.findOrCreate({
      where: { orgId, type, finance: false },
      defaults: {
        orgId, type, max: null, approver: "Line Manager", approverKind: "role",
        finance: false, quotes: false,
      },
    });
    await DoaMatrixEntry.findOrCreate({
      where: { orgId, type, finance: true },
      defaults: {
        orgId, type, max: null, approver: financeApprover, approverKind: "user",
        finance: true, quotes: false,
      },
    });
  }
}
