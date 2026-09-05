import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { initModels, Organization, Role, User } from "../models";
import { AXIA_TEAM, SP_MODULES, seedAxiaTeam } from "./axiaTeam";
import { SP_TEAM, ensurePerson } from "./competenceRoles";
import { resetDb } from "../../../test/helpers";

/**
 * OD `seedUsers()` parity. The states asserted here are the reason the roster
 * exists: before it, a seeded database had three generic principals and the
 * Team Management screen could not show a suspended account, a pending
 * activation, an unprovisioned staff member, or a business-unit grant.
 */
describe("AXIA_TEAM — OD seedUsers() parity", () => {
  it("carries OD's fourteen members, in order", () => {
    expect(AXIA_TEAM.map((m) => m.fullName)).toEqual([
      "Matthew Michael Murdock", "Natalia Alianovna Romanova", "Nicholas Joseph Fury",
      "Carol Susan Jane Danvers", "Steven Grant Rogers", "Jean Elaine Grey",
      "Wanda Marya Maximoff", "Peter Benjamin Parker", "Ororo Munroe",
      "Robert Bruce Banner", "Scott Edward Summers", "Robert Louis Drake",
      "Kurt Wagner", "Anna Marie LeBeau",
    ]);
  });

  it("keeps OD's non-Active statuses rather than making everyone Active", () => {
    const byName = Object.fromEntries(AXIA_TEAM.map((m) => [m.fullName, m.status]));
    expect(byName["Steven Grant Rogers"]).toBe("Pending Activation");
    expect(byName["Jean Elaine Grey"]).toBe("Suspended");
    expect(AXIA_TEAM.filter((m) => m.status === "Active")).toHaveLength(12);
  });

  it("keeps the eight roster-only members unprovisioned and role-group-less", () => {
    const unprovisioned = AXIA_TEAM.filter((m) => !m.provisioned);
    expect(unprovisioned).toHaveLength(8);
    // A person on the roster with no login must not carry a role group — that
    // is what distinguishes staff from a principal.
    expect(unprovisioned.every((m) => m.roleGroup === "" && m.permissions.length === 0)).toBe(true);
  });

  it("carries OD's per-business-unit grants", () => {
    const units = Object.fromEntries(AXIA_TEAM.filter((m) => m.units.length).map((m) => [m.fullName, m.units]));
    expect(units).toEqual({
      "Carol Susan Jane Danvers": ["lims", "datana", "motoran"],
      "Scott Edward Summers": ["acert"],
      "Robert Louis Drake": ["lims"],
    });
  });

  it("gives the platform owner every module and the one Custom Access member a subset", () => {
    const owner = AXIA_TEAM.find((m) => m.superAdmin)!;
    expect(owner.permissionMode).toBe("Full Access");
    expect(owner.permissions).toEqual([...SP_MODULES]);

    const custom = AXIA_TEAM.filter((m) => m.permissionMode === "Custom Access");
    expect(custom).toHaveLength(1);
    expect(custom[0].permissions).toEqual(["team", "tenant", "framework"]);
  });

  it("SP_TEAM is the same two people, not a second roster", () => {
    expect(SP_TEAM.map((p) => p.odId)).toEqual(["axia1", "axia2"]);
    for (const p of SP_TEAM) {
      const m = AXIA_TEAM.find((x) => x.odId === p.odId)!;
      expect(p).toEqual({ odId: m.odId, fullName: m.fullName, email: m.email, position: m.title });
    }
  });
});

describe("seedAxiaTeam", () => {
  beforeAll(() => initModels());
  // `User.email` is unique database-wide, so the roster is effectively a
  // singleton — a second org cannot seed its own copy. Reset between cases.
  beforeEach(() => resetDb());

  async function org() {
    return Organization.create({
      name: `Axia-${randomUUID()}`, code: `AX-${randomUUID().slice(0, 8)}`, type: "ServiceOwner",
      status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null,
      country: null, address: null,
    });
  }

  it("seeds the roster with its role groups, and seeds no passwords", async () => {
    const o = await org();
    for (const name of ["Super Admin", "Administrator", "Billing Manager", "Technical Support"]) {
      await Role.create({ name, tierScope: "ServiceOwner", orgId: o.id, isSuperAdmin: name === "Super Admin", status: true });
    }

    await seedAxiaTeam(o.id);
    const users = await User.findAll({ where: { orgId: o.id }, include: [Role] });
    expect(users).toHaveLength(14);
    // Seeded staff are roster entries, not accounts anyone can log into.
    expect(users.every((u) => u.passwordHash === null)).toBe(true);

    const roleNames = (u: User) => ((u.get("Roles") as Role[] | undefined) ?? []).map((r) => r.name);
    const owner = users.find((u) => u.fullName === "Matthew Michael Murdock")!;
    // OD's superAdmin flag, expressed the way this backend expresses it — the
    // Super Admin role is what `user.service` reads to lock the account.
    expect(roleNames(owner)).toEqual(["Super Admin"]);
    expect(roleNames(users.find((u) => u.fullName === "Nicholas Joseph Fury")!)).toEqual(["Technical Support"]);
    expect(roleNames(users.find((u) => u.fullName === "Kurt Wagner")!)).toEqual([]);

    const drake = users.find((u) => u.fullName === "Robert Louis Drake")!;
    expect(drake.units).toEqual(["lims"]);
    expect(drake.department).toBe("Quality");
    expect(drake.provisioned).toBe(false);
  });

  it("is idempotent, and fills in a bare row ensurePerson created first", async () => {
    const o = await org();
    // competenceRoles.ts may run first and create the person with nothing but
    // name/email/position; the roster fields must still land.
    await ensurePerson(o.id, null, "Matthew Michael Murdock", "matthew.murdock@axia.io", "Platform Owner");

    await seedAxiaTeam(o.id);
    await seedAxiaTeam(o.id);

    expect(await User.count({ where: { orgId: o.id } })).toBe(14);
    const owner = await User.findOne({ where: { email: "matthew.murdock@axia.io" } });
    expect(owner).toMatchObject({ username: "superadmin", department: "Executive", provisioned: true });
    expect(owner!.permissions).toEqual([...SP_MODULES]);
  });
});
