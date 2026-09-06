import { describe, expect, it, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { initModels, Organization, BusinessRecord } from "../models";
import { seedBusinessRecords } from "./businessRecordsSeed";
import { CMS_PAGES, CMS_POSTS, CMS_MEDIA, CMS_MENU } from "./cms.data";

/**
 * R173 — the Website CMS screen reads the five `ent-mkt-*` Business registers,
 * not the first-class `cms_*` tables the CMS seeder fills. Nothing seeded the
 * registers, so against a live API every tab of the screen was empty while the
 * content sat in tables the screen never queries. This pins that both halves
 * come from the one `cms.data.ts`.
 */
describe("Website CMS business registers seed", () => {
  beforeAll(() => initModels());

  it("seeds every ent-mkt-* collection from the same CMS dataset", async () => {
    const org = await Organization.create({
      name: `Cms-${randomUUID()}`, code: `CMS-${randomUUID().slice(0, 8)}`, type: "Tenant",
      status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null,
      country: null, address: null,
    });

    await seedBusinessRecords(org.id);

    const countOf = (module: string) => BusinessRecord.count({ where: { orgId: org.id, module } });
    expect(await countOf("ent-mkt-pages")).toBe(CMS_PAGES.length);
    expect(await countOf("ent-mkt-posts")).toBe(CMS_POSTS.length);
    expect(await countOf("ent-mkt-media")).toBe(CMS_MEDIA.length);
    expect(await countOf("ent-mkt-menu")).toBe(CMS_MENU.length);
    expect(await countOf("ent-mkt-settings")).toBe(1);

    // Each row keeps OD's own id and the status the screen filters on.
    const home = await BusinessRecord.findOne({ where: { orgId: org.id, module: "ent-mkt-pages", code: "PG-0001" } });
    expect(home?.title).toBe("Home");
    expect(home?.status).toBe("Published");
    expect((home?.data as Record<string, unknown>).slug).toBe("home");

    // A draft page stays a draft — the register is not flattened to one status.
    const careers = await BusinessRecord.findOne({ where: { orgId: org.id, module: "ent-mkt-pages", code: "PG-0008" } });
    expect(careers?.status).toBe("Draft");
  });
});
