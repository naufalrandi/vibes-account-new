import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const RD = [ACTIONS.BUSINESS_READ, ACTIONS.BUSINESS_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = RD): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Admin", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("reference database (Enterprise ent-db-*)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("seeds the canonical 9 ISCED education levels on first read, and supports CRUD", async () => {
    const { token } = await makeTenant("rd1", "RD1");
    const list = await request(app).get("/v1/reference-db/education-levels").set(authed(token));
    expect(list.body.data).toHaveLength(9);
    expect(list.body.data[0]).toMatchObject({ level: 0, label: "Early childhood education" });

    expect((await request(app).post("/v1/reference-db/education-levels").set(authed(token)).send({ level: 9, label: "Out of range" })).status).toBe(400);

    const level8Id = list.body.data.find((l: { level: number }) => l.level === 8).id;
    expect((await request(app).delete(`/v1/reference-db/education-levels/${level8Id}`).set(authed(token))).status).toBe(200);
    expect((await request(app).get("/v1/reference-db/education-levels").set(authed(token))).body.data).toHaveLength(8);

    const created = await request(app).post("/v1/reference-db/education-levels").set(authed(token)).send({ level: 8, label: "Doctoral or equivalent (custom)" });
    expect(created.status).toBe(201);
    const updated = await request(app).put(`/v1/reference-db/education-levels/${created.body.data.id}`).set(authed(token)).send({ label: "Doctoral fellowship" });
    expect(updated.body.data.label).toBe("Doctoral fellowship");
    expect((await request(app).get("/v1/reference-db/education-levels").set(authed(token))).body.data).toHaveLength(9);
  });

  it("seeds the full ISIC tree (766 nodes) with resolved parent links", async () => {
    const { token } = await makeTenant("rd2", "RD2");
    const list = await request(app).get("/v1/reference-db/industry-sectors").set(authed(token));
    expect(list.body.data).toHaveLength(766);
    const section = list.body.data.find((s: { code: string }) => s.code === "A");
    expect(section).toMatchObject({ level: 1, parentId: null });
    const division = list.body.data.find((s: { code: string }) => s.code === "01");
    expect(division.parentId).toBe(section.id);

    const custom = await request(app).post("/v1/reference-db/industry-sectors").set(authed(token)).send({ code: "ZZ99", label: "Custom sub-sector", parentId: section.id });
    expect(custom.body.data).toMatchObject({ level: 2, parentId: section.id });
  });

  it("seeds the ISCED-F tree (116 nodes) and supports platform-only extension fields", async () => {
    const { token } = await makeTenant("rd3", "RD3");
    const list = await request(app).get("/v1/reference-db/education-fields").set(authed(token));
    expect(list.body.data).toHaveLength(116);
    const narrow = list.body.data.find((f: { level: number }) => f.level === 2);

    const ext = await request(app).post("/v1/reference-db/education-fields").set(authed(token)).send({ label: "Cybersecurity", parentId: narrow.id });
    expect(ext.body.data.level).toBe(4);
    expect(ext.body.data.code).toMatch(new RegExp(`^EXT\\.${narrow.code}\\.\\d+$`));
  });

  it("seeds Countries (249) with the shared NACE Rev.2 framework auto-referenced by EU members", async () => {
    const { token } = await makeTenant("rd4", "RD4");
    const countries = await request(app).get("/v1/reference-db/countries").set(authed(token));
    expect(countries.body.data).toHaveLength(249);

    const frameworks = await request(app).get("/v1/reference-db/sector-frameworks").set(authed(token));
    const nace = frameworks.body.data.find((f: { name: string }) => f.name === "NACE Rev.2");
    expect(nace.levels.length).toBeGreaterThan(900);

    const germany = countries.body.data.find((c: { code: string }) => c.code === "DE");
    expect(germany).toMatchObject({ name: "Germany", currency: "EUR", language: "German", sectorFrameworkRef: nace.id });

    const indonesia = countries.body.data.find((c: { code: string }) => c.code === "ID");
    expect(indonesia.sectorLevels.length).toBeGreaterThan(2000);

    // Nested states/cities are whole-array replace on the country row (no separate endpoints).
    const updated = await request(app).put(`/v1/reference-db/countries/${germany.id}`).set(authed(token))
      .send({ regions: [{ name: "Bavaria", cities: ["Munich", "Nuremberg"] }] });
    expect(updated.body.data.regions).toEqual([{ name: "Bavaria", cities: ["Munich", "Nuremberg"] }]);
    expect(updated.body.data.edited).toBe(true);
  });

  it("falls a country's framework reference back to custom when its Sector Framework is deleted", async () => {
    const { token } = await makeTenant("rd5", "RD5");
    await request(app).get("/v1/reference-db/countries").set(authed(token)); // trigger seeding
    const frameworks = await request(app).get("/v1/reference-db/sector-frameworks").set(authed(token));
    const nace = frameworks.body.data.find((f: { name: string }) => f.name === "NACE Rev.2");

    await request(app).delete(`/v1/reference-db/sector-frameworks/${nace.id}`).set(authed(token));
    const countries = await request(app).get("/v1/reference-db/countries").set(authed(token));
    const germany = countries.body.data.find((c: { code: string }) => c.code === "DE");
    expect(germany.sectorFrameworkRef).toBeNull();
  });

  it("scopes per tenant and enforces action grants", async () => {
    const a = await makeTenant("rd6", "RD6");
    const b = await makeTenant("rd7", "RD7");
    await request(app).get("/v1/reference-db/education-levels").set(authed(a.token)); // seed org A only
    const bLevels = await request(app).get("/v1/reference-db/education-levels").set(authed(b.token));
    expect(bLevels.body.data).toHaveLength(9); // org B gets its own independent seed, not org A's

    const noGrant = await makeTenant("rd8", "RD8", []);
    expect((await request(app).get("/v1/reference-db/countries").set(authed(noGrant.token))).status).toBe(403);
    const readonly = await makeTenant("rd9", "RD9", [ACTIONS.BUSINESS_READ]);
    expect((await request(app).get("/v1/reference-db/countries").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/reference-db/countries").set(authed(readonly.token)).send({ code: "ZZ", name: "Test" })).status).toBe(403);
  });

  // D-12 gap: OD seeds national education frameworks (index.html:16786-16804)
  // for these 7 countries; the BE used to hard-code eduFramework:null,
  // eduLevels:[] for every country. D-7.5 gap: each eduLevels row must carry
  // the national qualification code (e.g. "Jenjang 6") separately from its
  // ISCED mapping.
  it("seeds national education frameworks for ID/AU/GB/MY/IE/SG/ZA", async () => {
    const { token } = await makeTenant("rd10", "RD10");
    const countries = await request(app).get("/v1/reference-db/countries").set(authed(token));
    const byCode = (code: string) => countries.body.data.find((c: { code: string }) => c.code === code);

    const expected: Record<string, { framework: string; count: number }> = {
      ID: { framework: "KKNI", count: 8 },
      AU: { framework: "AQF", count: 10 },
      GB: { framework: "RQF", count: 9 },
      MY: { framework: "MQF", count: 8 },
      IE: { framework: "NFQ", count: 10 },
      SG: { framework: "SGUS", count: 7 },
      ZA: { framework: "NQF", count: 10 },
    };
    for (const [code, { framework, count }] of Object.entries(expected)) {
      const c = byCode(code);
      expect(c.eduFramework).toBe(framework);
      expect(c.eduLevels).toHaveLength(count);
    }

    const indonesia = byCode("ID");
    expect(indonesia.eduLevels[4]).toMatchObject({ code: "Jenjang 6", label: "S1, D4", isced: "6", level: 6 });

    // A country outside the 7-framework seed still gets the pre-existing empty defaults.
    const germany = byCode("DE");
    expect(germany.eduFramework).toBeNull();
    expect(germany.eduLevels).toEqual([]);
  });
});
