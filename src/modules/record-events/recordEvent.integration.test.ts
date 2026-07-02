import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const MS = [ACTIONS.MS_READ, ACTIONS.MS_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = MS): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("record events (activity + comments)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("auto-logs activity on create/update and accepts comments", async () => {
    const { token } = await makeTenant("re1", "RE1");
    const created = await request(app).post("/v1/implementation/risks").set(authed(token)).send({ title: "Data breach", data: { likelihood: 3, impact: 3 } });
    const id = created.body.data.id;

    // Create logged one activity entry.
    let events = (await request(app).get(`/v1/record-events/risks/${id}`).set(authed(token))).body.data;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "activity", text: "Record created" });

    // A status change logs a second activity entry with the transition.
    await request(app).put(`/v1/implementation/risks/${id}`).set(authed(token)).send({ status: "Assessed" });
    events = (await request(app).get(`/v1/record-events/risks/${id}`).set(authed(token))).body.data;
    expect(events).toHaveLength(2);
    expect(events[1].text).toContain("Status changed");

    // A user comment appends to the timeline.
    const c = await request(app).post(`/v1/record-events/risks/${id}/comments`).set(authed(token)).send({ text: "Investigating root cause" });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ type: "comment", text: "Investigating root cause" });
    events = (await request(app).get(`/v1/record-events/risks/${id}`).set(authed(token))).body.data;
    expect(events).toHaveLength(3);
  });

  it("scopes the timeline to the caller's org and enforces grants", async () => {
    const a = await makeTenant("re2", "RE2");
    const b = await makeTenant("re3", "RE3");
    const created = await request(app).post("/v1/implementation/risks").set(authed(a.token)).send({ title: "A risk" });
    const id = created.body.data.id;
    // B sees no events for A's record (org-scoped).
    expect((await request(app).get(`/v1/record-events/risks/${id}`).set(authed(b.token))).body.data).toHaveLength(0);
    // A reader without MANAGE cannot comment.
    const readonly = await makeTenant("re4", "RE4", [ACTIONS.MS_READ]);
    expect((await request(app).post(`/v1/record-events/risks/${id}/comments`).set(authed(readonly.token)).send({ text: "x" })).status).toBe(403);
  });
});
