import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, TenantProfile, Ticket } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const ALL = [ACTIONS.TICKET_READ, ACTIONS.TICKET_CREATE, ACTIONS.TICKET_REPLY, ACTIONS.TICKET_MANAGE];

/** Create an org of the given type with a user holding the given grants; returns a token. */
async function actor(orgType: "ServiceOwner" | "Distributor" | "Tenant", code: string, username: string, actions: string[], parentOrgId: string | null = null) {
  const org = await Organization.create({ name: code, code, type: orgType, status: "Active", parentOrgId, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  if (orgType === "Tenant") { org.tenantId = org.id; await org.save(); }
  const user = await User.create({ orgId: org.id, tenantId: orgType === "Tenant" ? org.id : null, fullName: `${code} User`, username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `${code} R`, tierScope: orgType, orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { org, token: login.body.data.accessToken };
}

const NEW = { subject: "Help", description: "It broke", category: "Technical Support", priority: "High" };

describe("tickets", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires ticket.read", async () => {
    const a = await actor("Tenant", "T", "noaccess", []);
    expect((await request(app).get("/v1/tickets").set(authed(a.token))).status).toBe(403);
  });

  it("creates a ticket Open with code, first user message, and Pending SLA", async () => {
    const a = await actor("Tenant", "T", "t.user", ALL);
    const res = await request(app).post("/v1/tickets").set(authed(a.token)).send(NEW);
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^TKT-\d{4}-\d{4}$/);
    expect(res.body.data.status).toBe("Open");
    expect(res.body.data.scope).toBe("tenant");
    expect(res.body.data.messages).toHaveLength(1);
    expect(res.body.data.messages[0].author.kind).toBe("user");
    expect(res.body.data.sla).toMatchObject({ target: 8, firstResponse: null, status: "Pending" });
  });

  it("SP reply starts the SLA clock; status + assign update the timeline", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/tickets").set(authed(sp.token)).send(NEW);
    const id = created.body.data.id;

    const reply = await request(app).post(`/v1/tickets/${id}/reply`).set(authed(sp.token)).send({ text: "On it." });
    expect(reply.body.data.messages.at(-1).author.kind).toBe("support");
    // First support response → SLA Met (well within target).
    expect(reply.body.data.sla.status).toBe("Met");
    expect(typeof reply.body.data.sla.firstResponse).toBe("number");

    const assigned = await request(app).post(`/v1/tickets/${id}/assign`).set(authed(sp.token)).send({ assignee: "Raka" });
    expect(assigned.body.data.assignedTo).toBe("Raka");
    expect(assigned.body.data.activity.some((e: { event: string }) => e.event === "Assigned to Raka")).toBe(true);

    const resolved = await request(app).post(`/v1/tickets/${id}/status`).set(authed(sp.token)).send({ status: "Resolved" });
    expect(resolved.body.data.status).toBe("Resolved");
    expect(resolved.body.data.sla.resolution).not.toBeNull();
  });

  it("computes a Breached SLA from a late support response", async () => {
    const a = await actor("Tenant", "T", "t.user", ALL);
    // Critical target = 4h. Seed a ticket whose first support reply is 10h late.
    const ticket = await Ticket.create({
      code: "TKT-2026-9001", subject: "x", description: "x", category: "Technical Support", priority: "Critical",
      status: "Open", scope: "tenant", orgId: a.org.id, managedBy: null,
      createdBy: { name: "U", email: "u@x.io" }, assignedTo: null,
      messages: [
        { author: { name: "U", kind: "user" }, text: "down", ts: "2026-03-01T00:00:00.000Z" },
        { author: { name: "S", kind: "support" }, text: "looking", ts: "2026-03-01T10:00:00.000Z" },
      ],
      activity: [{ event: "Ticket created", ts: "2026-03-01T00:00:00.000Z" }], attachments: [],
    });
    const res = await request(app).get(`/v1/tickets/${ticket.id}`).set(authed(a.token));
    expect(res.body.data.sla).toMatchObject({ target: 4, firstResponse: 10, status: "Breached" });
  });

  it("rejects a reply to a closed ticket", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/tickets").set(authed(sp.token)).send(NEW);
    await request(app).post(`/v1/tickets/${created.body.data.id}/status`).set(authed(sp.token)).send({ status: "Closed" });
    const res = await request(app).post(`/v1/tickets/${created.body.data.id}/reply`).set(authed(sp.token)).send({ text: "hi" });
    expect(res.status).toBe(409);
  });

  it("scopes tickets — a Distributor sees its own + its tenants', not unrelated ones", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const dist = await actor("Distributor", "NPART", "partner", ALL, sp.org.id);
    // A tenant under the distributor.
    const tenant = await actor("Tenant", "GARUDA", "tenant", ALL, dist.org.id);
    await TenantProfile.create({ orgId: tenant.org.id, acquisition: "Partner", partnerOrgId: dist.org.id, billingOwner: null, status: "Active", subscriptionSummary: null, audit: [] });
    // An unrelated tenant directly under the SP.
    const other = await actor("Tenant", "OTHER", "other", ALL, sp.org.id);

    await request(app).post("/v1/tickets").set(authed(dist.token)).send({ ...NEW, subject: "Dist ticket" });
    await request(app).post("/v1/tickets").set(authed(tenant.token)).send({ ...NEW, subject: "Tenant ticket" });
    const otherTicket = await request(app).post("/v1/tickets").set(authed(other.token)).send({ ...NEW, subject: "Other ticket" });

    const distList = await request(app).get("/v1/tickets").set(authed(dist.token));
    const subjects = distList.body.data.map((t: { subject: string }) => t.subject).sort();
    expect(subjects).toEqual(["Dist ticket", "Tenant ticket"]);
    // And it cannot read the unrelated tenant's ticket.
    expect((await request(app).get(`/v1/tickets/${otherTicket.body.data.id}`).set(authed(dist.token))).status).toBe(403);
  });

  it("attaches file metadata to a ticket and logs the activity", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/tickets").set(authed(sp.token)).send(NEW);
    const id = created.body.data.id;
    const res = await request(app).post(`/v1/tickets/${id}/attach`).set(authed(sp.token)).send({ name: "log.txt", size: 2048 });
    expect(res.status).toBe(200);
    expect(res.body.data.attachments).toHaveLength(1);
    expect(res.body.data.attachments[0]).toMatchObject({ name: "log.txt", size: 2048 });
    expect(res.body.data.attachments[0].date).toBeTruthy();
    expect(res.body.data.activity.some((e: { event: string }) => e.event === "Attachment added: log.txt")).toBe(true);
  });

  it("accepts attachments supplied at ticket creation", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const res = await request(app).post("/v1/tickets").set(authed(sp.token)).send({ ...NEW, attachments: [{ name: "screenshot.png", size: 51200 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.attachments).toHaveLength(1);
    expect(res.body.data.attachments[0].name).toBe("screenshot.png");
  });

  it("rejects an attachment on a closed ticket", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    const created = await request(app).post("/v1/tickets").set(authed(sp.token)).send(NEW);
    await request(app).post(`/v1/tickets/${created.body.data.id}/status`).set(authed(sp.token)).send({ status: "Closed" });
    const res = await request(app).post(`/v1/tickets/${created.body.data.id}/attach`).set(authed(sp.token)).send({ name: "x.pdf", size: 10 });
    expect(res.status).toBe(409);
  });

  it("filters by status and priority", async () => {
    const sp = await actor("ServiceOwner", "AXIA", "soadmin", ALL);
    await request(app).post("/v1/tickets").set(authed(sp.token)).send({ ...NEW, priority: "Low" });
    await request(app).post("/v1/tickets").set(authed(sp.token)).send({ ...NEW, priority: "Critical" });
    const res = await request(app).get("/v1/tickets?priority=Critical").set(authed(sp.token));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].priority).toBe("Critical");
  });
});
