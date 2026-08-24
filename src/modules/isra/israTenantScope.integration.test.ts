import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import {
  initModels,
  Organization,
  User,
  Role,
  IsraAssetMapThreat,
  IsraAssetMapVuln,
  IsraAssetMapSecondary,
} from "../../db/models";
import { IsraThreatLibrary, IsraVulnLibrary } from "../../db/models/israLibrary.models";
import { hashPassword } from "../../lib/password";
import { resetDb, seedActionCatalog } from "../../../test/helpers";
import { grantEverythingExceptSpOnly } from "../iam/tenantGrants";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

/**
 * Gap register Q1 (G-2, G-3..G-8): `ISRA_LIBRARY_MANAGE` sitting in
 * `SP_ONLY_ACTIONS` (`tenantGrants.ts`) locked every tenant out of the whole
 * org-scoped ISRA write surface (403 at the route gate) — which incidentally
 * meant the cross-tenant write paths in `israAssetMap.service.ts` were never
 * reachable by a real tenant either. Fixing the lockout without the
 * cross-tenant guards would have turned six 403s into six live cross-tenant
 * write/read holes, so both land together.
 *
 * Unlike `isra.integration.test.ts`/`israCore.integration.test.ts`, which
 * grant test roles their action set directly via `grantActions` (bypassing
 * `SP_ONLY_ACTIONS` entirely), the tenants here are built the same way a real
 * tenant is: `grantEverythingExceptSpOnly`, the exact helper
 * `tenant.service.ts`'s `provisionTenant` and `registration.service.ts`'s
 * `approveRegistration` call. That is the only way to prove G-2 actually
 * reaches production tenants, not just a test double.
 */

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

/** Provision a tenant admin the same way `provisionTenant`/`approveRegistration` do in
 * production: `grantEverythingExceptSpOnly`, not a hand-picked action list. */
async function makeRealTenant(username: string, code: string): Promise<{ token: string; orgId: string }> {
  // grantEverythingExceptSpOnly only grants actions that already exist as
  // `Action` rows (it iterates Action.findAll()) — production seeds the full
  // catalog once at boot; tests must do the same per-run.
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
  return { token: login.body.data.accessToken, orgId: org.id };
}

/** Builds map -> usage -> secondary -> threat -> vuln under the given org's token,
 * using the real HTTP routes (the same ones an attacker would hit). */
async function buildAssetMapChain(token: string) {
  const mapRes = await request(app)
    .post("/v1/isra/asset-maps")
    .set(authed(token))
    .send({ primaryAssetRef: "PAL-001", primaryAssetSource: "platform" });
  expect(mapRes.status).toBe(201);
  const mapId = mapRes.body.data.id as string;

  const usageRes = await request(app)
    .post(`/v1/isra/asset-maps/${mapId}/usages`)
    .set(authed(token))
    .send({ processRef: "PRC-001" });
  expect(usageRes.status).toBe(201);
  const usageId = usageRes.body.data.id as string;

  const secRes = await request(app)
    .post(`/v1/isra/asset-maps/usages/${usageId}/secondaries`)
    .set(authed(token))
    .send({ secondaryAssetRef: "SAL-001", secondaryAssetSource: "platform" });
  expect(secRes.status).toBe(201);
  const secId = secRes.body.data.id as string;

  const threatRes = await request(app)
    .post(`/v1/isra/asset-maps/secondaries/${secId}/threats`)
    .set(authed(token))
    .send({ threatId: "THR-001", isBaseline: false });
  expect(threatRes.status).toBe(201);
  const threatRowId = threatRes.body.data.id as string;

  const vulnRes = await request(app)
    .post(`/v1/isra/asset-maps/threats/${threatRowId}/vulns`)
    .set(authed(token))
    .send({ vulnId: "VUL-001", isBaseline: false });
  expect(vulnRes.status).toBe(201);
  const vulnRowId = vulnRes.body.data.id as string;

  return { mapId, usageId, secId, threatRowId, vulnRowId };
}

