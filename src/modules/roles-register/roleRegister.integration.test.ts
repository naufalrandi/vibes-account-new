import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const RR = [ACTIONS.ORGROLE_READ, ACTIONS.ORGROLE_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = RR): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("role register (templates + assignments)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a template, assigns it, and tracks the Modified state via template diff", async () => {
    const { token } = await makeTenant("rr1", "RR1");

    const tpl = await request(app).post("/v1/org-roles/templates").set(authed(token))
      .send({ name: "Quality Manager", category: "Management System", responsibilities: ["Own QMS", "Chair MRM"], authorities: ["Approve procedures"], status: "Active" });
    expect(tpl.status).toBe(201);
    expect(tpl.body.data).toMatchObject({ code: "ROL-0001", category: "Management System", responsibilities: ["Own QMS", "Chair MRM"] });
    const roleId = tpl.body.data.id;

    // Assignment seeds responsibilities/authorities from the template → not modified.
    const asg = await request(app).post("/v1/org-roles/assignments").set(authed(token))
      .send({ memberId: "m1", memberName: "Alice", roleId, workUnit: "Plant A" });
    expect(asg.status).toBe(201);
    expect(asg.body.data).toMatchObject({ code: "RA-0001", roleName: "Quality Manager", responsibilities: ["Own QMS", "Chair MRM"], modified: false, status: "Active" });
    const asgId = asg.body.data.id;

    // Diverge the assignment → Modified with a summary.
    const mod = await request(app).put(`/v1/org-roles/assignments/${asgId}`).set(authed(token)).send({ responsibilities: ["Own QMS"], modReason: "Site-specific scope" });
    expect(mod.body.data.modified).toBe(true);
    expect(mod.body.data.status).toBe("Modified");
    expect(mod.body.data.modSummary).toContain("Responsibilities +0/-1");
    expect(mod.body.data.modReason).toBe("Site-specific scope");

    // Restore to match the template → back to Active, not modified.
    const restored = await request(app).put(`/v1/org-roles/assignments/${asgId}`).set(authed(token)).send({ responsibilities: ["Own QMS", "Chair MRM"] });
    expect(restored.body.data.modified).toBe(false);
    expect(restored.body.data.status).toBe("Active");

    expect((await request(app).get("/v1/org-roles/templates").set(authed(token))).body.data).toHaveLength(1);
    expect((await request(app).get("/v1/org-roles/assignments").set(authed(token))).body.data).toHaveLength(1);

    const arch = await request(app).post(`/v1/org-roles/templates/${roleId}/archive`).set(authed(token));
    expect(arch.body.data.status).toBe("Archived");
  });

  it("enforces tenant scoping and action grants", async () => {
    const a = await makeTenant("rr2", "RR2");
    const b = await makeTenant("rr3", "RR3");
    const tpl = await request(app).post("/v1/org-roles/templates").set(authed(a.token)).send({ name: "Auditor", category: "Audit" });
    expect((await request(app).get("/v1/org-roles/templates").set(authed(b.token))).body.data).toHaveLength(0);
    expect((await request(app).put(`/v1/org-roles/templates/${tpl.body.data.id}`).set(authed(b.token)).send({ name: "hax" })).status).toBe(404);

    const readonly = await makeTenant("rr4", "RR4", [ACTIONS.ORGROLE_READ]);
    expect((await request(app).get("/v1/org-roles/templates").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/org-roles/templates").set(authed(readonly.token)).send({ name: "x" })).status).toBe(403);
    // Invalid category rejected.
    expect((await request(app).post("/v1/org-roles/templates").set(authed(a.token)).send({ name: "x", category: "Nope" })).status).toBe(400);
  });
});
