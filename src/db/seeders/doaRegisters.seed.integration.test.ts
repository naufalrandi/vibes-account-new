import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { initModels, Organization, BusinessRecord, User } from "../models";
import { seedBusinessRecords, seedEnterpriseSuppliers } from "./businessRecordsSeed";
import { PR_ITEM_CATS } from "./doaMatrix";

/**
 * R496 / M-152 / M-155 — the Procurement Policy screen (`ent-doa`) and the
 * Purchase Orders screen read `business_records`, so what OD keeps in
 * `db.doaMatrix`/`db.doaMethod` and resolves through `supById` has to arrive
 * there: 22 bands with a named band-2 approver, 11 sourcing methods, and a
 * `data.supplierId` that points at the seeded `ent-suppliers` row rather than
 * OD's own "84-n" id.
 */
describe("Procurement policy / purchase-order references seed", () => {
  let orgId = "";

  beforeAll(async () => {
    initModels();
    const org = await Organization.create({
      name: `Doa-${randomUUID()}`, code: `DOA-${randomUUID().slice(0, 8)}`, type: "Tenant",
      status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null,
      country: null, address: null,
    });
    orgId = org.id;
    // OD `doaSeedIfNeeded` sorts the L1..L8 pool by level DESCENDING and takes the
    // first, so the L8 manager outranks the L1 chief executive as band-2 approver.
    for (const [fullName, empLevel] of [["Chief Executive", "L1"], ["Dept Manager", "L8"], ["Junior Staff", "L11"]]) {
      await User.create({
        orgId, tenantId: null, fullName, username: `${fullName.replace(/\s/g, "")}-${randomUUID().slice(0, 6)}`,
        email: `${randomUUID().slice(0, 8)}@example.test`, passwordHash: null, status: "Active",
        position: null, phone: null, photo: null, workUnit: null, lastLogin: null,
        activationToken: null, resetToken: null, resetExpires: null, empLevel,
      });
    }
    await seedBusinessRecords(orgId);
    await seedEnterpriseSuppliers(orgId);
  }, 120_000);

  it("seeds two approval bands per category, with a named senior approver on band 2", async () => {
    const rows = await BusinessRecord.findAll({ where: { orgId, module: "ent-doa" } });
    const bands = rows.filter((r) => (r.data as Record<string, unknown>).kind !== "method");
    expect(bands).toHaveLength(PR_ITEM_CATS.length * 2);

    const top = bands.filter((b) => (b.data as Record<string, unknown>).max === "");
    expect(top).toHaveLength(PR_ITEM_CATS.length);
    for (const b of top) {
      expect(b.status).toBe("user");
      expect((b.data as Record<string, unknown>).approver).toBe("Dept Manager");
    }
  });

  it("seeds the per-category sourcing method beside the bands", async () => {
    const rows = await BusinessRecord.findAll({ where: { orgId, module: "ent-doa" } });
    const methods = rows.filter((r) => (r.data as Record<string, unknown>).kind === "method");
    expect(methods).toHaveLength(PR_ITEM_CATS.length);
    const byType = new Map(methods.map((m) => [(m.data as Record<string, unknown>).type as string, m]));
    expect(byType.get("Professional Services")?.status).toBe("Order");
    expect(byType.get("Vehicle")?.status).toBe("Direct");
  });

  it("points every purchase order at the seeded supplier record", async () => {
    const pos = await BusinessRecord.findAll({ where: { orgId, module: "ent-po" } });
    expect(pos.length).toBeGreaterThan(0);
    const supplierIds = new Set(
      (await BusinessRecord.findAll({ where: { orgId, module: "ent-suppliers" } })).map((s) => s.id),
    );
    for (const po of pos) {
      expect(supplierIds.has((po.data as Record<string, unknown>).supplierId as string)).toBe(true);
    }
  });

  it("points every nav item at the seeded page record", async () => {
    const menu = await BusinessRecord.findAll({ where: { orgId, module: "ent-mkt-menu" } });
    const pageIds = new Set(
      (await BusinessRecord.findAll({ where: { orgId, module: "ent-mkt-pages" } })).map((p) => p.id),
    );
    expect(menu.length).toBeGreaterThan(0);
    for (const m of menu) {
      expect(pageIds.has((m.data as Record<string, unknown>).target as string)).toBe(true);
    }
  });
});
