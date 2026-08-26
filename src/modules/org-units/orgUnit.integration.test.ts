import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, OrgUnit } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const OU = [ACTIONS.ORGUNIT_READ, ACTIONS.ORGUNIT_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = OU): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("org units", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates a root unit at tier A and a child at tier B", async () => {
    const { token } = await makeTenant("ou1", "OU1");
    const root = await request(app).post("/v1/org-units").set(authed(token)).send({ name: "Senior Management Team" });
    expect(root.status).toBe(201);
    expect(root.body.data.tier).toBe("A");
    expect(root.body.data.parentId).toBeNull();

    const child = await request(app).post("/v1/org-units").set(authed(token)).send({ name: "Operations", parentId: root.body.data.id });
    expect(child.body.data.tier).toBe("B");
  });

  it("derives tier by depth down to E and rejects a child under a tier E node", async () => {
    const { token } = await makeTenant("ou2", "OU2");
    let parentId: string | null = null;
    const tiers = ["A", "B", "C", "D", "E"];
    for (const expected of tiers) {
      const res = await request(app).post("/v1/org-units").set(authed(token)).send({ name: `Unit ${expected}`, parentId });
      expect(res.body.data.tier).toBe(expected);
      parentId = res.body.data.id;
    }
    // parentId now points at the tier-E leaf — a 6th level would exceed max depth.
    const beyond = await request(app).post("/v1/org-units").set(authed(token)).send({ name: "Too deep", parentId });
    expect(beyond.status).toBe(400);
    expect(beyond.body.error.code).toBe("MAX_DEPTH_EXCEEDED");
  });

  it("rejects a reparent that would create a cycle (moving a node under its own descendant)", async () => {
    const { token } = await makeTenant("ou3", "OU3");
    const a = await request(app).post("/v1/org-units").set(authed(token)).send({ name: "A" });
    const b = await request(app).post("/v1/org-units").set(authed(token)).send({ name: "B", parentId: a.body.data.id });

    const res = await request(app).post(`/v1/org-units/${a.body.data.id}/reparent`).set(authed(token)).send({ parentId: b.body.data.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CYCLE_DETECTED");
  });

  it("recomputes tier/level for the moved node and its whole subtree on reparent, including affected people", async () => {
    const { token, orgId } = await makeTenant("ou4", "OU4");
    // Build: A(root) -> B(div) -> C(dept), with a person at C's tier level appointed.
    const a = await request(app).post("/v1/org-units").set(authed(token)).send({ name: "Root" }); // tier A
    const b = await request(app).post("/v1/org-units").set(authed(token)).send({ name: "Div", parentId: a.body.data.id }); // tier B
    const c = await request(app).post("/v1/org-units").set(authed(token)).send({ name: "Dept", parentId: b.body.data.id }); // tier C
    const cId = c.body.data.id;

    const person = await User.create({
      orgId, tenantId: null, fullName: "Member", username: "member1", email: "member1@x.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
      lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
      orgUnitId: cId, empLevel: "L5",
    });
    await request(app).put(`/v1/org-units/${cId}`).set(authed(token)).send({ appt: { L5: person.id } });

    // Move Dept (tier C) to top level -> becomes tier A; person's level should remap L5 -> L1.
    const preview = await request(app).post(`/v1/org-units/${cId}/reparent`).set(authed(token)).send({ parentId: null, dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.data.impacts).toEqual(expect.arrayContaining([expect.objectContaining({ unitId: cId, oldTier: "C", newTier: "A" })]));
    expect(preview.body.data.affected).toEqual(expect.arrayContaining([expect.objectContaining({ userId: person.id, oldLevel: "L5", newLevel: "L1" })]));

    const commit = await request(app).post(`/v1/org-units/${cId}/reparent`).set(authed(token)).send({ parentId: null });
    expect(commit.status).toBe(200);
    expect(commit.body.data.unit.tier).toBe("A");
    expect(commit.body.data.unit.parentId).toBeNull();

    const moved = await OrgUnit.findByPk(cId);
    expect(moved?.tier).toBe("A");
    expect(moved?.appt).toMatchObject({ L1: person.id });

    const updatedPerson = await User.findByPk(person.id);
    expect(updatedPerson?.empLevel).toBe("L1");
  });

  it("rejects a reparent that would push a subtree deeper than tier E", async () => {
    const { token } = await makeTenant("ou5", "OU5");
    let parentId: string | null = null;
    let leafId = "";
    for (const name of ["A", "B", "C", "D", "E"]) {
      const res = await request(app).post("/v1/org-units").set(authed(token)).send({ name, parentId });
      parentId = res.body.data.id;
      leafId = res.body.data.id;
    }
    const other = await request(app).post("/v1/org-units").set(authed(token)).send({ name: "Sibling root" });
    // "Sibling root" sits at depth 0 (tier A); moving it under the tier-E leaf
    // (depth 4) would place it at depth 5 — one past the max (E).
    const res = await request(app).post(`/v1/org-units/${other.body.data.id}/reparent`).set(authed(token)).send({ parentId: leafId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MAX_DEPTH_EXCEEDED");
  });

  it("enforces tenant isolation — org A cannot read or write org B's units", async () => {
    const { token: tokenA } = await makeTenant("ou6a", "OU6A");
    const { token: tokenB } = await makeTenant("ou6b", "OU6B");
    const created = await request(app).post("/v1/org-units").set(authed(tokenA)).send({ name: "A-only" });
    const id = created.body.data.id;

    const listB = await request(app).get("/v1/org-units").set(authed(tokenB));
    expect(listB.body.data).toHaveLength(0);

    const readB = await request(app).get(`/v1/org-units/${id}/members`).set(authed(tokenB));
    expect(readB.status).toBe(404);

    const writeB = await request(app).put(`/v1/org-units/${id}`).set(authed(tokenB)).send({ name: "Hijacked" });
    expect(writeB.status).toBe(404);
  });

  it("denies reparent/edit to a caller without ORGUNIT_MANAGE", async () => {
    const { token: managerToken } = await makeTenant("ou7m", "OU7M");
    const created = await request(app).post("/v1/org-units").set(authed(managerToken)).send({ name: "Root" });

    const { token: readOnlyToken } = await makeTenant("ou7r", "OU7R", [ACTIONS.ORGUNIT_READ]);
    const denied = await request(app).post(`/v1/org-units/${created.body.data.id}/reparent`).set(authed(readOnlyToken)).send({ parentId: null });
    expect(denied.status).toBe(403);
  });
});
