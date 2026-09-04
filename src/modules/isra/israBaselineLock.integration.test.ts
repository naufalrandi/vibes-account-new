import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, IsraAssetMapThreat, IsraAssetMapVuln, Organization, User, Role } from "../../db/models";
import { IsraThreatLibrary, IsraVulnLibrary } from "../../db/models/israLibrary.models";
import { hashPassword } from "../../lib/password";
import { resetDb, seedActionCatalog } from "../../../test/helpers";
import { grantEverythingExceptSpOnly } from "../iam/tenantGrants";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

async function seedLibraryRefData(): Promise<void> {
  await IsraThreatLibrary.findOrCreate({
    where: { id: "THR-001" },
    defaults: { id: "THR-001", name: "Unauthorized Exfiltration", category: "Technical", description: "Data exfiltration" },
  });
  await IsraVulnLibrary.findOrCreate({
    where: { id: "VUL-001" },
    defaults: { id: "VUL-001", name: "Exposed DB replica", category: "Network", description: "Publicly accessible" },
  });
}

/** Same provisioning path as `israTenantScope.integration.test.ts` — a real
 *  tenant admin via `grantEverythingExceptSpOnly`, not a hand-picked grant. */
async function makeRealTenant(username: string, code: string): Promise<{ token: string }> {
  await seedActionCatalog();
  const org = await Organization.create({
    name: code, code, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const user = await User.create({
    orgId: org.id, tenantId: null, fullName: "Tenant Admin", username, email: `${username}@axia.io`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantEverythingExceptSpOnly(role.id);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken };
}

/**
 * OD `israMapRemoveThreat` / `israMapRemoveVuln` refuse to remove a node that
 * came from the approved subgroup baseline. `getBaselineDiff`/refresh
 * reconcile the map against that baseline, so a hand-deleted inherited node
 * either reappears or silently diverges from the subgroup it tracks.
 */
async function chain(token: string, opts: { threatBaseline: boolean; vulnBaseline: boolean }) {
  const mapId = (await request(app).post("/v1/isra/asset-maps").set(authed(token))
    .send({ primaryAssetRef: "PAL-001", primaryAssetSource: "platform" })).body.data.id as string;
  const usageId = (await request(app).post(`/v1/isra/asset-maps/${mapId}/usages`).set(authed(token))
    .send({ processRef: "PRC-001" })).body.data.id as string;
  const secId = (await request(app).post(`/v1/isra/asset-maps/usages/${usageId}/secondaries`).set(authed(token))
    .send({ secondaryAssetRef: "SAL-001", secondaryAssetSource: "platform" })).body.data.id as string;
  const threatRowId = (await request(app).post(`/v1/isra/asset-maps/secondaries/${secId}/threats`).set(authed(token))
    .send({ threatId: "THR-001", isBaseline: opts.threatBaseline })).body.data.id as string;
  const vulnRowId = (await request(app).post(`/v1/isra/asset-maps/threats/${threatRowId}/vulns`).set(authed(token))
    .send({ vulnId: "VUL-001", isBaseline: opts.vulnBaseline })).body.data.id as string;
  return { threatRowId, vulnRowId };
}

describe("ISRA baseline nodes are not removable", () => {
  beforeAll(() => initModels());
  // `seedActionCatalog()` populates the shared action catalog; without a reset
  // those rows outlive this file and any later test that creates an Action by
  // key (menu.integration.test.ts creates "user.read") dies on the unique
  // constraint. Every sibling isra test resets — this one did not.
  afterEach(() => resetDb());
  it("refuses to delete an inherited baseline threat, and keeps the row", async () => {
    await seedLibraryRefData();
    const { token } = await makeRealTenant("isra_bl_t", "ORG_BL_T");
    const { threatRowId } = await chain(token, { threatBaseline: true, vulnBaseline: false });

    const res = await request(app).delete(`/v1/isra/asset-maps/threats/${threatRowId}`).set(authed(token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("BASELINE_NODE_LOCKED");
    expect(await IsraAssetMapThreat.findByPk(threatRowId)).not.toBeNull();
  });

  it("refuses to delete an inherited baseline vulnerability", async () => {
    await seedLibraryRefData();
    const { token } = await makeRealTenant("isra_bl_v", "ORG_BL_V");
    const { vulnRowId } = await chain(token, { threatBaseline: false, vulnBaseline: true });

    const res = await request(app).delete(`/v1/isra/asset-maps/vulns/${vulnRowId}`).set(authed(token));
    expect(res.status).toBe(409);
    expect(await IsraAssetMapVuln.findByPk(vulnRowId)).not.toBeNull();
  });

  it("still deletes an org-added node", async () => {
    await seedLibraryRefData();
    const { token } = await makeRealTenant("isra_bl_own", "ORG_BL_OWN");
    const { threatRowId, vulnRowId } = await chain(token, { threatBaseline: false, vulnBaseline: false });

    expect((await request(app).delete(`/v1/isra/asset-maps/vulns/${vulnRowId}`).set(authed(token))).status).toBe(200);
    expect((await request(app).delete(`/v1/isra/asset-maps/threats/${threatRowId}`).set(authed(token))).status).toBe(200);
    expect(await IsraAssetMapThreat.findByPk(threatRowId)).toBeNull();
  });
});
