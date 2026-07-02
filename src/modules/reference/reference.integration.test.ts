import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeUser(): Promise<string> {
  const org = await Organization.create({ name: "REF", code: "REF", type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "U", username: "refu", email: "refu@x.io", passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: "R", tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username: "refu" } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "refu", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

describe("reference datasets (full OD volume)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("serves the full ISIC/NACE/KBLI/ISCED-F classification volume", async () => {
    const token = await makeUser();
    expect((await request(app).get("/v1/reference/isic").set(authed(token))).body.data).toHaveLength(766);
    expect((await request(app).get("/v1/reference/nace").set(authed(token))).body.data).toHaveLength(996);
    expect((await request(app).get("/v1/reference/kbli").set(authed(token))).body.data).toHaveLength(2443);
    expect((await request(app).get("/v1/reference/iscedf").set(authed(token))).body.data).toHaveLength(116);
  });

  it("filters by parent and search, and serves explanatory notes", async () => {
    const token = await makeUser();
    // Top-level ISIC sections (parent = null) — the 21 UN sections A–U.
    const sections = (await request(app).get("/v1/reference/isic?parent=").set(authed(token))).body.data as { code: string; parent: string | null }[];
    expect(sections).toHaveLength(21);
    expect(sections.every((s) => s.parent === null)).toBe(true);
    // Divisions under section C (Manufacturing).
    const underC = (await request(app).get("/v1/reference/isic?parent=C").set(authed(token))).body.data as unknown[];
    expect(underC.length).toBeGreaterThan(0);
    // Search.
    const found = (await request(app).get("/v1/reference/isic?search=manufacturing").set(authed(token))).body.data as { label: string }[];
    expect(found.length).toBeGreaterThan(0);
    // Notes for a known section.
    const note = (await request(app).get("/v1/reference/isic/C/notes").set(authed(token))).body.data;
    expect(note).toBeTruthy();
  });
});
