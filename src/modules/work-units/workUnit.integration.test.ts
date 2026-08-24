import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Site, WorkUnit } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const WU = [ACTIONS.WORKUNIT_READ, ACTIONS.WORKUNIT_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = WU): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

async function makeSite(orgId: string, code: string): Promise<string> {
  const s = await Site.create({ orgId, code, name: `Site ${code}`, type: "Head Office", status: "Active", isPrimary: true, country: null, address: null, description: null, contactPerson: null, contactEmail: null, contactPhone: null });
  return s.id;
}

describe("work units", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a work unit with site + sub-entities, lists, updates and archives it", async () => {
    const { token, orgId } = await makeTenant("wu1", "WU1");
    const siteId = await makeSite(orgId, "WU1");

    const created = await request(app).post("/v1/work-units").set(authed(token))
      .send({ name: "Production Line A", siteId, description: "Assembly", processIds: ["p1", "p2"], envIds: ["e1"], depIds: ["d1"] });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: "WU-0001", name: "Production Line A", siteId, status: "Applicable", processIds: ["p1", "p2"], envIds: ["e1"], depIds: ["d1"] });
    const id = created.body.data.id;

    const list = await request(app).get("/v1/work-units").set(authed(token));
    expect(list.body.data).toHaveLength(1);

    const updated = await request(app).put(`/v1/work-units/${id}`).set(authed(token)).send({ status: "Inapplicable", processIds: ["p1"] });
    expect(updated.body.data).toMatchObject({ status: "Inapplicable", processIds: ["p1"] });

    const archived = await request(app).post(`/v1/work-units/${id}/archive`).set(authed(token));
    expect(archived.body.data.status).toBe("Archived");
  });

  it("mints new codes as WU- (OD `wuNewId`), continuing numbering past legacy WKU- rows", async () => {
    const { token, orgId } = await makeTenant("wu7", "WU7");
    // A pre-existing row minted under the old `WKU-` prefix (as real
    // production data may still hold) must keep resolving untouched and
    // still count toward the running max so numbering doesn't reset to 1.
    await WorkUnit.create({
      orgId, code: "WKU-0003", name: "Legacy Unit", siteId: null, status: "Applicable",
      description: null, processIds: [], envIds: [], depIds: [], createdBy: null,
    });
    const created = await request(app).post("/v1/work-units").set(authed(token)).send({ name: "New Unit" });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe("WU-0004");

    const legacy = await WorkUnit.findOne({ where: { orgId, code: "WKU-0003" } });
    expect(legacy).not.toBeNull();
    expect(legacy!.name).toBe("Legacy Unit");
  });

  it("rejects a site from another organization and enforces tenant scoping", async () => {
    const a = await makeTenant("wu2", "WU2");
    const b = await makeTenant("wu3", "WU3");
    const bSite = await makeSite(b.orgId, "WU3");

    // A cannot attach B's site.
    expect((await request(app).post("/v1/work-units").set(authed(a.token)).send({ name: "X", siteId: bSite })).status).toBe(400);

    const aWu = await request(app).post("/v1/work-units").set(authed(a.token)).send({ name: "A unit" });
    expect(aWu.status).toBe(201);
    // B cannot see A's work units.
    expect((await request(app).get("/v1/work-units").set(authed(b.token))).body.data).toHaveLength(0);
    // B cannot update A's work unit.
    expect((await request(app).put(`/v1/work-units/${aWu.body.data.id}`).set(authed(b.token)).send({ name: "hax" })).status).toBe(404);
  });

  it("enforces action grants and validates status", async () => {
    const noGrant = await makeTenant("wu4", "WU4", []);
    expect((await request(app).get("/v1/work-units").set(authed(noGrant.token))).status).toBe(403);
    const readonly = await makeTenant("wu5", "WU5", [ACTIONS.WORKUNIT_READ]);
    expect((await request(app).get("/v1/work-units").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/work-units").set(authed(readonly.token)).send({ name: "x" })).status).toBe(403);
    const full = await makeTenant("wu6", "WU6");
    expect((await request(app).post("/v1/work-units").set(authed(full.token)).send({ name: "x", status: "Bogus" })).status).toBe(400);
  });

  // OD `wuDetail` (app.html:15186): the drawer's Activity Timeline + Comments
  // feed. Wired here through the shared record-events module (P1 §2.3) —
  // `recordEvent.routes.ts`'s `MODULE_ACTIONS["work-units"]` gates it on
  // WORKUNIT_READ/WORKUNIT_MANAGE, and `workUnit.service.ts` auto-logs
  // create/update/archive so the timeline isn't comment-only.
  it("wires work units into the record-events module: create/update/archive log activity, and comments persist", async () => {
    const { token } = await makeTenant("wu8", "WU8");

    const created = await request(app).post("/v1/work-units").set(authed(token))
      .send({ name: "Software Development", processIds: ["p1", "p2"] });
    const id = created.body.data.id;

    await request(app).put(`/v1/work-units/${id}`).set(authed(token)).send({ status: "Inapplicable", processIds: ["p1"] });
    await request(app).post(`/v1/work-units/${id}/archive`).set(authed(token));

    const commentRes = await request(app)
      .post(`/v1/record-events/work-units/${id}/comments`)
      .set(authed(token))
      .send({ text: "Reviewed with the site lead." });
    expect(commentRes.status).toBe(201);
    expect(commentRes.body.data).toMatchObject({ type: "comment", text: "Reviewed with the site lead." });

    const feed = await request(app).get(`/v1/record-events/work-units/${id}`).set(authed(token));
    expect(feed.status).toBe(200);
    const types = feed.body.data.map((e: { type: string; text: string }) => e.type);
    const texts = feed.body.data.map((e: { type: string; text: string }) => e.text);
    // Created (with process count) → edited (status + process diff) → archived → comment.
    expect(types).toEqual(["activity", "activity", "activity", "activity", "comment"]);
    expect(texts[0]).toMatch(/Created this work unit — assigned 2 business processes/);
    expect(texts.some((t: string) => /Business process removed/.test(t))).toBe(true);
    expect(texts.some((t: string) => /archived — status set to Archived/.test(t))).toBe(true);
  });

  it("gates the work-units record-events feed on WORKUNIT_READ/WORKUNIT_MANAGE, not the generic MS actions", async () => {
    const owner = await makeTenant("wu9", "WU9");
    const created = await request(app).post("/v1/work-units").set(authed(owner.token)).send({ name: "Gated Unit" });
    const id = created.body.data.id;

    const noWuGrant = await makeTenant("wu10", "WU10", [ACTIONS.MS_READ, ACTIONS.MS_MANAGE]);
    expect((await request(app).get(`/v1/record-events/work-units/${id}`).set(authed(noWuGrant.token))).status).toBe(403);

    const readOnly = await makeTenant("wu11", "WU11", [ACTIONS.WORKUNIT_READ]);
    expect((await request(app).get(`/v1/record-events/work-units/${id}`).set(authed(readOnly.token))).status).toBe(200);
    expect(
      (await request(app).post(`/v1/record-events/work-units/${id}/comments`).set(authed(readOnly.token)).send({ text: "x" })).status,
    ).toBe(403);
  });
});
