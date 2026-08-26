import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { RoleTemplate, RoleAssignment } from "../../db/models/roleRegister.models";
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

describe("role register (read-only: list templates + assignments)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("lists templates and assignments scoped to the requesting tenant", async () => {
    const a = await makeTenant("rr1", "RR1");
    const b = await makeTenant("rr2", "RR2");

    const tpl = await RoleTemplate.create({ orgId: a.orgId, code: "ROL-0001", name: "Quality Manager", category: "Management System", purpose: null, workUnits: [], processes: [], frameworks: [], responsibilities: ["Own QMS"], authorities: [], status: "Active", notes: null, createdBy: null });
    await RoleAssignment.create({ orgId: a.orgId, code: "RA-0001", memberId: "m1", memberName: "Alice", roleId: tpl.id, roleName: tpl.name, workUnit: "Plant A", effectiveDate: null, responsibilities: ["Own QMS"], authorities: [], modified: false, modReason: null, modSummary: null, modifiedBy: null, modifiedDate: null, status: "Active", notes: null, createdBy: null });

    const aTemplates = await request(app).get("/v1/org-roles/templates").set(authed(a.token));
    expect(aTemplates.status).toBe(200);
    expect(aTemplates.body.data).toMatchObject([{ code: "ROL-0001", category: "Management System" }]);

    const aAssignments = await request(app).get("/v1/org-roles/assignments").set(authed(a.token));
    expect(aAssignments.status).toBe(200);
    expect(aAssignments.body.data).toMatchObject([{ code: "RA-0001", roleName: "Quality Manager" }]);

    // Tenant scoping: org B sees nothing from org A.
    expect((await request(app).get("/v1/org-roles/templates").set(authed(b.token))).body.data).toHaveLength(0);
    expect((await request(app).get("/v1/org-roles/assignments").set(authed(b.token))).body.data).toHaveLength(0);
  });

  it("enforces action grants on list endpoints", async () => {
    const noAccess = await makeTenant("rr3", "RR3", []);
    expect((await request(app).get("/v1/org-roles/templates").set(authed(noAccess.token))).status).toBe(403);
    expect((await request(app).get("/v1/org-roles/assignments").set(authed(noAccess.token))).status).toBe(403);
  });
});
