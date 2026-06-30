import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import {
  initModels, Organization, User, Role, PartnerProfile, TenantProfile, Invoice, Subscription,
} from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";
import { computeShare, generateStatementForPartner } from "./billing.service";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const BILLING = [ACTIONS.BILLING_READ, ACTIONS.BILLING_MANAGE];

/** SO + a distributor(Gold) + a tenant(child of distributor) with a paid + unpaid invoice. */
async function setup(): Promise<{ token: string; tenantId: string; distId: string; paidId: string; unpaidId: string }> {
  const so = await Organization.create({ name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const dist = await Organization.create({ name: "Nusantara", code: "NPART", type: "Distributor", status: "Active", parentOrgId: so.id, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await PartnerProfile.create({ orgId: dist.id, code: "PRT-1001", tier: "Gold", status: "Active", adminUserId: null, commercialSummary: null, audit: [] });
  const tenant = await Organization.create({ name: "Garuda", code: "GARUDA", type: "Tenant", status: "Active", parentOrgId: dist.id, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  tenant.tenantId = tenant.id; await tenant.save();
  await TenantProfile.create({ orgId: tenant.id, acquisition: "Partner", partnerOrgId: dist.id, billingOwner: null, status: "Active", subscriptionSummary: null, audit: [] });
  await Subscription.create({ orgId: tenant.id, plan: "standard", entitlements: {}, status: "Active", startDate: new Date(), endDate: null });

  const paid = await Invoice.create({ number: "INV-2026-0001", orgId: tenant.id, period: "January 2026", periodStart: "2026-01-01", periodEnd: "2026-01-31", amount: 12000000, currency: "IDR", status: "Paid", paidDate: "2026-02-05", dueDate: null });
  const unpaid = await Invoice.create({ number: "INV-2026-0002", orgId: tenant.id, period: "February 2026", periodStart: "2026-02-01", periodEnd: "2026-02-28", amount: 12000000, currency: "IDR", status: "Unpaid", paidDate: null, dueDate: "2026-03-14" });

  const user = await User.create({ orgId: so.id, tenantId: null, fullName: "SO", username: "soadmin", email: "soadmin@axia.io", passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: "SO", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, BILLING);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, tenantId: tenant.id, distId: dist.id, paidId: paid.id, unpaidId: unpaid.id };
}

describe("billing money math (unit)", () => {
  it("splits revenue by tier with no float drift", () => {
    expect(computeShare("Gold", 12000000)).toEqual({ pct: 20, partnerShare: 2400000, axiaShare: 9600000 });
    expect(computeShare("Silver", 10000001)).toEqual({ pct: 15, partnerShare: 1500000, axiaShare: 8500001 });
    expect(computeShare("Bronze", 999)).toEqual({ pct: 10, partnerShare: 100, axiaShare: 899 });
  });
});

describe("billing", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires billing.read", async () => {
    const so = await Organization.create({ name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
    const user = await User.create({ orgId: so.id, tenantId: null, fullName: "X", username: "noaccess", email: "n@x.io", passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
    const role = await Role.create({ name: "R", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true });
    await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "noaccess", password: "ChangeMe123" });
    const res = await request(app).get("/v1/billing/invoices").set(authed(login.body.data.accessToken));
    expect(res.status).toBe(403);
  });

  it("plan CRUD with auto codes", async () => {
    const { token } = await setup();
    const a = await request(app).post("/v1/billing/plans").set(authed(token)).send({ name: "Starter", billingFrequency: "Monthly" });
    expect(a.status).toBe(201);
    expect(a.body.data.code).toMatch(/^PLN-\d{4}$/);
    const upd = await request(app).put(`/v1/billing/plans/${a.body.data.id}`).set(authed(token)).send({ status: "Inactive" });
    expect(upd.body.data.status).toBe("Inactive");
    const list = await request(app).get("/v1/billing/plans").set(authed(token));
    expect(list.body.data).toHaveLength(1);
  });

  it("returns invoice amounts as plain numbers (not BIGINT strings)", async () => {
    const { token } = await setup();
    const res = await request(app).get("/v1/billing/invoices").set(authed(token));
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((i: { amount: unknown }) => typeof i.amount === "number")).toBe(true);
  });

  it("pays an unpaid invoice → payment + receipt issued, invoice Paid", async () => {
    const { token, unpaidId } = await setup();
    const pay = await request(app).post(`/v1/billing/invoices/${unpaidId}/pay`).set(authed(token)).send({ method: "QRIS" });
    expect(pay.status).toBe(200);
    expect(pay.body.data.status).toBe("Paid");
    expect(pay.body.data.paidDate).toBeTruthy();

    const payments = await request(app).get("/v1/billing/payments").set(authed(token));
    expect(payments.body.data.some((p: { invoice: string; method: string }) => p.invoice === "INV-2026-0002" && p.method === "QRIS")).toBe(true);
    const receipts = await request(app).get("/v1/billing/receipts").set(authed(token));
    expect(receipts.body.data).toHaveLength(1);

    // Paying again is rejected.
    expect((await request(app).post(`/v1/billing/invoices/${unpaidId}/pay`).set(authed(token)).send({ method: "QRIS" })).status).toBe(409);
  });

  it("rejects an unsupported payment method", async () => {
    const { token, unpaidId } = await setup();
    const res = await request(app).post(`/v1/billing/invoices/${unpaidId}/pay`).set(authed(token)).send({ method: "Bitcoin" });
    expect(res.status).toBe(400);
  });

  it("revenue share: generate from paid invoices (Gold 20%) and mark the payout paid", async () => {
    const { token, distId } = await setup();
    await generateStatementForPartner(distId, "January 2026");

    const rs = await request(app).get("/v1/billing/revenue-share").set(authed(token));
    expect(rs.body.data).toHaveLength(1);
    expect(rs.body.data[0]).toMatchObject({ pct: 20, totalRev: 12000000, partnerShare: 2400000, axiaShare: 9600000 });

    const payouts = await request(app).get("/v1/billing/payouts").set(authed(token));
    expect(payouts.body.data[0].status).toBe("Pending");
    expect(payouts.body.data[0].amount).toBe(2400000);
    const paid = await request(app).post(`/v1/billing/payouts/${payouts.body.data[0].id}/mark-paid`).set(authed(token));
    expect(paid.body.data.status).toBe("Paid");
    expect(paid.body.data.date).toBeTruthy();
  });

  it("dashboard KPIs reconcile with the underlying rows", async () => {
    const { token, distId } = await setup();
    await generateStatementForPartner(distId, "January 2026");
    const res = await request(app).get("/v1/billing/dashboard").set(authed(token));
    const d = res.body.data;
    expect(d.totalRevenue).toBe(24000000); // 12M paid + 12M unpaid
    expect(d.paidRevenue).toBe(12000000);
    expect(d.outstanding).toBe(12000000);
    expect(d.activeSubscriptions).toBe(1);
    expect(d.draftInvoices).toBe(0);
    expect(d.partnerShareLiability).toBe(2400000); // statement not yet Paid
    expect(d.upcomingPayouts).toBe(2400000);
    expect(d.recentInvoices.length).toBe(2);
  });

  it("scopes billing — a Tenant sees only its own invoices and no revenue share", async () => {
    const { tenantId } = await setup();
    const role = await Role.create({ name: "Administrator", tierScope: "Tenant", orgId: tenantId, isSuperAdmin: false, status: true });
    await grantActions(role.id, BILLING);
    const u = await User.create({ orgId: tenantId, tenantId, fullName: "T", username: "tenant.u", email: "t@t.io", passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
    await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "tenant.u", password: "ChangeMe123" });
    const t = login.body.data.accessToken;

    expect((await request(app).get("/v1/billing/invoices").set(authed(t))).body.data).toHaveLength(2);
    expect((await request(app).get("/v1/billing/revenue-share").set(authed(t))).body.data).toHaveLength(0);
  });
});
