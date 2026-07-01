import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Notification } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeUser(username: string, code: string, type: "ServiceOwner" | "Tenant", actions: string[]): Promise<{ token: string; orgId: string; userId: string }> {
  const org = await Organization.create({ name: code, code, type, status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: type, orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id, userId: user.id };
}

describe("Knowledge Base", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("lists the category catalog", async () => {
    const { token } = await makeUser("so", "AXIA", "ServiceOwner", [ACTIONS.KB_READ]);
    const cats = await request(app).get("/v1/kb-articles/categories").set(authed(token));
    expect(cats.body.data.map((c: { id: string }) => c.id)).toContain("platform");
  });

  it("CRUDs an article with auto code, categoryName, publish + view tracking + vote", async () => {
    const { token } = await makeUser("so", "AXIA", "ServiceOwner", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    const created = await request(app).post("/v1/kb-articles").set(authed(token)).send({ title: "Getting Started", category: "platform" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: "KB-2026-0001", categoryName: "Platform Guides", status: "Draft" });
    const id = created.body.data.id;

    const published = await request(app).post(`/v1/kb-articles/${id}/publish`).set(authed(token));
    expect(published.body.data.status).toBe("Published");
    expect(published.body.data.publishedAt).not.toBeNull();

    const viewed = await request(app).get(`/v1/kb-articles/${id}?track=1`).set(authed(token));
    expect(viewed.body.data.views).toBe(1);

    const voted = await request(app).post(`/v1/kb-articles/${id}/vote`).set(authed(token)).send({ helpful: true });
    expect(voted.body.data.helpful).toBe(1);

    const filtered = await request(app).get("/v1/kb-articles?category=platform&status=Published").set(authed(token));
    expect(filtered.body.data).toHaveLength(1);
  });

  it("a tenant sees published global articles but not SO drafts", async () => {
    const so = await makeUser("so", "AXIA", "ServiceOwner", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    await request(app).post("/v1/kb-articles").set(authed(so.token)).send({ title: "Draft doc", category: "platform", status: "Draft" });
    await request(app).post("/v1/kb-articles").set(authed(so.token)).send({ title: "Live doc", category: "faq", status: "Published" });
    const tenant = await makeUser("t", "TEN", "Tenant", [ACTIONS.KB_READ]);
    const list = await request(app).get("/v1/kb-articles").set(authed(tenant.token));
    const titles = list.body.data.map((a: { title: string }) => a.title);
    expect(titles).toContain("Live doc");
    expect(titles).not.toContain("Draft doc");
  });

  it("requires KB_MANAGE to author", async () => {
    const { token } = await makeUser("ro", "RO", "Tenant", [ACTIONS.KB_READ]);
    expect((await request(app).post("/v1/kb-articles").set(authed(token)).send({ title: "x", category: "faq" })).status).toBe(403);
  });
});

describe("Notifications", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("lists the actor's bell items and marks them read", async () => {
    const u = await makeUser("t", "TEN", "Tenant", []);
    await Notification.bulkCreate([
      { orgId: u.orgId, userId: null, type: "info", text: "Org-wide notice", link: null, read: false },
      { orgId: u.orgId, userId: u.userId, type: "info", text: "Just for you", link: "/x", read: false },
      // Different org, no user target → must be excluded from this actor's bell.
      { orgId: null, userId: null, type: "info", text: "Someone else", link: null, read: false },
    ]);
    const list = await request(app).get("/v1/notifications").set(authed(u.token));
    expect(list.body.data.map((n: { text: string }) => n.text).sort()).toEqual(["Just for you", "Org-wide notice"]);

    const marked = await request(app).post("/v1/notifications/read").set(authed(u.token));
    expect(marked.body.data.updated).toBe(2);
    const after = await request(app).get("/v1/notifications").set(authed(u.token));
    expect(after.body.data.every((n: { read: boolean }) => n.read)).toBe(true);
  });
});

describe("Reference datasets", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("serves hierarchical ISIC with notes + cross-referenced NACE", async () => {
    const { token } = await makeUser("t", "TEN", "Tenant", []);
    const sections = await request(app).get("/v1/reference/isic?parent=").set(authed(token));
    expect(sections.body.data).toHaveLength(21); // sections A–U
    const divs = await request(app).get("/v1/reference/isic?parent=C").set(authed(token));
    expect(divs.body.data.map((n: { code: string }) => n.code)).toContain("10");
    const notes = await request(app).get("/v1/reference/isic/C/notes").set(authed(token));
    expect(notes.body.data.i).toContain("transformation");
    const nace = await request(app).get("/v1/reference/nace?search=comput").set(authed(token));
    expect(nace.body.data[0].isic).toBe("62");
  });

  it("fuzzy-matches role suggestions and serves the exam bank", async () => {
    const { token } = await makeUser("t", "TEN", "Tenant", []);
    const roles = await request(app).get("/v1/reference/role-suggestions?q=QA%20Manager").set(authed(token));
    expect(roles.body.data[0].name).toBe("Quality Manager");
    const iscedf = await request(app).get("/v1/reference/iscedf").set(authed(token));
    expect(iscedf.body.data).toHaveLength(11);
    const exam = await request(app).get("/v1/reference/exam-bank?skill=Internal%20Auditing&level=L1").set(authed(token));
    expect(exam.body.data[0].questions.length).toBeGreaterThan(0);
    // Reference responses are cacheable.
    expect(roles.headers["cache-control"]).toContain("max-age");
  });
});
