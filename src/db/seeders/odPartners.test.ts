import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { initModels, Organization, PartnerAgreement, PartnerProfile, User } from "../models";
import { OD_PARTNERS, PARTNER_AG_HISTORY, agreementHistoryFor, seedOdPartners } from "./odPartners";
import { resetDb } from "../../../test/helpers";

describe("agreementHistoryFor — OD slicing", () => {
  it("shows only what the partnership actually reached", () => {
    expect(agreementHistoryFor("Draft")).toEqual(PARTNER_AG_HISTORY.slice(0, 1));
    expect(agreementHistoryFor("Pending Approval")).toEqual(PARTNER_AG_HISTORY.slice(0, 3));
    expect(agreementHistoryFor("Active")).toHaveLength(9);
    expect(agreementHistoryFor("Suspended")).toHaveLength(9);
  });
});

describe("OD_PARTNERS — OD seedPartners() parity", () => {
  it("covers the lifecycle states a single seeded partner cannot show", () => {
    expect(OD_PARTNERS.map((p) => p.code)).toEqual(["PRT-1002", "PRT-1003", "PRT-1004", "PRT-1005"]);
    // PRT-1001 (the seed.ts fixture) is Active/Gold; these four are what make
    // the status and tier filters on the Partners list reachable.
    expect(OD_PARTNERS.map((p) => p.status)).toEqual(["Pending Approval", "Draft", "Suspended", "Active"]);
    expect(new Set(OD_PARTNERS.map((p) => p.tier))).toEqual(new Set(["Silver", "Bronze", "Gold"]));
    expect(OD_PARTNERS.map((p) => p.agreement.status)).toEqual(["Pending Approval", "Draft", "Terminated", "Approved"]);
    expect(new Set(OD_PARTNERS.map((p) => p.country))).toEqual(new Set(["SG", "CL", "DE", "ID"]));
  });

  it("leaves a Draft partner's agreement unissued", () => {
    const draft = OD_PARTNERS.find((p) => p.status === "Draft")!;
    expect(draft.agreement.number).toBeNull();
    expect(draft.agreement.effectiveDate).toBeNull();
    expect(draft.agreement.expirationDate).toBeNull();
  });
});

describe("seedOdPartners", () => {
  beforeAll(() => initModels());
  beforeEach(() => resetDb());

  async function so() {
    return Organization.create({
      name: `SO-${randomUUID()}`, code: `SO-${randomUUID().slice(0, 8)}`, type: "ServiceOwner",
      status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null,
      website: null, country: null, address: null,
    });
  }

  it("seeds four partner orgs with profiles, agreements and admins, idempotently", async () => {
    const root = await so();
    await seedOdPartners(root.id);
    await seedOdPartners(root.id);

    expect(await Organization.count({ where: { parentOrgId: root.id, type: "Distributor" } })).toBe(4);
    expect(await PartnerProfile.count()).toBe(4);
    expect(await PartnerAgreement.count()).toBe(4);

    const profiles = await PartnerProfile.findAll({ order: [["code", "ASC"]] });
    expect(profiles.map((p) => p.status)).toEqual(["Pending Approval", "Draft", "Suspended", "Active"]);

    // Every partner is reachable from its own admin — the detail page reads the
    // admin off `adminUserId`, so a null there renders a partner with no owner.
    expect(profiles.every((p) => p.adminUserId !== null)).toBe(true);
  });

  it("suspends the organization of a suspended partner, and leaves the others active", async () => {
    const root = await so();
    await seedOdPartners(root.id);

    const suspended = await Organization.findOne({ where: { code: "RHEING" } });
    expect(suspended!.status).toBe("Suspended");
    expect((await Organization.findOne({ where: { code: "ABCCON" } }))!.status).toBe("Active");
  });

  it("seeds partner staff without passwords — org members, not platform logins", async () => {
    const root = await so();
    await seedOdPartners(root.id);

    const staff = await User.findAll({ where: { email: ["christian@secureedge.sg", "zinedine@abc.co", "anne@abc.co"] } });
    expect(staff).toHaveLength(3);
    expect(staff.every((u) => u.passwordHash === null)).toBe(true);
    // A partner admin who never activated stays Pending Activation rather than
    // being quietly seeded as a working account.
    expect(staff.find((u) => u.email === "christian@secureedge.sg")!.status).toBe("Pending Activation");
  });
});
