import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { initModels, Organization, BusinessProcess } from "../models";
import { seedBpCatalog } from "./businessProcess";
import { BP_CATALOG } from "./businessProcess.data";

/**
 * SOF-381 — verifies the 385-row OD `db.bpCatalog` master catalog seeds into
 * an org's `business_processes` register and that the natural-key
 * (orgId, catalogKey) upsert is idempotent (rerunning adds nothing, matching
 * the cms.ts / isra.ts seeder pattern).
 */
describe("Business Process catalog seed (SOF-381)", () => {
  beforeAll(() => initModels());

  it("seeds exactly 385 catalog rows preserving group/subgroup hierarchy, idempotently", async () => {
    const org = await Organization.create({
      name: `BpCat-${randomUUID()}`, code: `BPC-${randomUUID().slice(0, 8)}`, type: "Tenant",
      status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null,
      country: null, address: null,
    });

    expect(BP_CATALOG.length).toBe(385);

    await seedBpCatalog(org.id);
    const count = await BusinessProcess.count({ where: { orgId: org.id } });
    expect(count).toBe(385);

    const row = await BusinessProcess.findOne({ where: { orgId: org.id, catalogKey: "BPC-1001" } });
    expect(row).toMatchObject({
      name: "Front End Development", group: "Software Development", subgroup: "General",
      sourceType: "Catalog", status: "Active",
    });

    // Idempotent rerun — no duplicates, no new codes issued.
    await seedBpCatalog(org.id);
    const countAfterRerun = await BusinessProcess.count({ where: { orgId: org.id } });
    expect(countAfterRerun).toBe(385);
  });
});
