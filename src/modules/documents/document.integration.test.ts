import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const DOC = [ACTIONS.DOC_READ, ACTIONS.DOC_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = DOC): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Doc Author", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("documents (internal + external)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a folder, an internal doc, and an external doc scoped to the folder", async () => {
    const { token } = await makeTenant("d1", "DOC1");

    const folder = await request(app).post("/v1/documents/folders").set(authed(token)).send({ name: "Policies" });
    expect(folder.status).toBe(201);
    expect(folder.body.data).toMatchObject({ name: "Policies", status: "Active" });
    const folderId = folder.body.data.id;

    const internal = await request(app).post("/v1/documents").set(authed(token)).send({
      kind: "internal",
      title: "Data Protection Policy",
      docType: "Policy",
      content: [{ id: "b1", type: "paragraph", html: "<p>Scope...</p>" }],
    });
    expect(internal.status).toBe(201);
    expect(internal.body.data).toMatchObject({ kind: "internal", title: "Data Protection Policy", status: "Draft", version: "0.1" });
    expect(internal.body.data.content).toHaveLength(1);
    expect(internal.body.data.folderId).toBeNull();

    const external = await request(app).post("/v1/documents").set(authed(token)).send({
      kind: "external",
      title: "Supplier Contract 2026",
      docType: "Contract",
      folderId,
      issuer: "Acme Corp",
    });
    expect(external.status).toBe(201);
    expect(external.body.data).toMatchObject({ kind: "external", folderId, issuer: "Acme Corp" });
    expect(external.body.data.content).toBeNull();
  });

  it("lists documents filtered by kind", async () => {
    const { token } = await makeTenant("d2", "DOC2");
    await request(app).post("/v1/documents").set(authed(token)).send({ kind: "internal", title: "Internal A" });
    await request(app).post("/v1/documents").set(authed(token)).send({ kind: "external", title: "External A" });

    const internalOnly = await request(app).get("/v1/documents?kind=internal").set(authed(token));
    expect(internalOnly.body.data).toHaveLength(1);
    expect(internalOnly.body.data[0].title).toBe("Internal A");

    const externalOnly = await request(app).get("/v1/documents?kind=external").set(authed(token));
    expect(externalOnly.body.data).toHaveLength(1);
    expect(externalOnly.body.data[0].title).toBe("External A");
  });

  it("publishes a document", async () => {
    const { token } = await makeTenant("d3", "DOC3");
    const created = await request(app).post("/v1/documents").set(authed(token)).send({ kind: "internal", title: "Draft Doc" });
    const id = created.body.data.id;
    expect(created.body.data.status).toBe("Draft");

    const published = await request(app).post(`/v1/documents/${id}/publish`).set(authed(token));
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("Published");

    const archived = await request(app).post(`/v1/documents/${id}/archive`).set(authed(token));
    expect(archived.body.data.status).toBe("Archived");
  });

  it("requires DOC_MANAGE to author", async () => {
    const { token } = await makeTenant("d4", "DOC4", [ACTIONS.DOC_READ]);
    expect((await request(app).post("/v1/documents").set(authed(token)).send({ kind: "internal", title: "x" })).status).toBe(403);
  });

  it("enforces tenant isolation: org A's document is invisible to org B", async () => {
    const a = await makeTenant("d5a", "DOC5A");
    const b = await makeTenant("d5b", "DOC5B");

    const created = await request(app).post("/v1/documents").set(authed(a.token)).send({ kind: "internal", title: "Org A private doc" });
    const id = created.body.data.id;

    const listAsB = await request(app).get("/v1/documents").set(authed(b.token));
    expect(listAsB.body.data.map((d: { id: string }) => d.id)).not.toContain(id);

    expect((await request(app).get(`/v1/documents/${id}`).set(authed(b.token))).status).toBe(403);
    expect((await request(app).patch(`/v1/documents/${id}`).set(authed(b.token)).send({ title: "hijacked" })).status).toBe(403);
    expect((await request(app).post(`/v1/documents/${id}/publish`).set(authed(b.token))).status).toBe(403);
    expect((await request(app).delete(`/v1/documents/${id}`).set(authed(b.token))).status).toBe(403);

    // Owner can still see it.
    expect((await request(app).get(`/v1/documents/${id}`).set(authed(a.token))).status).toBe(200);
  });
});
