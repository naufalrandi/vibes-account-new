import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const SC = [ACTIONS.SCOPE_READ, ACTIONS.SCOPE_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = SC): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: "Hammer Industries", code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Tenant Administrator", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}
const baseDims = () => ({
  frameworks: [{ name: "ISO 9001:2015", status: "Included", note: "" }, { name: "ISO/IEC 27001:2022", status: "Included", note: "" }],
  sites: [{ name: "Head Office", status: "Included", note: "" }, { name: "Client Site", status: "Excluded", note: "Outside operational control" }],
  personnel: [{ name: "Employees", status: "Included", note: "" }],
});

describe("management system scope (6-dimension)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("validates notes, auto-generates a statement, and captures a baseline on activation", async () => {
    const { token } = await makeTenant("ms1", "MS1");
    // Excluded row without a note is rejected.
    const bad = await request(app).post("/v1/scope/scopes").set(authed(token)).send({ name: "IMS Scope", frameworks: [], sites: [{ name: "X", status: "Excluded", note: "" }] });
    expect(bad.status).toBe(400);

    const created = await request(app).post("/v1/scope/scopes").set(authed(token)).send({ name: "IMS Scope", ...baseDims() });
    expect(created.body.data).toMatchObject({ code: "SCOPE-0001", status: "Draft", version: 1 });
    // Statement auto-generated from in-scope rows.
    expect(created.body.data.statement).toContain("ISO 9001:2015 and ISO/IEC 27001:2022");
    expect(created.body.data.statement).toContain("Hammer Industries");
    expect(created.body.data.frameworkRelevance).toEqual(["ISO 9001:2015", "ISO/IEC 27001:2022"]);
    const id = created.body.data.id;

    await request(app).post(`/v1/scope/scopes/${id}/approve`).set(authed(token));
    const active = await request(app).post(`/v1/scope/scopes/${id}/activate`).set(authed(token));
    expect(active.body.data.status).toBe("Active");
    // Baseline counts: 2 standards, 1 site in-scope (Client Site excluded), 1 user.
    expect(active.body.data.baseline.counts).toEqual({ standards: 2, sites: 1, users: 1 });
  });

  it("diffs billable changes and re-baselines through Partner → SP approval", async () => {
    const { token } = await makeTenant("ms2", "MS2");
    const id = (await request(app).post("/v1/scope/scopes").set(authed(token)).send({ name: "IMS Scope", ...baseDims() })).body.data.id;
    await request(app).post(`/v1/scope/scopes/${id}/activate`).set(authed(token));

    // No changes yet.
    expect((await request(app).get(`/v1/scope/scopes/${id}/diff`).set(authed(token))).body.data.entries).toHaveLength(0);

    // Add a framework (billable Standard) + a non-billable env.
    const dims = baseDims();
    await request(app).put(`/v1/scope/scopes/${id}`).set(authed(token)).send({
      frameworks: [...dims.frameworks, { name: "ISO 14001:2015", status: "Included", note: "" }],
      envs: [{ name: "Production Environment", status: "Included", note: "" }],
    });
    const diff = (await request(app).get(`/v1/scope/scopes/${id}/diff`).set(authed(token))).body.data;
    expect(diff.entries).toContainEqual({ billable: true, kind: "Standard", action: "Added", label: "ISO 14001:2015" });
    expect(diff.entries).toContainEqual({ billable: false, kind: "Environment", action: "Added", label: "Production Environment" });

    // Submit → partner → SP re-baseline.
    const sub = await request(app).post(`/v1/scope/scopes/${id}/submit-changes`).set(authed(token));
    expect(sub.body.data.pendingChange.stage).toBe("partner");
    // Cannot submit twice.
    expect((await request(app).post(`/v1/scope/scopes/${id}/submit-changes`).set(authed(token))).status).toBe(409);
    // SP cannot approve before partner.
    expect((await request(app).post(`/v1/scope/scopes/${id}/sp-approve`).set(authed(token))).status).toBe(409);

    expect((await request(app).post(`/v1/scope/scopes/${id}/partner-approve`).set(authed(token))).body.data.pendingChange.stage).toBe("sp");
    const rebased = await request(app).post(`/v1/scope/scopes/${id}/sp-approve`).set(authed(token));
    expect(rebased.body.data).toMatchObject({ version: 2, status: "Active" });
    expect(rebased.body.data.baseline.counts.standards).toBe(3); // re-baselined
    expect(rebased.body.data.pendingChange).toBeNull();

    // A superseded v1 copy now exists alongside the active v2.
    const all = (await request(app).get("/v1/scope/scopes").set(authed(token))).body.data;
    expect(all).toHaveLength(2);
    expect(all.find((s: { status: string }) => s.status === "Superseded")).toMatchObject({ version: 1, supersededByVersion: 2 });
    // After re-baseline the diff is back in sync.
    expect((await request(app).get(`/v1/scope/scopes/${id}/diff`).set(authed(token))).body.data.entries).toHaveLength(0);
  });

  it("supersedes a prior Active scope and enforces grants", async () => {
    const a = await makeTenant("ms3", "MS3");
    const id1 = (await request(app).post("/v1/scope/scopes").set(authed(a.token)).send({ name: "Scope A", ...baseDims() })).body.data.id;
    await request(app).post(`/v1/scope/scopes/${id1}/activate`).set(authed(a.token));
    const id2 = (await request(app).post("/v1/scope/scopes").set(authed(a.token)).send({ name: "Scope B", ...baseDims() })).body.data.id;
    await request(app).post(`/v1/scope/scopes/${id2}/activate`).set(authed(a.token));
    // Activating B supersedes A.
    expect((await request(app).get(`/v1/scope/scopes/${id1}`).set(authed(a.token))).body.data.status).toBe("Superseded");

    const readonly = await makeTenant("ms4", "MS4", [ACTIONS.SCOPE_READ]);
    expect((await request(app).get("/v1/scope/scopes").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/scope/scopes").set(authed(readonly.token)).send({ name: "X" })).status).toBe(403);
  });
});
