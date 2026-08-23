import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

/**
 * P-6.2 (D-2): `src/app.ts` used to mount `/v1/isra-library` twice — once for
 * `israThreatVulnLibraryRoutes`, once (accidentally) for the ISRA aggregator
 * router — and mounted that same aggregator a THIRD time at
 * `/v1/isra-asset-library`, shadowing the real asset-library router
 * (`isra/israAssetLibrary.routes.ts`, primary/secondary assets) that the FE
 * has been calling since the ISRA module shipped. `GET
 * /v1/isra-asset-library/primary-assets` therefore 404'd in production.
 *
 * Fixed by giving each of the four ISRA routers exactly one `app.use()`
 * prefix in `src/app.ts`:
 *   /v1/isra-library        -> israThreatVulnLibraryRoutes
 *   /v1/isra-org-controls   -> israOrgControlRoutes
 *   /v1/isra-asset-library  -> israAssetLibraryRoutes (the real one)
 *   /v1/isra                -> israRoutes (taxonomy/catalog/lt/asset-maps/scenarios/soa/support aggregator)
 */
const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("ISRA route mounts (P-6.2)", () => {
  it("mounts each ISRA router at exactly one /v1/isra* prefix", () => {
    const src = readFileSync(path.resolve(__dirname, "../../app.ts"), "utf8");
    const mounts = [...src.matchAll(/app\.use\("(\/v1\/isra[a-z-]*)"\s*,[^)]*?,\s*(\w+)\)/g)].map((m) => ({
      prefix: m[1],
      router: m[2],
    }));
    // Sanity: the regex actually found the four mounts we expect, not zero
    // (a silently-empty match set would make both assertions below vacuous).
    expect(mounts.length).toBe(4);
    expect(new Set(mounts.map((m) => m.prefix)).size).toBe(mounts.length);
    expect(new Set(mounts.map((m) => m.router)).size).toBe(mounts.length);
  });

  describe("primary-assets is reachable where the FE calls it", () => {
    beforeAll(() => initModels());
    afterEach(() => resetDb());

    async function soLogin(): Promise<string> {
      const so = await Organization.create({
        name: "AXIA", code: "AXIA-RM", type: "ServiceOwner", status: "Active",
        parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
      });
      await User.create({
        orgId: so.id, tenantId: null, fullName: "Admin", username: "rm-soadmin", email: "rm-soadmin@axia.io",
        passwordHash: await hashPassword("ChangeMe123"), status: "Active",
        position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
      });
      const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
      const admin = await User.findOne({ where: { username: "rm-soadmin" } });
      await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
      const login = await request(app).post("/v1/auth/login").send({ identifier: "rm-soadmin", password: "ChangeMe123" });
      return login.body.data.accessToken;
    }

    it("GET /v1/isra-asset-library/primary-assets resolves (was a 404 shadowed by the mis-mounted aggregator)", async () => {
      const token = await soLogin();
      const res = await request(app).get("/v1/isra-asset-library/primary-assets").set(authed(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("GET /v1/isra-asset-library/secondary-assets resolves the same way", async () => {
      const token = await soLogin();
      const res = await request(app).get("/v1/isra-asset-library/secondary-assets").set(authed(token));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("the aggregator's own sub-paths still resolve under its single prefix, /v1/isra", async () => {
      const token = await soLogin();
      const soa = await request(app).get("/v1/isra/soa").set(authed(token));
      expect(soa.status).toBe(200);
    });
  });
});
