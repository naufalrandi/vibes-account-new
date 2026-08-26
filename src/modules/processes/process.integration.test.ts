import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role, BusinessProcess } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb, grantActions } from "../../../test/helpers";
import { ACTIONS } from "../iam/actions.catalog";

const app = createApp();
const authed = (t: string) => ({ Authorization: `Bearer ${t}` });
const PROC = [ACTIONS.PROCESS_READ, ACTIONS.PROCESS_MANAGE];

async function makeTenant(username: string, code: string, actions: string[] = PROC): Promise<{ token: string; orgId: string }> {
  const org = await Organization.create({ name: code, code, type: "Tenant", status: "Active", parentOrgId: null, tenantId: null, email: null, phone: null, website: null, country: null, address: null });
  await User.create({ orgId: org.id, tenantId: null, fullName: "U", username, email: `${username}@x.io`, passwordHash: await hashPassword("ChangeMe123"), status: "Active", position: null, workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null });
  const role = await Role.create({ name: `R-${username}`, tierScope: "Tenant", orgId: org.id, isSuperAdmin: false, status: true });
  const u = await User.findOne({ where: { username } });
  await (u as unknown as { setRoles: (r: Role[]) => Promise<unknown> }).setRoles([role]);
  await grantActions(role.id, actions);
  const login = await request(app).post("/v1/auth/login").send({ identifier: username, password: "ChangeMe123" });
  return { token: login.body.data.accessToken, orgId: org.id };
}

