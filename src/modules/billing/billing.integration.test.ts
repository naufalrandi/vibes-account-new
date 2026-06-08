import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, Invoice, PartnerAgreement, AgreementTemplate } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function setup() {
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
  await (admin as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  const partner = await Organization.create({
    name: "Nusantara Cloud", code: "NWP", type: "Distributor", status: "Active",
    parentOrgId: so.id, tenantId: null, email: null, phone: null, website: null, country: "ID", address: null,
    partnerStatus: "Active" as never, partnerTier: "Gold" as never, partnerCode: "PRT-1001",
  });
  const tenant = await Organization.create({
    name: "PT Maju Bersama", code: "MAJU", type: "Tenant", status: "Active",
    parentOrgId: partner.id, tenantId: null, email: null, phone: null, website: null, country: "ID", address: null,
  });
  const tpl = await AgreementTemplate.create({ code: "tpl-distributor", name: "Distributor Agreement", description: null, version: "v1.4", status: "Active", blocks: [] });
  await PartnerAgreement.create({
    orgId: partner.id, agreementTemplateId: tpl.id, number: "AGR-2026-0001", version: "v1.4", status: "Approved",
    effectiveDate: "2026-01-01", expirationDate: "2027-12-31", vars: { revenueShare: "20" }, renderedBlocks: [], history: [],
  });
  // Two months of invoices for the partner-acquired tenant.
  await Invoice.create({ number: "INV-2026-0001", orgId: tenant.id, period: "January 2026", start: "2026-01-01", end: "2026-01-31", amount: 12000000, currency: "IDR", status: "Paid", paidDate: "2026-02-05", dueDate: null });
  await Invoice.create({ number: "INV-2026-0002", orgId: tenant.id, period: "February 2026", start: "2026-02-01", end: "2026-02-28", amount: 12000000, currency: "IDR", status: "Unpaid", paidDate: null, dueDate: "2026-02-14" });
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken };
}

describe("billing", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    expect((await request(app).get("/v1/billing/dashboard")).status).toBe(401);
  });

  it("creates and edits plans with auto codes", async () => {
    const { token } = await setup();
    const created = await request(app).post("/v1/billing/plans").set(bearer(token)).send({ name: "Starter", billingFrequency: "Monthly" });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe("PLN-0001");
    const updated = await request(app).put(`/v1/billing/plans/${created.body.data.id}`).set(bearer(token)).send({ status: "Inactive" });
    expect(updated.body.data.status).toBe("Inactive");
    const list = await request(app).get("/v1/billing/plans").set(bearer(token));
    expect(list.body.data).toHaveLength(1);
  });

  it("lists invoices and derives payments + receipts from paid invoices", async () => {
    const { token } = await setup();
    const invoices = await request(app).get("/v1/billing/invoices").set(bearer(token));
    expect(invoices.body.data).toHaveLength(2);
    const payments = await request(app).get("/v1/billing/payments").set(bearer(token));
    expect(payments.body.data).toHaveLength(1); // only the Paid invoice
    expect(payments.body.data[0]).toMatchObject({ id: "PAY-0001", invoice: "INV-2026-0001", status: "Verified" });
    const receipts = await request(app).get("/v1/billing/receipts").set(bearer(token));
    expect(receipts.body.data[0]).toMatchObject({ id: "RCP-2026-0001", payment: "PAY-0001", status: "Issued" });
  });

  it("derives revenue-share statements at the agreement rate and partner payouts", async () => {
    const { token } = await setup();
    const rs = await request(app).get("/v1/billing/revenue-share").set(bearer(token));
    expect(rs.body.data.length).toBe(2); // Jan + Feb
    const jan = rs.body.data.find((s: { period: string }) => s.period === "January 2026");
    expect(jan).toMatchObject({ partner: "Nusantara Cloud", totalRev: 12000000, pct: 20, partnerShare: 2400000, axiaShare: 9600000, status: "Paid" });
    // February has an Unpaid invoice → "Approved" (not all paid); its payout is Pending.
    const feb = rs.body.data.find((s: { period: string }) => s.period === "February 2026");
    expect(feb.status).toBe("Approved");
    const payouts = await request(app).get("/v1/billing/payouts").set(bearer(token));
    expect(payouts.body.data.length).toBe(2);
    expect(payouts.body.data.find((p: { period: string }) => p.period === "February 2026").status).toBe("Pending");
  });

  it("404s when editing a non-existent plan", async () => {
    const { token } = await setup();
    const res = await request(app).put("/v1/billing/plans/00000000-0000-0000-0000-000000000000").set(bearer(token)).send({ status: "Inactive" });
    expect(res.status).toBe(404);
  });

  it("forbids a non-Service-Owner from reading billing", async () => {
    await setup();
    const tenant = await Organization.create({
      name: "Acme", code: "ACME2", type: "Tenant", status: "Active",
      parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const tUser = await User.create({
      orgId: tenant.id, tenantId: tenant.id, fullName: "T", username: "tuser", email: "t@acme.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active",
      position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const role = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true });
    await (tUser as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "tuser", password: "ChangeMe123" });
    const res = await request(app).get("/v1/billing/dashboard").set(bearer(login.body.data.accessToken));
    expect(res.status).toBe(403);
  });

  it("computes the dashboard KPIs", async () => {
    const { token } = await setup();
    const res = await request(app).get("/v1/billing/dashboard").set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ totalRevenue: 24000000, paidRevenue: 12000000, outstanding: 12000000, overdueInvoices: 1 });
    expect(res.body.data.monthlyPaid.find((m: { month: string }) => m.month === "January").amount).toBe(12000000);
  });
});
