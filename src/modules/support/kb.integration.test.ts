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
    orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await setRoles(admin, [role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

/** A Tenant user that holds KB_READ but is not the Service Owner. */
async function tenantReader(): Promise<string> {
  const t = await Organization.create({
    name: "Acme", code: "ACME-K", type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const u = await User.create({
    orgId: t.id, tenantId: t.id, fullName: "T", username: "treader", email: "t@acme.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Tenant Member", tierScope: "Tenant", orgId: t.id, isSuperAdmin: false, status: true });
  await setRoles(u, [role]);
  await grantActions(role.id, [ACTIONS.KB_READ]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "treader", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

describe("knowledge base", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    const res = await request(app).get("/v1/kb-articles");
    expect(res.status).toBe(401);
  });

  it("creates an article with a KB-2026-#### code and category name", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/kb-articles").set(bearer(token))
      .send({ title: "How to X", category: "platform", status: "Published", content: "# X", keywords: ["x"] });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^KB-2026-\d{4}$/);
    expect(res.body.data.categoryName).toBe("Platform Guides");
    expect(res.body.data.publishedAt).not.toBeNull();
  });

  it("rejects an invalid category", async () => {
    const token = await soLogin();
    const res = await request(app).post("/v1/kb-articles").set(bearer(token)).send({ title: "Y", category: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CATEGORY");
  });

  it("hides Draft articles from non-Service-Owner readers", async () => {
    const soToken = await soLogin();
    await request(app).post("/v1/kb-articles").set(bearer(soToken)).send({ title: "Pub", category: "faq", status: "Published" });
    const draft = await request(app).post("/v1/kb-articles").set(bearer(soToken)).send({ title: "Draft", category: "faq", status: "Draft" });

    const tToken = await tenantReader();
    const list = await request(app).get("/v1/kb-articles").set(bearer(tToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].title).toBe("Pub");

    // The draft is 404 to a non-SP reader.
    const getDraft = await request(app).get(`/v1/kb-articles/${draft.body.data.id}`).set(bearer(tToken));
    expect(getDraft.status).toBe(404);
  });

  it("forbids a non-Service-Owner from creating an article", async () => {
    const tToken = await tenantReader();
    const res = await request(app).post("/v1/kb-articles").set(bearer(tToken)).send({ title: "Z", category: "faq" });
    expect(res.status).toBe(403);
  });

  it("publishes, archives, votes and tracks views", async () => {
    const token = await soLogin();
    const created = await request(app).post("/v1/kb-articles").set(bearer(token)).send({ title: "Lifecycle", category: "platform", status: "Draft" });
    const id = created.body.data.id;

    const pub = await request(app).post(`/v1/kb-articles/${id}/publish`).set(bearer(token));
    expect(pub.body.data.status).toBe("Published");

    const viewed = await request(app).get(`/v1/kb-articles/${id}?track=1`).set(bearer(token));
    expect(viewed.body.data.views).toBe(1);

    const voted = await request(app).post(`/v1/kb-articles/${id}/vote`).set(bearer(token)).send({ helpful: true });
    expect(voted.body.data.helpful).toBe(1);

    const arch = await request(app).post(`/v1/kb-articles/${id}/archive`).set(bearer(token));
    expect(arch.body.data.status).toBe("Archived");
  });

  it("exposes the category catalog", async () => {
    const token = await soLogin();
    const res = await request(app).get("/v1/kb-articles/categories").set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: { id: string }) => c.id === "platform")).toBe(true);
  });
});
