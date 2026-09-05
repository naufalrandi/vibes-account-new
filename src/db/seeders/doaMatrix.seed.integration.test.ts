import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { initModels, Organization, DoaMatrixEntry } from "../models";
import { seedDoaMatrix } from "./doaMatrix";

/**
 * The DoA matrix decides whether a purchase request needs a Finance sign-off and
 * competitive quotes, so a wrong seed silently removes an approval gate rather than
 * failing loudly. Pins the two facts OD's `doaSeedIfNeeded` (js/modules.js:4297-4300)
 * fixes and this seeder previously left unset:
 *   - the Role band's ceiling, 1,000,000 IDR for Professional Services and 5,000,000
 *     for the other ten categories (it was seeded null, i.e. unbounded, which
 *     collapses the two bands into one and routes everything to the Line Manager);
 *   - `quotes` on the Finance band, true for every category except Professional
 *     Services (`quotes:!ps`).
 */
describe("DoA matrix seed", () => {
  beforeAll(() => initModels());

  it("seeds 22 rows with OD's per-category ceilings and quote requirements", async () => {
    const org = await Organization.create({
      name: `Doa-${randomUUID()}`, code: `DOA-${randomUUID().slice(0, 8)}`, type: "Tenant",
      status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null,
      country: null, address: null,
    });

    await seedDoaMatrix(org.id);

    const rows = await DoaMatrixEntry.findAll({ where: { orgId: org.id } });
    expect(rows).toHaveLength(22);
    expect(rows.every((r) => r.currency === "IDR")).toBe(true);

    const band = (type: string, finance: boolean) =>
      rows.find((r) => r.type === type && r.finance === finance);

    // Role band — a real ceiling, an order of magnitude lower for Professional Services.
    expect(Number(band("Professional Services", false)!.max)).toBe(1_000_000);
    expect(Number(band("Software", false)!.max)).toBe(5_000_000);
    expect(Number(band("Vehicle", false)!.max)).toBe(5_000_000);
    expect(band("Software", false)!.approver).toBe("Line Manager");
    expect(band("Software", false)!.approverKind).toBe("role");

    // Finance band — open-ended, quotes everywhere except Professional Services.
    expect(band("Software", true)!.max).toBeNull();
    expect(band("Software", true)!.quotes).toBe(true);
    expect(band("Professional Services", true)!.quotes).toBe(false);
    expect(band("Software", true)!.approverKind).toBe("user");

    // Idempotent rerun — findOrCreate must not duplicate the matrix.
    await seedDoaMatrix(org.id);
    expect(await DoaMatrixEntry.count({ where: { orgId: org.id } })).toBe(22);
  });
});
