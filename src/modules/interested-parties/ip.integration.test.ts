import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const IP = [ACTIONS.IP_READ, ACTIONS.IP_MANAGE, ACTIONS.MS_READ, ACTIONS.MS_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = IP): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "Jennifer Susan Walters", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("interested parties + requirements", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("derives party status and counts from its requirements", async () => {
    const { token } = await makeTenant("ip1", "IP1");
    expect((await request(app).post("/v1/interested-parties/parties").set(authed(token)).send({ name: "X", category: "Bogus" })).status).toBe(400);
    const party = await request(app).post("/v1/interested-parties/parties").set(authed(token)).send({ name: "Ministry of Manpower", category: "Regulators", frameworks: ["ISO 45001:2018"] });
    expect(party.body.data).toMatchObject({ code: "IP-0001", category: "Regulators" });
    const pid = party.body.data.id;
    // No requirements yet → derived status Under Review.
    expect((await request(app).get("/v1/interested-parties/parties").set(authed(token))).body.data[0]).toMatchObject({ derivedStatus: "Under Review", reqCount: 0 });

    const req = await request(app).post("/v1/interested-parties/requirements").set(authed(token)).send({ partyId: pid, topic: "OH&S legal compliance", type: "Legal / Regulatory Requirement", relatedCO: true, linkedObligations: ["COBL-0001"] });
    expect(req.body.data).toMatchObject({ code: "IP-REQ-0001", status: "Open", relatedCO: true });
    // Related-CO requires an obligation.
    expect((await request(app).post("/v1/interested-parties/requirements").set(authed(token)).send({ partyId: pid, topic: "T", relatedCO: true, linkedObligations: [] })).status).toBe(400);
    // Party now Active, 1 req, 1 linked CO.
    expect((await request(app).get("/v1/interested-parties/parties").set(authed(token))).body.data[0]).toMatchObject({ derivedStatus: "Active", reqCount: 1, linkedCoCount: 1 });
  });

  it("runs the requirement lifecycle and raises a risk into the risks register", async () => {
    const { token } = await makeTenant("ip2", "IP2");
    const pid = (await request(app).post("/v1/interested-parties/parties").set(authed(token)).send({ name: "Key Customer", category: "Clients or Customers" })).body.data.id;
    const rid = (await request(app).post("/v1/interested-parties/requirements").set(authed(token)).send({ partyId: pid, topic: "Secure delivery", type: "Customer Requirement", description: "Consistent, secure service" })).body.data.id;

    // Cannot raise a risk before Addressed.
    expect((await request(app).post(`/v1/interested-parties/requirements/${rid}/raise-risk`).set(authed(token)).send({})).status).toBe(409);
    // Open → Under Review → Addressed.
    await request(app).post(`/v1/interested-parties/requirements/${rid}/status`).set(authed(token)).send({ status: "Under Review" });
    const addressed = await request(app).post(`/v1/interested-parties/requirements/${rid}/status`).set(authed(token)).send({ status: "Addressed" });
    expect(addressed.body.data).toMatchObject({ status: "Addressed", decidedBy: "Jennifer Susan Walters" });

    // Raise a risk → creates a linked record in the risks register + flags the requirement.
    const raised = await request(app).post(`/v1/interested-parties/requirements/${rid}/raise-risk`).set(authed(token)).send({ description: "Delivery interruption risk" });
    expect(raised.body.data).toMatchObject({ raisedAsRisk: true, linkedRisk: "RSK-0001" });
    const risks = await request(app).get("/v1/implementation/risks").set(authed(token));
    expect(risks.body.data[0].data).toMatchObject({ category: "Quality Risks", source: "Interested Party", sourceReqId: "IP-REQ-0001" });
    // The requirement now reports a linked risk.
    expect((await request(app).get("/v1/interested-parties/requirements").set(authed(token))).body.data[0].linkedRiskCount).toBe(1);
    // Archiving an addressed req with an open linked risk is blocked.
    expect((await request(app).post(`/v1/interested-parties/requirements/${rid}/archive`).set(authed(token)).send({ justification: "done" })).status).toBe(409);
  });

  it("requires justification for dismiss/hold, links obligations, and guards party archive + grants", async () => {
    const { token } = await makeTenant("ip3", "IP3");
    const pid = (await request(app).post("/v1/interested-parties/parties").set(authed(token)).send({ name: "Supplier", category: "Suppliers" })).body.data.id;
    const rid = (await request(app).post("/v1/interested-parties/requirements").set(authed(token)).send({ partyId: pid, topic: "Availability" })).body.data.id;

    // Dismiss without justification is rejected; with justification it succeeds.
    expect((await request(app).post(`/v1/interested-parties/requirements/${rid}/status`).set(authed(token)).send({ status: "Dismissed" })).status).toBe(400);
    const dismissed = await request(app).post(`/v1/interested-parties/requirements/${rid}/status`).set(authed(token)).send({ status: "Dismissed", justification: "No longer applicable" });
    expect(dismissed.body.data).toMatchObject({ status: "Dismissed", dismissJustification: "No longer applicable" });

    // Link/unlink obligations keeps relatedCO in sync.
    const linked = await request(app).post(`/v1/interested-parties/requirements/${rid}/obligations`).set(authed(token)).send({ obligations: ["COBL-0001", "COBL-0002"] });
    expect(linked.body.data).toMatchObject({ relatedCO: true, linkedObligations: ["COBL-0001", "COBL-0002"] });
    expect((await request(app).post(`/v1/interested-parties/requirements/${rid}/obligations`).set(authed(token)).send({ obligations: [] })).body.data.relatedCO).toBe(false);

    // Party archive is allowed once all requirements are dismissed/archived.
    const arch = await request(app).post(`/v1/interested-parties/parties/${pid}/archive`).set(authed(token)).send({});
    expect(arch.body.data.status).toBe("Archived");

    // Grants.
    const readonly = await makeTenant("ip4", "IP4", [ACTIONS.IP_READ]);
    expect((await request(app).get("/v1/interested-parties/parties").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/interested-parties/parties").set(authed(readonly.token)).send({ name: "N", category: "Suppliers" })).status).toBe(403);
  });
});
