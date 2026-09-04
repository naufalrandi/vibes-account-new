import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, seedActionCatalog } from "../../../test/helpers";
import { grantEverythingExceptSpOnly } from "../iam/tenantGrants";

/**
 * Banks / Holidays / Business Processes / Fiscal Periods — the four
 * Enterprise → Database screens the frontend has always called and this module
 * never implemented, so every one of them 404'd against the real API.
 */
const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

async function tenant(username: string, code: string) {
  await seedActionCatalog();
  const org = await Organization.create({
    name: code, code, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: null, fullName: "Admin", username, email: `${username}@axia.io`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantEverythingExceptSpOnly(role.id);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return login.body.data.accessToken as string;
}

describe("reference-db master data", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("banks: full CRUD, name required, org-scoped", async () => {
    const token = await tenant("rdb1", "RDB1");
    expect((await request(app).get("/v1/reference-db/banks").set(authed(token))).body.data).toEqual([]);

    expect((await request(app).post("/v1/reference-db/banks").set(authed(token)).send({ name: "  " })).status).toBe(400);

    const made = await request(app).post("/v1/reference-db/banks").set(authed(token))
      .send({ name: "Bank Mandiri", code: "008", swift: "BMRIIDJA", country: "ID", countryName: "Indonesia", type: "State" });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ name: "Bank Mandiri", code: "008", type: "State" });

    const id = made.body.data.id;
    expect((await request(app).put(`/v1/reference-db/banks/${id}`).set(authed(token)).send({ type: "Digital" })).body.data.type).toBe("Digital");
    // An unknown type falls back to the current value rather than being stored.
    expect((await request(app).put(`/v1/reference-db/banks/${id}`).set(authed(token)).send({ type: "Nonsense" })).body.data.type).toBe("Digital");
    expect((await request(app).delete(`/v1/reference-db/banks/${id}`).set(authed(token))).status).toBe(200);
    expect((await request(app).get("/v1/reference-db/banks").set(authed(token))).body.data).toEqual([]);
  });

  it("holidays: requires a name and a date", async () => {
    const token = await tenant("rdb2", "RDB2");
    expect((await request(app).post("/v1/reference-db/holidays").set(authed(token)).send({ name: "Nyepi" })).status).toBe(400);
    expect((await request(app).post("/v1/reference-db/holidays").set(authed(token)).send({ date: "2026-03-19" })).status).toBe(400);

    const made = await request(app).post("/v1/reference-db/holidays").set(authed(token))
      .send({ name: "Nyepi", date: "2026-03-19", type: "Religious", dayOff: true, country: "ID" });
    expect(made.body.data).toMatchObject({ name: "Nyepi", date: "2026-03-19", type: "Religious", dayOff: true });
  });

  it("business processes: unique within a group / sub-group", async () => {
    const token = await tenant("rdb3", "RDB3");
    const body = { group: "Human Resources", subgroup: "Recruitment", name: "Hiring" };
    expect((await request(app).post("/v1/reference-db/business-processes").set(authed(token)).send(body)).status).toBe(201);

    const dup = await request(app).post("/v1/reference-db/business-processes").set(authed(token)).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("PROCESS_EXISTS");

    // Same name under a different sub-group is fine.
    expect((await request(app).post("/v1/reference-db/business-processes").set(authed(token))
      .send({ ...body, subgroup: "Onboarding" })).status).toBe(201);
  });

  it("fiscal periods: seeded on first read, regenerated on change, per-period toggle", async () => {
    const token = await tenant("rdb4", "RDB4");
    const first = await request(app).get("/v1/reference-db/fiscal-periods").set(authed(token));
    expect(first.status).toBe(200);
    expect(first.body.data.periodType).toBe("Monthly");
    expect(first.body.data.periods).toHaveLength(12);
    expect(first.body.data.periods.every((p: { status: string }) => p.status === "Open")).toBe(true);

    const quarterly = await request(app).put("/v1/reference-db/fiscal-periods").set(authed(token)).send({ periodType: "Quarterly" });
    expect(quarterly.body.data.periods).toHaveLength(4);
    expect(quarterly.body.data.periods[0].name).toMatch(/^Q1 /);

    const pid = quarterly.body.data.periods[0].id;
    const closed = await request(app).patch(`/v1/reference-db/fiscal-periods/${pid}`).set(authed(token)).send({ status: "Closed" });
    expect(closed.body.data.periods[0].status).toBe("Closed");
    expect(closed.body.data.periods[1].status).toBe("Open");

    expect((await request(app).patch("/v1/reference-db/fiscal-periods/nope").set(authed(token)).send({ status: "Closed" })).status).toBe(404);
    expect((await request(app).put("/v1/reference-db/fiscal-periods").set(authed(token)).send({ startMonth: 13 })).status).toBe(400);
  });
});