describe("ISRA tenant reachability + cross-tenant scope (gap register G-2, G-3..G-8)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("G-2: a real tenant admin (grantEverythingExceptSpOnly, the live provisioning path) can reach the ISRA org-scoped write surface", async () => {
    const { token } = await makeRealTenant("isra_g2_tenant", "ORG_G2");

    // The exact route that regressed: israLibraryOverride.routes.ts's `manage`
    // gate. Before the fix it required ISRA_LIBRARY_MANAGE (SP-only, never
    // granted by grantEverythingExceptSpOnly) -> 403 for every real tenant.
    const createItem = await request(app)
      .post("/v1/isra/lt/primary/items")
      .set(authed(token))
      .send({ name: "Custom tenant-owned primary asset" });
    expect(createItem.status).toBe(201);
    expect(createItem.body.data.name).toBe("Custom tenant-owned primary asset");

    // The rest of the org-scoped ISRA write surface (israAssetMap.routes.ts,
    // also gated on ISRA_ORG_CONTROL_MANAGE) must be reachable too.
    const createMap = await request(app)
      .post("/v1/isra/asset-maps")
      .set(authed(token))
      .send({ primaryAssetRef: "PAL-001", primaryAssetSource: "platform" });
    expect(createMap.status).toBe(201);
  });

  describe("G-3..G-8: org B cannot write/read org A's asset-map data through israAssetMap.service.ts", () => {
    it("G-3 addThreat: org B cannot attach a threat to org A's secondary", async () => {
      await seedLibraryRefData();
      const { token: tokenA } = await makeRealTenant("isra_g3_a", "ORG_G3_A");
      const { token: tokenB } = await makeRealTenant("isra_g3_b", "ORG_G3_B");
      const { secId, threatRowId } = await buildAssetMapChain(tokenA);

      const attack = await request(app)
        .post(`/v1/isra/asset-maps/secondaries/${secId}/threats`)
        .set(authed(tokenB))
        .send({ threatId: "THR-001", isBaseline: false });
      expect(attack.status).toBe(404);

      // No illegitimate row was attached to org A's secondary: still exactly
      // the one threat row org A itself created.
      const threats = await IsraAssetMapThreat.findAll({ where: { secondaryId: secId } });
      expect(threats).toHaveLength(1);
      expect(threats[0]!.id).toBe(threatRowId);
    });

    it("G-4 deleteThreat: org B cannot destroy org A's threat row", async () => {
      await seedLibraryRefData();
      const { token: tokenA } = await makeRealTenant("isra_g4_a", "ORG_G4_A");
      const { token: tokenB } = await makeRealTenant("isra_g4_b", "ORG_G4_B");
      const { threatRowId } = await buildAssetMapChain(tokenA);

      const attack = await request(app)
        .delete(`/v1/isra/asset-maps/threats/${threatRowId}`)
        .set(authed(tokenB));
      expect(attack.status).toBe(404);

      // The row survived the attempted cross-tenant destruction.
      const row = await IsraAssetMapThreat.findByPk(threatRowId);
      expect(row).not.toBeNull();
    });

    it("G-5 addVuln: org B cannot attach a vuln to org A's threat row", async () => {
      await seedLibraryRefData();
      const { token: tokenA } = await makeRealTenant("isra_g5_a", "ORG_G5_A");
      const { token: tokenB } = await makeRealTenant("isra_g5_b", "ORG_G5_B");
      const { threatRowId, vulnRowId } = await buildAssetMapChain(tokenA);

      const attack = await request(app)
        .post(`/v1/isra/asset-maps/threats/${threatRowId}/vulns`)
        .set(authed(tokenB))
        .send({ vulnId: "VUL-001", isBaseline: false });
      expect(attack.status).toBe(404);

      const vulns = await IsraAssetMapVuln.findAll({ where: { threatRowId } });
      expect(vulns).toHaveLength(1);
      expect(vulns[0]!.id).toBe(vulnRowId);
    });

    it("G-6 deleteVuln: org B cannot destroy org A's vuln row", async () => {
      await seedLibraryRefData();
      const { token: tokenA } = await makeRealTenant("isra_g6_a", "ORG_G6_A");
      const { token: tokenB } = await makeRealTenant("isra_g6_b", "ORG_G6_B");
      const { vulnRowId } = await buildAssetMapChain(tokenA);

      const attack = await request(app)
        .delete(`/v1/isra/asset-maps/vulns/${vulnRowId}`)
        .set(authed(tokenB));
      expect(attack.status).toBe(404);

      const row = await IsraAssetMapVuln.findByPk(vulnRowId);
      expect(row).not.toBeNull();
    });

    it("G-7 getBaselineDiff: org B cannot read org A's baseline diff", async () => {
      await seedLibraryRefData();
      const { token: tokenA } = await makeRealTenant("isra_g7_a", "ORG_G7_A");
      const { token: tokenB } = await makeRealTenant("isra_g7_b", "ORG_G7_B");
      const { secId } = await buildAssetMapChain(tokenA);

      const attack = await request(app)
        .get(`/v1/isra/asset-maps/secondaries/${secId}/diff`)
        .set(authed(tokenB));
      expect(attack.status).toBe(404);
    });

    it("G-8 refreshBaseline: org B cannot mutate org A's baselineVer or inject rows via refresh", async () => {
      await seedLibraryRefData();
      const { token: tokenA } = await makeRealTenant("isra_g8_a", "ORG_G8_A");
      const { token: tokenB } = await makeRealTenant("isra_g8_b", "ORG_G8_B");
      const { secId } = await buildAssetMapChain(tokenA);

      const before = await IsraAssetMapSecondary.findByPk(secId);
      const threatsBefore = await IsraAssetMapThreat.findAll({ where: { secondaryId: secId } });

      const attack = await request(app)
        .post(`/v1/isra/asset-maps/secondaries/${secId}/refresh`)
        .set(authed(tokenB));
      expect(attack.status).toBe(404);

      const after = await IsraAssetMapSecondary.findByPk(secId);
      expect(after!.baselineVer).toBe(before!.baselineVer);
      const threatsAfter = await IsraAssetMapThreat.findAll({ where: { secondaryId: secId } });
      expect(threatsAfter).toHaveLength(threatsBefore.length);
    });
  });
});
