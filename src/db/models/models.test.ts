import { describe, expect, it, beforeAll, afterEach } from "vitest";
import { initModels, Organization, User } from "./index";
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
  });
});
