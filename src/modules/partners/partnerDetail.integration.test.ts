import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, RevenueShareStatement, Payout, Subscription } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

async function makeSo(): Promise<{ token: string }> {
  const org = await Organization.create({ name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: "SO", username: "soadmin", email: "so@axia.io", passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: "SO", tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: true, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken };
}

describe("partner detail (admin / team / tenants / billing)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("surfaces the admin card, team, acquired tenants and billing statements/payouts", async () => {
    const { token } = await makeSo();
    const partner = await request(app).post("/v1/partners").set(authed(token)).send({
      name: "Nusantara Cloud", email: "p@nusantara.cloud", country: "ID", tier: "Gold",
      admin: { fullName: "Andi Wijaya", username: "andi.admin", email: "andi@nusantara.cloud" },
    });
    const pid = partner.body.data.id;
    // General tab: the Partner Administrator card.
    expect(partner.body.data.admin).toMatchObject({ fullName: "Andi Wijaya", username: "andi.admin", status: "Pending Activation" });
    const got = await request(app).get(`/v1/partners/${pid}`).set(authed(token));
    expect(got.body.data.admin.fullName).toBe("Andi Wijaya");

    // Team tab: the admin appears as Administrator.
    const team = await request(app).get(`/v1/partners/${pid}/team`).set(authed(token));
    expect(team.body.data).toHaveLength(1);
    expect(team.body.data[0]).toMatchObject({ fullName: "Andi Wijaya", roleGroup: "Administrator", status: "Pending Activation" });

    // Tenants tab: a partner-acquired tenant (child org) with its subscription + renewal.
    const tenant = await Organization.create({ name: "Hammer Industries", code: "TEN-1", type: "Tenant", status: "Active", parentOrgId: pid, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
    await Subscription.create({ orgId: tenant.id, plan: "Growth", entitlements: {}, status: "Active", startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01") });
    const tenants = await request(app).get(`/v1/partners/${pid}/tenants`).set(authed(token));
    expect(tenants.body.data).toHaveLength(1);
    expect(tenants.body.data[0]).toMatchObject({ name: "Hammer Industries", subscription: "Growth", renewal: "2027-01-01" });

    // Billing tab: a paid revenue-share statement + payout roll up into the summary.
    const stmt = await RevenueShareStatement.create({ code: "RSS-0001", partnerOrgId: pid, period: "January 2026", totalRev: 12000000, pct: 30, partnerShare: 3600000, axiaShare: 8400000, status: "Paid" });
    await Payout.create({ code: "PO-0001", partnerOrgId: pid, statementId: stmt.id, period: "January 2026", amount: 3600000, date: "2026-02-15", status: "Paid" });
    const billing = await request(app).get(`/v1/partners/${pid}/billing`).set(authed(token));
    expect(billing.body.data).toMatchObject({ tier: "Gold", summary: { acquiredTenants: 1, totalEarned: 3600000, paidOut: 3600000, pending: 0 } });
    expect(billing.body.data.statements).toHaveLength(1);
    expect(billing.body.data.statements[0]).toMatchObject({ id: "RSS-0001", partnerShare: 3600000, status: "Paid" });
    expect(billing.body.data.payouts[0]).toMatchObject({ id: "PO-0001", statement: "RSS-0001", amount: 3600000, date: "2026-02-15" });
  });
});
