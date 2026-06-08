import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, AgreementTemplate, OrgSignatory } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function setup(): Promise<{ token: string; partnerId: string; templateId: string }> {
  const so = await Organization.create({
    name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
    parentOrgId: null, tenantId: null, email: "legal@axia.io", phone: null, website: null, country: "ID",
    address: "Jakarta, Indonesia",
  });
  await OrgSignatory.create({ orgId: so.id, fullName: "AXIA Platform Owner", title: "Chief Executive Officer", email: "ceo@axia.io", signatureImage: null, status: "Active" });
  const admin = await User.create({
    orgId: so.id, tenantId: null, fullName: "Admin", username: "soadmin", email: "soadmin@axia.io",
    passwordHash: await hashPassword("ChangeMe123"), status: "Active",
    position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
  });
  const role = await Role.create({ name: "SO Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true });
  await (admin as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  const partner = await Organization.create({
    name: "Nusantara Cloud", code: "NWP", type: "Distributor", status: "Active",
    parentOrgId: so.id, tenantId: null, email: "partners@nusantara.cloud", phone: "+62 21 5555 1200",
    website: null, country: "ID", address: "Jl. Sudirman 52, Jakarta",
    partnerStatus: "Draft" as never, partnerTier: "Gold" as never, partnerCode: "PRT-1001",
  });
  const template = await AgreementTemplate.create({
    code: "tpl-distributor", name: "Distributor Agreement", description: null, version: "v1.4", status: "Active",
    blocks: [
      { id: "b1", type: "heading", text: "PARTNERSHIP AGREEMENT" },
      { id: "b2", type: "paragraph", text: "Partner: {{partner_name}} ({{partner_code}}), agreement {{agreement_number}}." },
      { id: "b3", type: "clause", text: "Revenue share is {{revenue_share_percentage}} governed by {{governing_law}}." },
      { id: "b4", type: "paragraph", text: "Signed by {{service_provider_signatory_name}}, {{service_provider_signatory_title}}." },
    ],
  });
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return { token: login.body.data.accessToken, partnerId: partner.id, templateId: template.id };
}

describe("partner agreements", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("exposes the variable catalog", async () => {
    const { token } = await setup();
    const res = await request(app).get("/v1/partnership-agreements/variables").set(bearer(token));
    expect(res.status).toBe(200);
    const keys = res.body.data.map((v: { key: string }) => v.key);
    expect(keys).toContain("partner_name");
    expect(keys).toContain("revenue_share_percentage");
    expect(res.body.data.length).toBe(28);
  });

  it("generates an agreement: assigns a number, fills variables, and moves the partner to Pending Approval", async () => {
    const { token, partnerId, templateId } = await setup();
    const res = await request(app).post(`/v1/partners/${partnerId}/agreement/generate`).set(bearer(token))
      .send({ templateId, vars: { revenueShare: "20", governingLaw: "Republic of Indonesia", partnerSignatory: "Andi Wijaya" } });
    expect(res.status).toBe(201);
    expect(res.body.data.number).toBe("AGR-2026-0001");
    expect(res.body.data.status).toBe("Pending Approval");
    const blocks = res.body.data.renderedBlocks as { text: string }[];
    expect(blocks[1].text).toBe("Partner: Nusantara Cloud (PRT-1001), agreement AGR-2026-0001.");
    expect(blocks[2].text).toBe("Revenue share is 20% governed by Republic of Indonesia.");
    // Service-provider signatory pulled from the SO Active OrgSignatory.
    expect(blocks[3].text).toBe("Signed by AXIA Platform Owner, Chief Executive Officer.");

    const partner = await request(app).get(`/v1/partners/${partnerId}`).set(bearer(token));
    expect(partner.body.data.status).toBe("Pending Approval");
  });

  it("regenerates with a fresh number and approves the agreement", async () => {
    const { token, partnerId, templateId } = await setup();
    await request(app).post(`/v1/partners/${partnerId}/agreement/generate`).set(bearer(token)).send({ templateId });
    const regen = await request(app).post(`/v1/partners/${partnerId}/agreement/regenerate`).set(bearer(token));
    expect(regen.status).toBe(200);
    expect(regen.body.data.number).toBe("AGR-2026-0002");

    const approved = await request(app).post(`/v1/partners/${partnerId}/agreement/approve`).set(bearer(token));
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("Approved");
    expect(approved.body.data.history.some((h: { event: string }) => h.event.includes("Approved"))).toBe(true);
  });

  it("returns null agreement for a partner with none generated", async () => {
    const { token, partnerId } = await setup();
    const res = await request(app).get(`/v1/partners/${partnerId}/agreement`).set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("terminating the partner cascades the agreement to Terminated and blocks regenerate", async () => {
    const { token, partnerId, templateId } = await setup();
    await request(app).post(`/v1/partners/${partnerId}/agreement/generate`).set(bearer(token)).send({ templateId });
    const term = await request(app).post(`/v1/partners/${partnerId}/terminate`).set(bearer(token));
    expect(term.status).toBe(200);
    expect(term.body.data.status).toBe("Terminated");

    const agreement = await request(app).get(`/v1/partners/${partnerId}/agreement`).set(bearer(token));
    expect(agreement.body.data.status).toBe("Terminated");

    const regen = await request(app).post(`/v1/partners/${partnerId}/agreement/regenerate`).set(bearer(token));
    expect(regen.status).toBe(400);
    expect(regen.body.error.code).toBe("AGREEMENT_TERMINATED");
  });

  it("resend appends a history event without changing status", async () => {
    const { token, partnerId, templateId } = await setup();
    await request(app).post(`/v1/partners/${partnerId}/agreement/generate`).set(bearer(token)).send({ templateId });
    const res = await request(app).post(`/v1/partners/${partnerId}/agreement/resend`).set(bearer(token));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("Pending Approval");
    expect(res.body.data.history.some((h: { event: string }) => h.event.includes("Resent"))).toBe(true);
  });
});
