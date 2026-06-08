import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const setRoles = (u: User, roles: Role[]) =>
  (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles(roles);

async function soLogin(): Promise<string> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const admin = await User.create({
    orgId: so.id, tenantId: null, fullName: "SO Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await setRoles(admin, [role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

/** A tenant org (optionally parented by a distributor) + an admin user with ticket grants. */
async function tenantLogin(code: string, username: string, parentOrgId: string | null): Promise<{ token: string; orgId: string }> {
  const t = await Organization.create({
    name: `Tenant ${code}`, code, type: "Tenant", status: "Active",
    parentOrgId, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  await t.update({ tenantId: t.id });
  const u = await User.create({
    orgId: t.id, tenantId: t.id, fullName: "Tenant User", username, email: `${username}@t.io`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Tenant Admin", tierScope: "Tenant", orgId: t.id, isSuperAdmin: false, status: true });
  await setRoles(u, [role]);
  await grantActions(role.id, [ACTIONS.TICKET_READ, ACTIONS.TICKET_CREATE, ACTIONS.TICKET_REPLY, ACTIONS.TICKET_MANAGE]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: t.id };
}

describe("tickets", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/tickets");
    expect(res.status).toBe(401);
  });

  it("creates a ticket with a TKT-2026-#### code, Open status and an initial message", async () => {
    const so = await soLogin();
    const { token } = await tenantLogin("TEN1", "tuser1", null);
    const res = await request(app).post("/v1/tickets").set(bearer(token))
      .send({ subject: "Help me", description: "I need assistance.", category: "Technical Support", priority: "High" });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^TKT-2026-\d{4}$/);
    expect(res.body.data.status).toBe("Open");
    expect(res.body.data.scope).toBe("tenant");
    expect(res.body.data.messages).toHaveLength(1);
    expect(res.body.data.activity[0].event).toBe("Ticket created");
    void so;
  });

  it("scopes ticket visibility per persona", async () => {
    const so = await soLogin();
    const a = await tenantLogin("TENA", "ua", null);
    const b = await tenantLogin("TENB", "ub", null);
    await request(app).post("/v1/tickets").set(bearer(a.token)).send({ subject: "A issue", description: "x", category: "Billing" });
    await request(app).post("/v1/tickets").set(bearer(b.token)).send({ subject: "B issue", description: "y", category: "Billing" });

    // Tenant A sees only its own ticket.
    const aList = await request(app).get("/v1/tickets").set(bearer(a.token));
    expect(aList.body.data).toHaveLength(1);
    expect(aList.body.data[0].subject).toBe("A issue");

    // SO sees both.
    const soList = await request(app).get("/v1/tickets").set(bearer(so));
    expect(soList.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("lets a Service Owner reply (as support), set status, and assign", async () => {
    const so = await soLogin();
    const { token } = await tenantLogin("TEN2", "tuser2", null);
    const created = await request(app).post("/v1/tickets").set(bearer(token)).send({ subject: "S", description: "d", category: "Bug Report" });
    const id = created.body.data.id;

    const reply = await request(app).post(`/v1/tickets/${id}/reply`).set(bearer(so)).send({ text: "Looking into it." });
    expect(reply.body.data.messages.at(-1).author.kind).toBe("support");

    const assigned = await request(app).post(`/v1/tickets/${id}/assign`).set(bearer(so)).send({ assignee: "Raka Pratama" });
    expect(assigned.body.data.assignedTo).toBe("Raka Pratama");

    const resolved = await request(app).post(`/v1/tickets/${id}/status`).set(bearer(so)).send({ status: "Resolved" });
    expect(resolved.body.data.status).toBe("Resolved");
    expect(resolved.body.data.activity.some((e: { event: string }) => e.event === "Ticket resolved")).toBe(true);
  });

  it("forbids a non-Service-Owner from changing status", async () => {
    const so = await soLogin();
    const { token } = await tenantLogin("TEN3", "tuser3", null);
    const created = await request(app).post("/v1/tickets").set(bearer(token)).send({ subject: "S3", description: "d", category: "Billing" });
    const res = await request(app).post(`/v1/tickets/${created.body.data.id}/status`).set(bearer(token)).send({ status: "Closed" });
    expect(res.status).toBe(403);
    void so;
  });

  it("blocks replies on a closed ticket", async () => {
    const so = await soLogin();
    const { token } = await tenantLogin("TEN4", "tuser4", null);
    const created = await request(app).post("/v1/tickets").set(bearer(token)).send({ subject: "S4", description: "d", category: "Billing" });
    await request(app).post(`/v1/tickets/${created.body.data.id}/status`).set(bearer(so)).send({ status: "Closed" });
    const res = await request(app).post(`/v1/tickets/${created.body.data.id}/reply`).set(bearer(token)).send({ text: "hi" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("TICKET_CLOSED");
  });
});
