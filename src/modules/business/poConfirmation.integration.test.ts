import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, BusinessRecord } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";
import { applyPoConfirmToken, verifyPoToken } from "./poConfirmation";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });

/** OD `poMakeToken` — reproduced to prove this backend does NOT accept it. */
function odMakeToken(id: string, issuedDate: string): string {
  const s = "vibes" + id + issuedDate;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36) + id.replace(/\D/g, "").slice(-4);
}

describe("applyPoConfirmToken — the token is server-owned", () => {
  it("ignores a client-supplied token outright", () => {
    const out = applyPoConfirmToken(null, { confirmToken: "attacker-chosen", sentAt: "2026-08-01" }, "Sent");
    expect(out.confirmToken).not.toBe("attacker-chosen");
    expect(String(out.confirmToken).length).toBeGreaterThan(20);
  });

  it("mints nothing until the PO is actually sent", () => {
    expect(applyPoConfirmToken(null, {}, "Issued").confirmToken).toBe("");
    expect(applyPoConfirmToken(null, {}, "Sent").confirmToken).not.toBe("");
    expect(applyPoConfirmToken(null, { sentAt: "2026-08-01" }, "Issued").confirmToken).not.toBe("");
  });

  it("never rotates a token already issued — a resend must not break the supplier's link", () => {
    const prev = { confirmToken: "live-token" };
    expect(applyPoConfirmToken(prev, { confirmToken: "other" }, "Sent").confirmToken).toBe("live-token");
  });

  it("verifyPoToken rejects blanks, so an unsent PO cannot be opened with an empty token", () => {
    expect(verifyPoToken("", "")).toBe(false);
    expect(verifyPoToken("abc", "")).toBe(false);
    expect(verifyPoToken("", "abc")).toBe(false);
    expect(verifyPoToken("abc", "abc")).toBe(true);
    expect(verifyPoToken("abc", "abd")).toBe(false);
  });
});

