import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const CMS = [ACTIONS.CMS_READ, ACTIONS.CMS_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = CMS): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "CMS Author", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("cms (pages, posts, media, menu, settings)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  // --- Pages ------------------------------------------------------------------

  it("creates, updates, publishes and archives a page", async () => {
    const { token } = await makeTenant("c1", "CMS1");
    const created = await request(app).post("/v1/cms/pages").set(authed(token)).send({
      title: "Contact Us",
      template: "Contact",
      body: "<p>Reach us</p>",
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: "Contact Us", slug: "contact-us", template: "Contact", status: "Draft" });
    const id = created.body.data.id;

    const updated = await request(app).patch(`/v1/cms/pages/${id}`).set(authed(token)).send({ seoTitle: "Contact | Acme" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.seoTitle).toBe("Contact | Acme");

    const published = await request(app).post(`/v1/cms/pages/${id}/publish`).set(authed(token));
    expect(published.body.data.status).toBe("Published");

    const archived = await request(app).post(`/v1/cms/pages/${id}/archive`).set(authed(token));
    expect(archived.body.data.status).toBe("Archived");
  });

  it("rejects a duplicate slug within the same org", async () => {
    const { token } = await makeTenant("c2", "CMS2");
    await request(app).post("/v1/cms/pages").set(authed(token)).send({ title: "Home", slug: "home", template: "Home" });
    const dup = await request(app).post("/v1/cms/pages").set(authed(token)).send({ title: "Home Again", slug: "home", template: "Home" });
    expect(dup.status).toBe(409);
  });

  // --- Posts ------------------------------------------------------------------

  it("creates a post, sets tags, and moves through publish/archive", async () => {
    const { token } = await makeTenant("c3", "CMS3");
    const created = await request(app).post("/v1/cms/posts").set(authed(token)).send({
      title: "Launch Day",
      category: "News",
      tags: ["launch", "product"],
      body: "<p>We launched.</p>",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.tags).toEqual(["launch", "product"]);
    const id = created.body.data.id;

    const published = await request(app).post(`/v1/cms/posts/${id}/publish`).set(authed(token));
    expect(published.body.data.status).toBe("Published");

    const archived = await request(app).post(`/v1/cms/posts/${id}/archive`).set(authed(token));
    expect(archived.body.data.status).toBe("Archived");
  });

  // --- RBAC + tenant isolation --------------------------------------------------

  it("requires CMS_MANAGE to author; CMS_READ alone can only read", async () => {
    const { token } = await makeTenant("c4", "CMS4", [ACTIONS.CMS_READ]);
    expect((await request(app).post("/v1/cms/pages").set(authed(token)).send({ title: "x" })).status).toBe(403);
    expect((await request(app).get("/v1/cms/pages").set(authed(token))).status).toBe(200);
  });

  it("enforces tenant isolation: org A's page/post is invisible and unwritable to org B", async () => {
    const a = await makeTenant("c5a", "CMS5A");
    const b = await makeTenant("c5b", "CMS5B");

    const page = await request(app).post("/v1/cms/pages").set(authed(a.token)).send({ title: "Org A Page" });
    const pageId = page.body.data.id;

    const listAsB = await request(app).get("/v1/cms/pages").set(authed(b.token));
    expect(listAsB.body.data.map((p: { id: string }) => p.id)).not.toContain(pageId);
    expect((await request(app).get(`/v1/cms/pages/${pageId}`).set(authed(b.token))).status).toBe(403);
    expect((await request(app).patch(`/v1/cms/pages/${pageId}`).set(authed(b.token)).send({ title: "hijacked" })).status).toBe(403);
    expect((await request(app).post(`/v1/cms/pages/${pageId}/publish`).set(authed(b.token))).status).toBe(403);

    expect((await request(app).get(`/v1/cms/pages/${pageId}`).set(authed(a.token))).status).toBe(200);
  });

  // --- Media -------------------------------------------------------------------

  it("uploads a real file, persists it to disk, and serves it back at its stored url", async () => {
    const { token } = await makeTenant("c6", "CMS6");
    const upload = await request(app)
      .post("/v1/cms/media")
      .set(authed(token))
      .field("alt", "A test image")
      .attach("file", Buffer.from("fake-png-bytes"), { filename: "logo.png", contentType: "image/png" });
    expect(upload.status).toBe(201);
    expect(upload.body.data).toMatchObject({ name: "logo.png", type: "image/png", size: 14, alt: "A test image" });
    expect(upload.body.data.url).toMatch(/^\/uploads\/cms\//);

    const fetched = await request(app).get(upload.body.data.url);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(fetched.body).toString("utf8")).toBe("fake-png-bytes");

    const list = await request(app).get("/v1/cms/media").set(authed(token));
    expect(list.body.data).toHaveLength(1);

    const del = await request(app).delete(`/v1/cms/media/${upload.body.data.id}`).set(authed(token));
    expect(del.status).toBe(200);
  });

  // --- Menu --------------------------------------------------------------------

  it("creates menu items and bulk-reorders them", async () => {
    const { token } = await makeTenant("c7", "CMS7");
    const page = await request(app).post("/v1/cms/pages").set(authed(token)).send({ title: "Pricing", template: "Pricing" });
    const pageId = page.body.data.id;

    const item1 = await request(app).post("/v1/cms/menu").set(authed(token)).send({ label: "Pricing", pageId, order: 1 });
    const item2 = await request(app).post("/v1/cms/menu").set(authed(token)).send({ label: "Docs", url: "https://docs.example.com", order: 2 });
    expect(item1.status).toBe(201);
    expect(item2.status).toBe(201);

    const reordered = await request(app)
      .post("/v1/cms/menu/reorder")
      .set(authed(token))
      .send([
        { id: item1.body.data.id, order: 2 },
        { id: item2.body.data.id, order: 1 },
      ]);
    expect(reordered.status).toBe(200);
    const byId = Object.fromEntries(reordered.body.data.map((m: { id: string; order: number }) => [m.id, m.order]));
    expect(byId[item1.body.data.id]).toBe(2);
    expect(byId[item2.body.data.id]).toBe(1);
  });

  // --- Settings ------------------------------------------------------------------

  it("GET returns-or-creates the default settings row; PUT upserts it", async () => {
    const { token } = await makeTenant("c8", "CMS8");
    const initial = await request(app).get("/v1/cms/settings").set(authed(token));
    expect(initial.status).toBe(200);
    expect(initial.body.data.live).toBe(false);

    const updated = await request(app).put("/v1/cms/settings").set(authed(token)).send({ siteName: "Acme Site", live: true });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ siteName: "Acme Site", live: true });

    const again = await request(app).get("/v1/cms/settings").set(authed(token));
    expect(again.body.data).toMatchObject({ siteName: "Acme Site", live: true });
  });

  // --- Public renderer -----------------------------------------------------------

  describe("public renderer", () => {
    it("renders distinct markup per template for Published pages only", async () => {
      const { token, orgId } = await makeTenant("c9", "CMS9");
      const home = await request(app).post("/v1/cms/pages").set(authed(token)).send({ title: "Home", slug: "home", template: "Home", body: "<p>hi</p>" });
      const pricing = await request(app).post("/v1/cms/pages").set(authed(token)).send({ title: "Pricing", template: "Pricing", body: "<p>plans</p>" });
      const draft = await request(app).post("/v1/cms/pages").set(authed(token)).send({ title: "Draft Page", template: "Landing" });

      await request(app).post(`/v1/cms/pages/${home.body.data.id}/publish`).set(authed(token));
      await request(app).post(`/v1/cms/pages/${pricing.body.data.id}/publish`).set(authed(token));
      // draft stays unpublished on purpose.

      const homeRes = await request(app).get(`/v1/public/cms/${orgId}/pages/home`);
      expect(homeRes.status).toBe(200);
      expect(homeRes.text).toContain('class="hero"');

      const pricingRes = await request(app).get(`/v1/public/cms/${orgId}/pages/pricing`);
      expect(pricingRes.status).toBe(200);
      expect(pricingRes.text).toContain('data-layout="pricing"');
      expect(pricingRes.text).not.toContain('class="hero"');

      const draftRes = await request(app).get(`/v1/public/cms/${orgId}/pages/draft-page`);
      expect(draftRes.status).toBe(404);
    });

    it("404s for an unknown org id without leaking internals", async () => {
      const res = await request(app).get("/v1/public/cms/00000000-0000-0000-0000-000000000000/pages/home");
      expect(res.status).toBe(404);
      expect(res.body.error).toBeTruthy();
    });

    it("never exposes another org's published page under the wrong orgId", async () => {
      const a = await makeTenant("c10a", "CMS10A");
      const b = await makeTenant("c10b", "CMS10B");
      const page = await request(app).post("/v1/cms/pages").set(authed(a.token)).send({ title: "Secret Landing", slug: "secret", template: "Landing" });
      await request(app).post(`/v1/cms/pages/${page.body.data.id}/publish`).set(authed(a.token));

      const wrongOrg = await request(app).get(`/v1/public/cms/${b.orgId}/pages/secret`);
      expect(wrongOrg.status).toBe(404);
    });

    it("serves a sitemap.xml and robots.txt for the org's Published pages", async () => {
      const { token, orgId } = await makeTenant("c11", "CMS11");
      const p = await request(app).post("/v1/cms/pages").set(authed(token)).send({ title: "Landing A", slug: "landing-a", template: "Landing", seoTitle: "Landing A | Acme" });
      await request(app).post(`/v1/cms/pages/${p.body.data.id}/publish`).set(authed(token));

      const sitemap = await request(app).get(`/v1/public/cms/${orgId}/sitemap.xml`);
      expect(sitemap.status).toBe(200);
      expect(sitemap.text).toContain("<urlset");
      expect(sitemap.text).toContain("Landing A | Acme");

      const robots = await request(app).get(`/v1/public/cms/${orgId}/robots.txt`);
      expect(robots.status).toBe(200);
      expect(robots.text).toContain(`Sitemap: /v1/public/cms/${orgId}/sitemap.xml`);
    });

    it("treats a Scheduled post as visible once its publishDate has passed", async () => {
      const { token, orgId } = await makeTenant("c12", "CMS12");
      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 60 * 60_000).toISOString();

      const due = await request(app).post("/v1/cms/posts").set(authed(token)).send({ title: "Due Now", slug: "due-now", status: "Scheduled", publishDate: past, body: "<p>go</p>" });
      const notYet = await request(app).post("/v1/cms/posts").set(authed(token)).send({ title: "Not Yet", slug: "not-yet", status: "Scheduled", publishDate: future, body: "<p>wait</p>" });
      expect(due.status).toBe(201);
      expect(notYet.status).toBe(201);

      const dueRes = await request(app).get(`/v1/public/cms/${orgId}/posts/due-now`);
      expect(dueRes.status).toBe(200);

      const notYetRes = await request(app).get(`/v1/public/cms/${orgId}/posts/not-yet`);
      expect(notYetRes.status).toBe(404);
    });
  });
});
