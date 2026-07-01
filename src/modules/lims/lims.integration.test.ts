import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";
import { limsGenerate } from "./limsEngine";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const LIMS = [ACTIONS.LIMS_READ, ACTIONS.LIMS_MANAGE];

async function makeTenant(username: string, code: string, actions = LIMS): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  const user = await User.create({ orgId: org.id, tenantId: null, fullName: "T", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  await (user as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("limsGenerate engine (unit)", () => {
  it("Sampling supplants Sample Receipt; cert/retention/disposal append after Report", () => {
    // Environmental: planning M, sampling M, cert N, retention M, disposal M
    const env = limsGenerate({ planning: "Mandatory", sampling: "Mandatory", cert: "Not Applicable", retention: "Mandatory", disposal: "Mandatory" });
    expect(env).toEqual([
      "Inquiry", "Quotation", "Contract / Work Order", "Sampling Planning", "Sampling",
      "Sample Registration", "Sample Review & Acceptance", "Testing", "Technical Review", "Authorization", "Report Issuance",
      "Sample Retention", "Sample Disposal",
    ]);
    expect(env).not.toContain("Sample Receipt");
  });

  it("keeps Sample Receipt when sampling is inactive; optional stages need a toggle", () => {
    // Electronic: all configurable N except cert/retention/disposal Optional
    const stages = { planning: "Not Applicable" as const, sampling: "Not Applicable" as const, cert: "Optional" as const, retention: "Optional" as const, disposal: "Optional" as const };
    const none = limsGenerate(stages);
    expect(none).toContain("Sample Receipt");
    expect(none).not.toContain("Certificate Issuance");
    expect(none).toHaveLength(10);
    const withCert = limsGenerate(stages, ["cert", "disposal"]);
    expect(withCert).toContain("Certificate Issuance");
    expect(withCert).toContain("Sample Disposal");
    expect(withCert).not.toContain("Sample Retention"); // retention Optional but not toggled
  });
});

describe("LIMS module (integration)", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("serves the static workflow catalog", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const cfg = await request(app).get("/v1/lims/workflow-config").set(authed(token));
    expect(cfg.status).toBe(200);
    expect(cfg.body.data.baseStages).toHaveLength(10);
    expect(cfg.body.data.baseStages[0]).toBe("Inquiry");
    expect(cfg.body.data.configurableStages.map((s: { key: string }) => s.key)).toEqual(["planning", "sampling", "cert", "retention", "disposal"]);
    expect(cfg.body.data.states).toEqual(["Mandatory", "Optional", "Not Applicable"]);
  });

  it("CRUDs a testing service with an auto TS- code and normalized stages", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const created = await request(app).post("/v1/lims/testing-services").set(authed(token))
      .send({ name: "Water Testing", stages: { planning: "Mandatory", sampling: "Mandatory" } });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: "TS-1001", name: "Water Testing", status: "Active" });
    // Unset stages normalize to Not Applicable.
    expect(created.body.data.stages).toMatchObject({ planning: "Mandatory", sampling: "Mandatory", cert: "Not Applicable", retention: "Not Applicable", disposal: "Not Applicable" });

    const second = await request(app).post("/v1/lims/testing-services").set(authed(token)).send({ name: "Soil Testing" });
    expect(second.body.data.code).toBe("TS-1002");

    const updated = await request(app).put(`/v1/lims/testing-services/${created.body.data.id}`).set(authed(token)).send({ status: "Inactive", stages: { cert: "Optional" } });
    expect(updated.body.data.status).toBe("Inactive");
    expect(updated.body.data.stages).toMatchObject({ planning: "Mandatory", cert: "Optional" });

    const list = await request(app).get("/v1/lims/testing-services").set(authed(token));
    expect(list.body.data).toHaveLength(2);
  });

  it("generates a workflow preview honoring optional toggles", async () => {
    const { token } = await makeTenant("t1", "TEN1");
    const svc = await request(app).post("/v1/lims/testing-services").set(authed(token))
      .send({ name: "Electronic", stages: { cert: "Optional", retention: "Optional", disposal: "Optional" } });
    const id = svc.body.data.id;
    const base = await request(app).get(`/v1/lims/workflow-preview?serviceId=${id}`).set(authed(token));
    expect(base.body.data.stages).toContain("Sample Receipt");
    expect(base.body.data.stages).not.toContain("Certificate Issuance");
    const toggled = await request(app).get(`/v1/lims/workflow-preview?serviceId=${id}&optional=cert&optional=disposal`).set(authed(token));
    expect(toggled.body.data.stages).toContain("Certificate Issuance");
    expect(toggled.body.data.stages).toContain("Sample Disposal");
    expect(toggled.body.data.stages).not.toContain("Sample Retention");
  });

  it("scopes services per tenant and enforces action grants", async () => {
    const a = await makeTenant("t1", "TEN1");
    const b = await makeTenant("t2", "TEN2");
    const created = await request(app).post("/v1/lims/testing-services").set(authed(a.token)).send({ name: "A svc" });
    expect((await request(app).get("/v1/lims/testing-services").set(authed(b.token))).body.data).toHaveLength(0);
    expect((await request(app).put(`/v1/lims/testing-services/${created.body.data.id}`).set(authed(b.token)).send({ name: "x" })).status).toBe(403);

    const readonly = await makeTenant("t3", "TEN3", [ACTIONS.LIMS_READ]);
    expect((await request(app).get("/v1/lims/testing-services").set(authed(readonly.token))).status).toBe(200);
    expect((await request(app).post("/v1/lims/testing-services").set(authed(readonly.token)).send({ name: "x" })).status).toBe(403);
  });
});
