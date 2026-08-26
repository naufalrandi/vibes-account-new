import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const PEV = [ACTIONS.PERFEVAL_READ, ACTIONS.PERFEVAL_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = PEV): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "QM Evaluator", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

const RECORD = {
  period: "Q3 2026",
  date: "2026-09-30",
  owner: "QM Evaluator",
  summary: "Overall performance is trending positively across measured processes.",
  indicators: [
    { name: "Customer satisfaction score", cat: "Customer", src: "Surveys", unit: "%", dir: "up", target: "90", val: "92", status: "Met" },
    { name: "Nonconformity closure rate", cat: "Process", src: "NC Register", unit: "%", dir: "up", target: "95", val: "88", status: "Below Target" },
  ],
};

describe("performance evaluation", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates, lists (sorted by date desc), gets and updates a record with an auto code", async () => {
    const { token } = await makeTenant("pe1", "PE1");

    expect((await request(app).post("/v1/performance-evaluation").set(authed(token)).send({ ...RECORD, owner: "" })).status).toBe(400);

    const created = await request(app).post("/v1/performance-evaluation").set(authed(token)).send(RECORD);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: "PEV-0001", period: "Q3 2026", owner: "QM Evaluator" });
    expect(created.body.data.indicators).toHaveLength(2);
    const id = created.body.data.id;

    const second = await request(app).post("/v1/performance-evaluation").set(authed(token)).send({ ...RECORD, period: "Q2 2026", date: "2026-06-30" });
    expect(second.body.data.code).toBe("PEV-0002");

    const list = await request(app).get("/v1/performance-evaluation").set(authed(token));
    expect(list.body.data.map((r: { period: string }) => r.period)).toEqual(["Q3 2026", "Q2 2026"]);

    const got = await request(app).get(`/v1/performance-evaluation/${id}`).set(authed(token));
    expect(got.status).toBe(200);
    expect(got.body.data.code).toBe("PEV-0001");

    const updated = await request(app).put(`/v1/performance-evaluation/${id}`).set(authed(token)).send({ summary: "Revised conclusions." });
    expect(updated.body.data.summary).toBe("Revised conclusions.");
    expect(updated.body.data.indicators).toHaveLength(2);
  });

  it("scopes per tenant and enforces action grants", async () => {
    const a = await makeTenant("pe2", "PE2");
    const b = await makeTenant("pe3", "PE3");
    await request(app).post("/v1/performance-evaluation").set(authed(a.token)).send(RECORD);
    expect((await request(app).get("/v1/performance-evaluation").set(authed(b.token))).body.data).toHaveLength(0);

    const noGrant = await makeTenant("pe4", "PE4", []);
    expect((await request(app).get("/v1/performance-evaluation").set(authed(noGrant.token))).status).toBe(403);
    const readonly = await makeTenant("pe5", "PE5", [ACTIONS.PERFEVAL_READ]);
    expect((await request(app).get("/v1/performance-evaluation").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/performance-evaluation").set(authed(readonly.token)).send(RECORD)).status).toBe(403);

    const other = await request(app).post("/v1/performance-evaluation").set(authed(a.token)).send(RECORD);
    expect((await request(app).get(`/v1/performance-evaluation/${other.body.data.id}`).set(authed(b.token))).status).toBe(403);
  });
});
