import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { initModels, Organization, User, OrgSignatory } from "./index";
import { resetDb } from "../../../test/helpers";

describe("models", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates an organization and a user belonging to it", async () => {
    const org = await Organization.create({
      name: "AXIA",
      code: "AXIA-TEST",
      type: "ServiceOwner",
      status: "Active",
      parentOrgId: null,
      tenantId: null,
      email: "ops@axia.io",
      phone: null,
      website: null,
      country: "SG",
      address: null,
    });
    const user = await User.create({
      orgId: org.id,
      tenantId: null,
      fullName: "Sam Reyes",
      username: "sreyes-test",
      email: "sam-test@axia.io",
      passwordHash: null,
      status: "Active",
      position: null,
      workUnit: null,
      lastLogin: null,
      activationToken: null,
      resetToken: null,
      resetExpires: null,
    });
    expect(user.orgId).toBe(org.id);
    // New columns default safely without being passed.
    expect(user.system).toBe(false);
  });

  it("persists org branding/defaults/taxId, user permission metadata and signatories", async () => {
    const org = await Organization.create({
      name: "AXIA",
      code: "SP-AXIA-TEST",
      type: "ServiceOwner",
      status: "Active",
      parentOrgId: null,
      tenantId: null,
      email: null,
      phone: null,
      website: null,
      country: "ID",
      address: null,
      taxId: "01.234.567.8-901.000",
      branding: { logo: "", favicon: "", primary: "#2f6bff", secondary: "#7c5cff" },
      defaults: { currency: "IDR", timezone: "Asia/Jakarta", country: "ID", language: "English" },
    });
    expect(org.branding?.primary).toBe("#2f6bff");
    expect(org.defaults?.currency).toBe("IDR");
    expect(org.taxId).toBe("01.234.567.8-901.000");

    const admin = await User.create({
      orgId: org.id,
      tenantId: null,
      fullName: "Giandy Gumilang",
      username: "giandy-test",
      email: "giandy-test@axia.io",
      passwordHash: null,
      status: "Active",
      position: null,
      workUnit: null,
      lastLogin: null,
      activationToken: null,
      resetToken: null,
      resetExpires: null,
      system: true,
      permissionMode: "Full Access",
      permissions: ["team", "partner", "tenant", "framework", "billing", "ticket"],
    });
    expect(admin.system).toBe(true);
    expect(admin.permissionMode).toBe("Full Access");
    expect(admin.permissions).toHaveLength(6);

    const sig = await OrgSignatory.create({
      orgId: org.id,
      fullName: "AXIA Platform Owner",
      title: "Chief Executive Officer",
      email: "ceo@axia.io",
      signatureImage: null,
    });
    expect(sig.status).toBe("Active");
    expect(sig.orgId).toBe(org.id);
  });
});
