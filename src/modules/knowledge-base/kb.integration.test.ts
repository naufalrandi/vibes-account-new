import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Notification, KbArticle } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeUser(
  username: string,
  code: string,
  type: "ServiceOwner" | "Distributor" | "Tenant",
  actions: string[],
  parentOrgId: string | null = null,
): Promise<{ token: string; orgId: string; userId: string }> {
  const org = await Organization.create({ name: code, code, type, status: "Active", parentOrgId, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
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

  it("blocks cross-tenant access to another tenant's article by ID (IDOR regression)", async () => {
    const a = await makeUser("ta", "TENA", "Tenant", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    const b = await makeUser("tb", "TENB", "Tenant", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    // Authoring is Service-Owner-only now (P0-6), so an org-scoped article can
    // no longer be created through the API by a Tenant — seed one directly to
    // exercise the read/write containment (P0-4) against a legacy/SO-authored
    // org-scoped row.
    const article = await KbArticle.create({ orgId: a.orgId, code: "KB-2026-9001", title: "Tenant A private note", category: "platform", status: "Draft", summary: null, content: "", publishedAt: null });
    const id = article.id;
    // Tenant B must not be able to read, edit, publish, or delete A's article.
    expect((await request(app).get(`/v1/kb-articles/${id}`).set(authed(b.token))).status).toBe(403);
    expect((await request(app).put(`/v1/kb-articles/${id}`).set(authed(b.token)).send({ title: "hijacked" })).status).toBe(403);
    expect((await request(app).post(`/v1/kb-articles/${id}/publish`).set(authed(b.token))).status).toBe(403);
    expect((await request(app).delete(`/v1/kb-articles/${id}`).set(authed(b.token))).status).toBe(403);
    // Owner can still read it...
    expect((await request(app).get(`/v1/kb-articles/${id}`).set(authed(a.token))).status).toBe(200);
    // ...but can no longer mutate it either — authoring is Service-Owner-only (P0-6).
    expect((await request(app).put(`/v1/kb-articles/${id}`).set(authed(a.token)).send({ title: "x" })).status).toBe(403);
  });

  it("forbids a non-ServiceOwner from mutating a global (SO-authored) article", async () => {
    const so = await makeUser("so", "AXIA", "ServiceOwner", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    const global = await request(app).post("/v1/kb-articles").set(authed(so.token)).send({ title: "Global doc", category: "faq", status: "Published" });
    const id = global.body.data.id;
    const tenant = await makeUser("t", "TEN", "Tenant", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    // Tenant can READ the published global, but cannot edit/archive/delete it.
    expect((await request(app).get(`/v1/kb-articles/${id}`).set(authed(tenant.token))).status).toBe(200);
    expect((await request(app).put(`/v1/kb-articles/${id}`).set(authed(tenant.token)).send({ title: "x" })).status).toBe(403);
    expect((await request(app).post(`/v1/kb-articles/${id}/archive`).set(authed(tenant.token))).status).toBe(403);
  });

  it("restricts every authoring action to the Service Owner, even with KB_MANAGE granted (P0-6)", async () => {
    const tenant = await makeUser("t3", "TEN3", "Tenant", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    const distributor = await makeUser("d3", "DIS3", "Distributor", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    for (const actor of [tenant, distributor]) {
      expect((await request(app).post("/v1/kb-articles").set(authed(actor.token)).send({ title: "x", category: "faq" })).status).toBe(403);
    }
    const so = await makeUser("so4", "AXIA4", "ServiceOwner", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    const article = await KbArticle.create({ orgId: tenant.orgId, code: "KB-2026-9002", title: "Seeded", category: "platform", status: "Draft", summary: null, content: "", publishedAt: null });
    expect((await request(app).put(`/v1/kb-articles/${article.id}`).set(authed(tenant.token)).send({ title: "x" })).status).toBe(403);
    expect((await request(app).post(`/v1/kb-articles/${article.id}/publish`).set(authed(tenant.token))).status).toBe(403);
    expect((await request(app).delete(`/v1/kb-articles/${article.id}`).set(authed(tenant.token))).status).toBe(403);
    // ServiceOwner is unrestricted by orgId, so it can still act on any article.
    expect((await request(app).post(`/v1/kb-articles/${article.id}/publish`).set(authed(so.token))).status).toBe(200);
  });

  it("dedupes uniqueViews per user but always increments views (B4)", async () => {
    const so = await makeUser("so5", "AXIA5", "ServiceOwner", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    const created = await request(app).post("/v1/kb-articles").set(authed(so.token)).send({ title: "Views doc", category: "platform", status: "Published" });
    const id = created.body.data.id;
    const viewer1 = await makeUser("v1", "VIEW1", "Tenant", [ACTIONS.KB_READ]);
    const viewer2 = await makeUser("v2", "VIEW2", "Tenant", [ACTIONS.KB_READ]);

    const first = await request(app).get(`/v1/kb-articles/${id}?track=1`).set(authed(viewer1.token));
    expect(first.body.data.views).toBe(1);
    expect(first.body.data.uniqueViews).toBe(1);

    // Same viewer again: views grows, uniqueViews does not double-count.
    const second = await request(app).get(`/v1/kb-articles/${id}?track=1`).set(authed(viewer1.token));
    expect(second.body.data.views).toBe(2);
    expect(second.body.data.uniqueViews).toBe(1);

    // A new viewer: both grow.
    const third = await request(app).get(`/v1/kb-articles/${id}?track=1`).set(authed(viewer2.token));
    expect(third.body.data.views).toBe(3);
    expect(third.body.data.uniqueViews).toBe(2);
  });

  it("dedupes votes per user, adjusting counts on change instead of double-counting (B4)", async () => {
    const so = await makeUser("so6", "AXIA6", "ServiceOwner", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    const created = await request(app).post("/v1/kb-articles").set(authed(so.token)).send({ title: "Vote doc", category: "platform", status: "Published" });
    const id = created.body.data.id;
    const voter = await makeUser("vt", "VOTE1", "Tenant", [ACTIONS.KB_READ]);

    const firstVote = await request(app).post(`/v1/kb-articles/${id}/vote`).set(authed(voter.token)).send({ helpful: true });
    expect(firstVote.body.data.helpful).toBe(1);
    expect(firstVote.body.data.notHelpful).toBe(0);

    // Re-casting the same vote must not double-count.
    const repeatVote = await request(app).post(`/v1/kb-articles/${id}/vote`).set(authed(voter.token)).send({ helpful: true });
    expect(repeatVote.body.data.helpful).toBe(1);
    expect(repeatVote.body.data.notHelpful).toBe(0);

    // Changing the vote moves the count instead of adding to it.
    const changedVote = await request(app).post(`/v1/kb-articles/${id}/vote`).set(authed(voter.token)).send({ helpful: false });
    expect(changedVote.body.data.helpful).toBe(0);
    expect(changedVote.body.data.notHelpful).toBe(1);
  });

  it("Distributor: cannot see or write a child tenant's org-scoped article, and always sees its own (P0-4 containment)", async () => {
    const distributor = await makeUser("dist", "DIST1", "Distributor", [ACTIONS.KB_READ, ACTIONS.KB_MANAGE]);
    const child = await makeUser("child", "CHILD1", "Tenant", [ACTIONS.KB_READ], distributor.orgId);

    // Seed org-scoped articles directly — authoring is Service-Owner-only (P0-6).
    const ownArticle = await KbArticle.create({ orgId: distributor.orgId, code: "KB-2026-9101", title: "Distributor's own note", category: "platform", status: "Draft", summary: null, content: "", publishedAt: null });
    const childArticle = await KbArticle.create({ orgId: child.orgId, code: "KB-2026-9102", title: "Child tenant's note", category: "platform", status: "Draft", summary: null, content: "", publishedAt: null });

    // Own-org article: visible to the Distributor (the pre-fix helper —
    // visibleTenantOrgIds — excludes the actor's own org, which would 403 here).
    expect((await request(app).get(`/v1/kb-articles/${ownArticle.id}`).set(authed(distributor.token))).status).toBe(200);
    const list = await request(app).get("/v1/kb-articles").set(authed(distributor.token));
    const ids = list.body.data.map((row: { id: string }) => row.id);
    expect(ids).toContain(ownArticle.id);

    // Child tenant's article: must be invisible and unwritable to the parent
    // Distributor (the pre-fix helper — visibleTenantOrgIds — WOULD include
    // this child, which is exactly the P0-4 bug).
    expect(ids).not.toContain(childArticle.id);
    expect((await request(app).get(`/v1/kb-articles/${childArticle.id}`).set(authed(distributor.token))).status).toBe(403);
    expect((await request(app).put(`/v1/kb-articles/${childArticle.id}`).set(authed(distributor.token)).send({ title: "hijacked" })).status).toBe(403);
    expect((await request(app).post(`/v1/kb-articles/${childArticle.id}/publish`).set(authed(distributor.token))).status).toBe(403);
    expect((await request(app).delete(`/v1/kb-articles/${childArticle.id}`).set(authed(distributor.token))).status).toBe(403);

    // And the child tenant must not see the Distributor's (parent's) article either.
    expect((await request(app).get(`/v1/kb-articles/${ownArticle.id}`).set(authed(child.token))).status).toBe(403);
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
    // "programming" alone also matches NACE 60 ("Programming and broadcasting
    // activities"), which sorts first — use the unambiguous label to target 62.
    const nace = await request(app).get("/v1/reference/nace?search=computer%20programming").set(authed(token));
    expect(nace.body.data[0].isic).toBe("62");
  });

  it("fuzzy-matches role suggestions and serves the exam bank", async () => {
    const { token } = await makeUser("t", "TEN", "Tenant", []);
    const roles = await request(app).get("/v1/reference/role-suggestions?q=QA%20Manager").set(authed(token));
    expect(roles.body.data.roles[0].name).toBe("Quality Manager");
    // /v1/reference/iscedf serves the full flat ISCED-F volume (116 rows, all
    // levels) by design — see reference.integration.test.ts. Count the 11
    // broad fields (parent === null) rather than the endpoint's total length.
    const iscedf = await request(app).get("/v1/reference/iscedf").set(authed(token));
    expect(iscedf.body.data.filter((d: { parent: string | null }) => d.parent === null)).toHaveLength(11);
    const exam = await request(app).get("/v1/reference/exam-bank?skill=Internal%20Auditing&level=L1").set(authed(token));
    expect(exam.body.data[0].questions.length).toBeGreaterThan(0);
    // Reference responses are cacheable.
    expect(roles.headers["cache-control"]).toContain("max-age");
  });
});
