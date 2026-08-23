import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

const ADMIN_ACTIONS = [ACTIONS.ISRA_LIBRARY_READ, ACTIONS.ISRA_LIBRARY_MANAGE, ACTIONS.ISRA_LIBRARY_ADMIN];

async function soLogin(): Promise<string> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  const admin = await User.create({
    orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function makeTenant(username: string, code: string, actions: string[] = ADMIN_ACTIONS): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({
    name: code, code, type: "Tenant", status: "Active",
    parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
  });
  await User.create({
    orgId: org.id, tenantId: null, fullName: "Tenant User", username, email: `${username}@x.io`,
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("isra taxonomy + asset library (F-2a)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("CRUDs PA groups and sub-groups, blocking deletion while referenced", async () => {
    const token = await soLogin();
    const group = await request(app).post("/v1/isra/taxonomy/pa-groups").set(authed(token)).send({ name: "Documents and Records" });
    expect(group.status).toBe(201);
    expect(group.body.data.id).toMatch(/^PAG-\d{3}$/);
    const groupId = group.body.data.id;

    const sub = await request(app).post("/v1/isra/taxonomy/pa-subgroups").set(authed(token))
      .send({ groupId, name: "Electronic Documents", description: "desc", examples: ["Word", "PDF"] });
    expect(sub.status).toBe(201);
    expect(sub.body.data.groupId).toBe(groupId);
    expect(sub.body.data.examples).toEqual(["Word", "PDF"]);
    const subId = sub.body.data.id;

    const list = await request(app).get(`/v1/isra/taxonomy/pa-subgroups?groupId=${groupId}`).set(authed(token));
    expect(list.body.data).toHaveLength(1);

    const delGroup = await request(app).delete(`/v1/isra/taxonomy/pa-groups/${groupId}`).set(authed(token));
    expect(delGroup.status).toBe(409);
    expect(delGroup.body.error.code).toBe("PA_GROUP_IN_USE");

    const delSub = await request(app).delete(`/v1/isra/taxonomy/pa-subgroups/${subId}`).set(authed(token));
    expect(delSub.status).toBe(200);
    const delGroup2 = await request(app).delete(`/v1/isra/taxonomy/pa-groups/${groupId}`).set(authed(token));
    expect(delGroup2.status).toBe(200);
  });

  it("runs the SA Subgroup approval-workflow transition", async () => {
    const token = await soLogin();
    const group = await request(app).post("/v1/isra/taxonomy/sa-groups").set(authed(token)).send({ name: "Applications and Software" });
    const groupId = group.body.data.id;
    expect(groupId).toMatch(/^SAG-\d{3}$/);
    const sub = await request(app).post("/v1/isra/taxonomy/sa-subgroups").set(authed(token))
      .send({ groupId, name: "Backend Services and APIs", description: "desc" });
    expect(sub.body.data.id).toMatch(/^SSG-\d{3}$/);
    expect(sub.body.data.status).toBe("Draft");
    const subId = sub.body.data.id;

    const badStatus = await request(app).post(`/v1/isra/taxonomy/sa-subgroups/${subId}/status`).set(authed(token)).send({ status: "Bogus" });
    expect(badStatus.status).toBe(400);
    expect(badStatus.body.error.code).toBe("INVALID_STATUS");

    const underReview = await request(app).post(`/v1/isra/taxonomy/sa-subgroups/${subId}/status`).set(authed(token)).send({ status: "Under review" });
    expect(underReview.body.data.status).toBe("Under review");

    const approved = await request(app).post(`/v1/isra/taxonomy/sa-subgroups/${subId}/status`).set(authed(token)).send({ status: "Approved" });
    expect(approved.body.data.status).toBe("Approved");

    const retired = await request(app).post(`/v1/isra/taxonomy/sa-subgroups/${subId}/status`).set(authed(token)).send({ status: "Retired" });
    expect(retired.body.data.status).toBe("Retired");
  });

  it("forbids non-Service-Owner actors from taxonomy/catalogue admin mutations even with the admin grant", async () => {
    const { token } = await makeTenant("t1", "T1");
    const res = await request(app).post("/v1/isra/taxonomy/pa-groups").set(authed(token)).send({ name: "X" });
    expect(res.status).toBe(403);
  });

  it("allows any authenticated org to read the global taxonomy and asset catalogue", async () => {
    const soToken = await soLogin();
    await request(app).post("/v1/isra/taxonomy/pa-groups").set(authed(soToken)).send({ name: "Business Records" });
    const { token } = await makeTenant("t2", "T2", [ACTIONS.ISRA_LIBRARY_READ]);
    const list = await request(app).get("/v1/isra/taxonomy/pa-groups").set(authed(token));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  it("CRUDs the Primary/Secondary Asset Library with group/sub-group validation", async () => {
    const token = await soLogin();
    const paGroup = await request(app).post("/v1/isra/taxonomy/pa-groups").set(authed(token)).send({ name: "Business Records" });
    const paSub = await request(app).post("/v1/isra/taxonomy/pa-subgroups").set(authed(token))
      .send({ groupId: paGroup.body.data.id, name: "Financial Records" });

    const mismatch = await request(app).post("/v1/isra/catalog/primary-assets").set(authed(token))
      .send({ name: "Customer Ledger", groupId: paGroup.body.data.id, subgroupId: "PASG-999" });
    expect(mismatch.status).toBe(404);

    const asset = await request(app).post("/v1/isra/catalog/primary-assets").set(authed(token))
      .send({ name: "Customer Ledger", groupId: paGroup.body.data.id, subgroupId: paSub.body.data.id, privacy: true });
    expect(asset.status).toBe(201);
    expect(asset.body.data.id).toMatch(/^PAL-\d{3}$/);
    expect(asset.body.data.category).toBe("Business Records");
    expect(asset.body.data.privacy).toBe(true);

    const saGroup = await request(app).post("/v1/isra/taxonomy/sa-groups").set(authed(token)).send({ name: "Storage and Backup" });
    const otherSaGroup = await request(app).post("/v1/isra/taxonomy/sa-groups").set(authed(token)).send({ name: "Cloud and Virtual Infrastructure" });
    const saSub = await request(app).post("/v1/isra/taxonomy/sa-subgroups").set(authed(token))
      .send({ groupId: saGroup.body.data.id, name: "Backup Media" });

    const saMismatch = await request(app).post("/v1/isra/catalog/secondary-assets").set(authed(token))
      .send({ name: "Tape Library", groupId: otherSaGroup.body.data.id, subgroupId: saSub.body.data.id });
    expect(saMismatch.status).toBe(400);
    expect(saMismatch.body.error.code).toBe("SUBGROUP_MISMATCH");

    const saAsset = await request(app).post("/v1/isra/catalog/secondary-assets").set(authed(token))
      .send({ name: "Tape Library", groupId: saGroup.body.data.id, subgroupId: saSub.body.data.id });
    expect(saAsset.status).toBe(201);
    expect(saAsset.body.data.id).toMatch(/^SAL-\d{3}$/);

    const updated = await request(app).put(`/v1/isra/catalog/secondary-assets/${saAsset.body.data.id}`).set(authed(token))
      .send({ description: "Offline archival tape storage" });
    expect(updated.body.data.description).toBe("Offline archival tape storage");

    const deleted = await request(app).delete(`/v1/isra/catalog/secondary-assets/${saAsset.body.data.id}`).set(authed(token));
    expect(deleted.status).toBe(200);
  });
});

describe("isra Lt override/item/archive/audit system (F-2a)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  async function seedPlatformPrimaryAsset(token: string): Promise<{ id: string; name: string }> {
    const group = await request(app).post("/v1/isra/taxonomy/pa-groups").set(authed(token)).send({ name: "Business Records" });
    const sub = await request(app).post("/v1/isra/taxonomy/pa-subgroups").set(authed(token))
      .send({ groupId: group.body.data.id, name: "Financial Records" });
    const asset = await request(app).post("/v1/isra/catalog/primary-assets").set(authed(token))
      .send({ name: "Customer Ledger", groupId: group.body.data.id, subgroupId: sub.body.data.id });
    return asset.body.data as { id: string; name: string };
  }

  it("customizes a platform item via override, then restores the platform default", async () => {
    const soToken = await soLogin();
    const asset = await seedPlatformPrimaryAsset(soToken);
    const { token } = await makeTenant("lt1", "LT1", [ACTIONS.ISRA_LIBRARY_READ, ACTIONS.ISRA_LIBRARY_MANAGE]);

    const effBefore = await request(app).get("/v1/isra/lt/primary/effective").set(authed(token));
    expect(effBefore.status).toBe(200);
    expect(effBefore.body.data).toHaveLength(1);
    expect(effBefore.body.data[0]).toMatchObject({ source: "platform", platformItemId: asset.id, customized: false, name: asset.name });
    const key = effBefore.body.data[0].key as string;

    const save = await request(app).put(`/v1/isra/lt/primary/overrides/${asset.id}`).set(authed(token))
      .send({ name: "Customer Ledger (Localized)" });
    expect(save.status).toBe(200);
    expect(save.body.data.overrideVersion).toBe(1);
    expect(save.body.data.fields).toMatchObject({ name: "Customer Ledger (Localized)" });

    const effAfter = await request(app).get("/v1/isra/lt/primary/effective").set(authed(token));
    expect(effAfter.body.data[0]).toMatchObject({ customized: true, name: "Customer Ledger (Localized)", key });

    // A second save with no real change bumps the override version but keeps
    // an (empty) diff — mirrors OD's `israLtSaveOverride` re-diffing against
    // the platform master, not against the previous override.
    const resave = await request(app).put(`/v1/isra/lt/primary/overrides/${asset.id}`).set(authed(token))
      .send({ name: "Customer Ledger (Localized)" });
    expect(resave.body.data.overrideVersion).toBe(2);
    expect(resave.body.data.history).toHaveLength(1);

    const restore = await request(app).delete(`/v1/isra/lt/primary/overrides/${asset.id}`).set(authed(token));
    expect(restore.status).toBe(200);
    const effRestored = await request(app).get("/v1/isra/lt/primary/effective").set(authed(token));
    expect(effRestored.body.data[0]).toMatchObject({ customized: false, name: asset.name });

    const restoreAgain = await request(app).delete(`/v1/isra/lt/primary/overrides/${asset.id}`).set(authed(token));
    expect(restoreAgain.status).toBe(404);

    const audit = await request(app).get("/v1/isra/lt/audit/log?libType=primary").set(authed(token));
    expect(audit.body.data.map((a: { action: string }) => a.action)).toEqual(["restore-default", "edit-override", "customize"]);
  });

  it("creates, copies, updates, archives and unarchives tenant-owned library items", async () => {
    const soToken = await soLogin();
    const asset = await seedPlatformPrimaryAsset(soToken);
    const { token } = await makeTenant("lt2", "LT2", [ACTIONS.ISRA_LIBRARY_READ, ACTIONS.ISRA_LIBRARY_MANAGE]);

    const created = await request(app).post("/v1/isra/lt/primary/items").set(authed(token)).send({ name: "Wholly Custom Asset" });
    expect(created.status).toBe(201);
    expect(created.body.data.tenantItemId).toMatch(/^TPA-\d{4}$/);

    const eff = await request(app).get("/v1/isra/lt/primary/effective").set(authed(token));
    expect(eff.body.data).toHaveLength(2);
    const platformRow = eff.body.data.find((r: { source: string }) => r.source === "platform");

    const copied = await request(app).post("/v1/isra/lt/primary/items/copy").set(authed(token)).send({ sourceKey: platformRow.key });
    expect(copied.status).toBe(201);
    expect(copied.body.data.name).toBe(`${asset.name} (Custom Copy)`);
    expect(copied.body.data.tenantItemId).not.toBe(created.body.data.tenantItemId);

    const updated = await request(app).put(`/v1/isra/lt/primary/items/${created.body.data.tenantItemId}`).set(authed(token))
      .send({ name: "Renamed Custom Asset" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe("Renamed Custom Asset");

    const effFinal = await request(app).get("/v1/isra/lt/primary/effective").set(authed(token));
    expect(effFinal.body.data).toHaveLength(3);
    const tenantRow = effFinal.body.data.find((r: { tenantItemId: string }) => r.tenantItemId === created.body.data.tenantItemId);
    expect(tenantRow.name).toBe("Renamed Custom Asset");

    const archived = await request(app).post("/v1/isra/lt/primary/archive").set(authed(token)).send({ itemKey: tenantRow.key });
    expect(archived.status).toBe(201);
    const dupArchive = await request(app).post("/v1/isra/lt/primary/archive").set(authed(token)).send({ itemKey: tenantRow.key });
    expect(dupArchive.status).toBe(409);
    expect(dupArchive.body.error.code).toBe("ALREADY_ARCHIVED");

    const archList = await request(app).get("/v1/isra/lt/primary/archive").set(authed(token));
    expect(archList.body.data).toHaveLength(1);

    const effArchived = await request(app).get("/v1/isra/lt/primary/effective").set(authed(token));
    expect(effArchived.body.data.find((r: { key: string }) => r.key === tenantRow.key).archived).toBe(true);

    const unarchived = await request(app).post("/v1/isra/lt/primary/unarchive").set(authed(token)).send({ itemKey: tenantRow.key });
    expect(unarchived.status).toBe(200);
    const archListAfter = await request(app).get("/v1/isra/lt/primary/archive").set(authed(token));
    expect(archListAfter.body.data).toHaveLength(0);

    const missingUnarchive = await request(app).post("/v1/isra/lt/primary/unarchive").set(authed(token)).send({ itemKey: tenantRow.key });
    expect(missingUnarchive.status).toBe(404);
  });

  it("isolates Lt customizations and audit entries between orgs", async () => {
    const soToken = await soLogin();
    const asset = await seedPlatformPrimaryAsset(soToken);
    const t1 = await makeTenant("iso1", "ISO1", [ACTIONS.ISRA_LIBRARY_READ, ACTIONS.ISRA_LIBRARY_MANAGE]);
    const t2 = await makeTenant("iso2", "ISO2", [ACTIONS.ISRA_LIBRARY_READ, ACTIONS.ISRA_LIBRARY_MANAGE]);

    const t1Save = await request(app).put(`/v1/isra/lt/primary/overrides/${asset.id}`).set(authed(t1.token)).send({ name: "Org1 Name" });
    expect(t1Save.status).toBe(200);

    const eff2 = await request(app).get("/v1/isra/lt/primary/effective").set(authed(t2.token));
    expect(eff2.body.data[0]).toMatchObject({ customized: false, name: asset.name });

    const audit1 = await request(app).get("/v1/isra/lt/audit/log").set(authed(t1.token));
    expect(audit1.body.data).toHaveLength(1);
    const audit2 = await request(app).get("/v1/isra/lt/audit/log").set(authed(t2.token));
    expect(audit2.body.data).toHaveLength(0);
  });

  it("rejects an invalid library type and requires authentication", async () => {
    const { token } = await makeTenant("lt3", "LT3", [ACTIONS.ISRA_LIBRARY_READ]);
    const bad = await request(app).get("/v1/isra/lt/bogus/effective").set(authed(token));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("INVALID_LIB_TYPE");

    const noAuth = await request(app).get("/v1/isra/lt/primary/effective");
    expect(noAuth.status).toBe(401);
  });
});