describe("public supplier PO confirmation", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  async function actor() {
    const org = await Organization.create({
      name: "SP", code: "SP", type: "ServiceOwner", status: "Active", parentOrgId: null,
      tenantId: null, email: null, phone: null, website: null, country: null, address: null,
    });
    const user = await User.create({
      orgId: org.id, tenantId: null, fullName: "SP User", username: "sp1", email: "sp1@x.io",
      passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null,
      lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
    });
    const role = await Role.create({ name: "SP R", tierScope: "ServiceOwner", orgId: org.id, isSuperAdmin: false, status: true });
    await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
    await grantActions(role.id, [ACTIONS.BUSINESS_READ, ACTIONS.BUSINESS_MANAGE]);
    const login = await request(app).post("/v1/auth/login").send({ identifier: "sp1", password: "ChangeMe123" });
    return { token: login.body.data.accessToken as string };
  }

  /** Issue a PO, then send it — the send is what mints the link token. */
  async function sentPo(token: string) {
    const data = {
      supplierName: "Stark Industries Supply",
      issuedDate: "2026-08-01", deliveryBy: "2026-09-01", currency: "IDR",
      terms: "30", amount: 1000, prId: "pr-1",
    };
    const created = await request(app).post("/v1/business/enterprise/ent-po").set(authed(token))
      .send({ title: "Stark Industries Supply", status: "Issued", data });
    const id = created.body.data.id as string;
    const sent = await request(app).put(`/v1/business/enterprise/ent-po/${id}`).set(authed(token))
      .send({ title: "Stark Industries Supply", status: "Sent", data: { ...data, sentAt: "2026-08-01T00:00:00.000Z", sentCount: 1 } });
    return { id, code: sent.body.data.code as string, confirmToken: sent.body.data.data.confirmToken as string };
  }

  it("mints an unguessable token on send, and refuses OD's derivable one", async () => {
    const a = await actor();
    const po = await sentPo(a.token);
    expect(po.confirmToken).toBeTruthy();
    expect(po.confirmToken.length).toBeGreaterThan(20);

    // The whole reason this diverges from OD: its token is computable from the
    // PO code and issue date, both printed on the order.
    const forged = odMakeToken(po.code, "2026-08-01");
    expect(po.confirmToken).not.toBe(forged);
    const res = await request(app).get(`/v1/public/purchase-orders/${po.code}/confirmation?t=${forged}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("INVALID_LINK");
  });

  it("serves the PO to a supplier holding the real link, with no authentication", async () => {
    const a = await actor();
    const po = await sentPo(a.token);
    const res = await request(app).get(`/v1/public/purchase-orders/${po.code}/confirmation?t=${encodeURIComponent(po.confirmToken)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: po.code, supplierName: "Stark Industries Supply", currency: "IDR",
      total: 1000, subtotal: 1000, tax: 0,
      terms: "Net 30 business days from invoice date",
      buyer: "PT AXIA Global Indonesia", deliveryDate: "2026-09-01",
    });
    // The PO stores one amount, so OD's sheet renders a single derived row.
    expect(res.body.data.items).toEqual([
      { desc: "Stark Industries Supply", qty: 1, unit: "Lot", price: 1000, total: 1000 },
    ]);
  });

  it("records an acknowledgement once, and refuses a replay", async () => {
    const a = await actor();
    const po = await sentPo(a.token);
    const url = `/v1/public/purchase-orders/${po.code}/confirmation?t=${encodeURIComponent(po.confirmToken)}`;

    const ok = await request(app).post(url).send({ state: "Acknowledged" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.ack).toMatchObject({ state: "Acknowledged" });

    const row = await BusinessRecord.findOne({ where: { code: po.code } });
    expect(row!.status).toBe("Acknowledged");

    // A leaked link must not be replayable to flip the answer afterwards.
    const replay = await request(app).post(url).send({ state: "Declined", note: "changed my mind" });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe("ALREADY_RESPONDED");
  });

  it("requires a reason to decline, matching OD", async () => {
    const a = await actor();
    const po = await sentPo(a.token);
    const url = `/v1/public/purchase-orders/${po.code}/confirmation?t=${encodeURIComponent(po.confirmToken)}`;

    const blank = await request(app).post(url).send({ state: "Declined", note: "   " });
    expect(blank.status).toBe(404);

    const good = await request(app).post(url).send({ state: "Declined", note: "Out of stock" });
    expect(good.status).toBe(200);
    expect(good.body.data.ack).toMatchObject({ state: "Declined", note: "Out of stock" });
  });

  it("refuses a link for a voided PO, and one for a PO past the response window", async () => {
    const a = await actor();
    const po = await sentPo(a.token);
    const url = `/v1/public/purchase-orders/${po.code}/confirmation?t=${encodeURIComponent(po.confirmToken)}`;

    const row = await BusinessRecord.findOne({ where: { code: po.code } });
    row!.data = { ...(row!.data as object), voided: true };
    await row!.save();
    expect((await request(app).get(url)).status).toBe(404);

    row!.data = { ...(row!.data as object), voided: false };
    row!.status = "Received";
    await row!.save();
    // The link stays valid for the PO's life; the status graph is what stops a
    // supplier "declining" an order that has already been received.
    expect((await request(app).get(url)).status).toBe(200);
    const late = await request(app).post(url).send({ state: "Declined", note: "too late" });
    expect(late.status).toBe(404);
  });

  it("rejects a missing token without disclosing whether the PO exists", async () => {
    const a = await actor();
    const po = await sentPo(a.token);
    const noToken = await request(app).get(`/v1/public/purchase-orders/${po.code}/confirmation`);
    const noSuchPo = await request(app).get(`/v1/public/purchase-orders/PO-DOES-NOT-EXIST/confirmation?t=whatever`);
    expect(noToken.status).toBe(404);
    expect(noSuchPo.status).toBe(404);
    expect(noToken.body.error).toEqual(noSuchPo.body.error);
  });
});