describe("business processes", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("creates, lists, updates and archives a tenant-created process", async () => {
    const { token } = await makeTenant("bp1", "BP1");

    const created = await request(app).post("/v1/processes").set(authed(token)).send({ name: "Custom Onboarding" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ code: "BP-0001", name: "Custom Onboarding", status: "Active", sourceType: "Tenant Created" });
    const id = created.body.data.id;

    const list = await request(app).get("/v1/processes").set(authed(token));
    expect(list.body.data).toHaveLength(1);

    const updated = await request(app).put(`/v1/processes/${id}`).set(authed(token)).send({ status: "Inactive" });
    expect(updated.body.data.status).toBe("Inactive");

    const archived = await request(app).post(`/v1/processes/${id}/archive`).set(authed(token));
    expect(archived.body.data.status).toBe("Archived");
  });

  it("wuEnsureBps: catalog sync is idempotent and doesn't touch tenant-created rows", async () => {
    const { token, orgId } = await makeTenant("bp2", "BP2");

    const first = await request(app).post("/v1/processes/sync-catalog").set(authed(token));
    expect(first.status).toBe(200);
    const countAfterFirst = first.body.data.length;
    expect(countAfterFirst).toBeGreaterThan(0);
    expect(first.body.data.every((p: { sourceType: string }) => p.sourceType === "Catalog")).toBe(true);

    // Running it again adds nothing.
    const second = await request(app).post("/v1/processes/sync-catalog").set(authed(token));
    expect(second.body.data).toHaveLength(countAfterFirst);
    const rows = await BusinessProcess.findAll({ where: { orgId } });
    expect(rows).toHaveLength(countAfterFirst);

    // Catalog-sourced rows cannot be edited or archived (business rule OD enforces on seeded processes).
    const catalogRow = second.body.data[0];
    expect((await request(app).put(`/v1/processes/${catalogRow.id}`).set(authed(token)).send({ name: "hax" })).status).toBe(400);
    expect((await request(app).post(`/v1/processes/${catalogRow.id}/archive`).set(authed(token))).status).toBe(400);
  });

  it("manages steps and round-trips a per-step risk raise with processId + stepId", async () => {
    const { token } = await makeTenant("bp3", "BP3");
    const proc = await request(app).post("/v1/processes").set(authed(token)).send({ name: "Incident Response" });
    const processId = proc.body.data.id;

    const step = await request(app).post(`/v1/processes/${processId}/steps`).set(authed(token)).send({
      name: "Triage & classify", responsible: "Bobbi Morse", resources: "SOC toolkit", kpi: "Triaged within 1 hour",
    });
    expect(step.status).toBe(201);
    expect(step.body.data).toMatchObject({ name: "Triage & classify", responsible: "Bobbi Morse", kpi: "Triaged within 1 hour", seq: 1 });
    const stepId = step.body.data.id;

    const risk = await request(app).post(`/v1/processes/${processId}/steps/${stepId}/risks`).set(authed(token)).send({
      description: "Backup verification skipped, risking undetected data loss.",
    });
    expect(risk.status).toBe(201);
    expect(risk.body.data.processId).toBe(processId);
    expect(risk.body.data.stepId).toBe(stepId);

    const linked = await request(app).get(`/v1/processes/${processId}/steps/${stepId}/risks`).set(authed(token));
    expect(linked.body.data).toHaveLength(1);
    expect(linked.body.data[0].id).toBe(risk.body.data.id);

    const del = await request(app).delete(`/v1/processes/${processId}/steps/${stepId}`).set(authed(token));
    expect(del.status).toBe(200);
    expect((await request(app).get(`/v1/processes/${processId}/steps`).set(authed(token))).body.data).toHaveLength(0);
  });

  it("bridges the old ImplementationRecord processes registry: raises a step risk using its ids (AXI-71)", async () => {
    const { token } = await makeTenant("bp4", "BP4", [...PROC, ACTIONS.MS_READ, ACTIONS.MS_MANAGE]);

    // Old registry row, as the live processes UI still creates it — steps live in `data.steps[]`,
    // not in `business_process_steps`.
    const legacyProcess = await request(app).post("/v1/implementation/processes").set(authed(token)).send({
      title: "Legacy Onboarding",
      status: "Active",
      data: { steps: [{ id: "step-1", name: "Collect documents" }] },
    });
    expect(legacyProcess.status).toBe(201);
    const legacyProcessId = legacyProcess.body.data.id;

    const risk = await request(app).post(`/v1/processes/${legacyProcessId}/steps/step-1/risks`).set(authed(token)).send({
      description: "Missing document checklist causes onboarding delays.",
    });
    expect(risk.status).toBe(201);
    expect(risk.body.data.processId).toBe(legacyProcessId);
    expect(risk.body.data.stepId).toBe("step-1");

    const linked = await request(app).get(`/v1/processes/${legacyProcessId}/steps/step-1/risks`).set(authed(token));
    expect(linked.body.data).toHaveLength(1);
    expect(linked.body.data[0].id).toBe(risk.body.data.id);

    // Unknown step id inside a real legacy process still 404s.
    const missingStep = await request(app).post(`/v1/processes/${legacyProcessId}/steps/no-such-step/risks`).set(authed(token)).send({
      description: "n/a",
    });
    expect(missingStep.status).toBe(404);

    // Neither a new-table id nor a legacy id: still 404, no false-positive match.
    const missingProcess = await request(app).post(`/v1/processes/00000000-0000-0000-0000-000000000000/steps/step-1/risks`).set(authed(token)).send({
      description: "n/a",
    });
    expect(missingProcess.status).toBe(404);
  });

  it("enforces action grants and tenant isolation", async () => {
    const noGrant = await makeTenant("bp4", "BP4", []);
    expect((await request(app).get("/v1/processes").set(authed(noGrant.token))).status).toBe(403);

    const a = await makeTenant("bp5", "BP5");
    const b = await makeTenant("bp6", "BP6");
    const aProc = await request(app).post("/v1/processes").set(authed(a.token)).send({ name: "A process" });
    expect((await request(app).get("/v1/processes").set(authed(b.token))).body.data).toHaveLength(0);
    expect((await request(app).get(`/v1/processes/${aProc.body.data.id}`).set(authed(b.token))).status).toBe(404);
  });
});
