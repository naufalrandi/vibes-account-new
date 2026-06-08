import { describe, expect, it, beforeAll, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../../app";
import { initModels, Organization, User, Role } from "../../db/models";
import { hashPassword } from "../../lib/password";
import { resetDb } from "../../../test/helpers";

const app = createApp();
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

async function soLogin(): Promise<string> {
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
  await (admin as unknown as { setRoles: (roles: Role[]) => Promise<unknown> }).setRoles([role]);
  const login = await request(app).post("/v1/auth/login").send({ identifier: "soadmin", password: "ChangeMe123" });
  return login.body.data.accessToken;
}

async function makeRequirement(token: string): Promise<string> {
  const groups = await request(app).get("/v1/framework-groups").set(bearer(token));
  const standards = (groups.body.data as { id: string; name: string }[]).find((g) => g.name === "Standards");
  const fw = await request(app).post("/v1/frameworks").set(bearer(token)).send({ groupId: standards?.id, name: "ISO 9001" });
  const req = await request(app).post("/v1/requirements").set(bearer(token)).send({ frameworkId: fw.body.data.id, code: "Clause 9.2.1", subject: "Internal Audit", description: "x" });
  return req.body.data.id as string;
}

describe("assessment engine", () => {
  beforeAll(() => initModels());
  afterEach(() => resetDb());

  it("requires authentication", async () => {
    expect((await request(app).get("/v1/assessment/response-criteria")).status).toBe(401);
  });

  it("builds an element assessment: question → responses → criterion scoring", async () => {
    const token = await soLogin();
    const requirementId = await makeRequirement(token);
    // criteria for the requirement (scores 0 and 2)
    const c0 = await request(app).post("/v1/criteria").set(bearer(token)).send({ requirementId, score: 0, description: "No process." });
    const c2 = await request(app).post("/v1/criteria").set(bearer(token)).send({ requirementId, score: 2, description: "Planned." });

    const el = await request(app).post("/v1/elements").set(bearer(token)).send({ name: "Internal Audit" });
    const elementId = el.body.data.id;

    const q = await request(app).post("/v1/assessment/questions").set(bearer(token))
      .send({ elementId, text: "How is the internal audit process defined?", sortOrder: 1 });
    expect(q.status).toBe(201);
    const r1 = await request(app).post("/v1/assessment/responses").set(bearer(token)).send({ questionId: q.body.data.id, text: "No process.", sortOrder: 1 });
    const r2 = await request(app).post("/v1/assessment/responses").set(bearer(token)).send({ questionId: q.body.data.id, text: "Planned process.", sortOrder: 2 });

    // map responses to criteria (scoring)
    const map1 = await request(app).put(`/v1/assessment/responses/${r1.body.data.id}/criterion`).set(bearer(token)).send({ criterionId: c0.body.data.id });
    expect(map1.status).toBe(200);
    expect(map1.body.data.criterion.score).toBe(0);
    await request(app).put(`/v1/assessment/responses/${r2.body.data.id}/criterion`).set(bearer(token)).send({ criterionId: c2.body.data.id });

    // element assessment view
    const view = await request(app).get(`/v1/assessment/elements/${elementId}`).set(bearer(token));
    expect(view.status).toBe(200);
    expect(view.body.data.questions).toHaveLength(1);
    expect(view.body.data.questions[0].responses).toHaveLength(2);
    expect(view.body.data.questions[0].responses[0].criterion.score).toBe(0);
    expect(view.body.data.questions[0].responses[1].criterion.score).toBe(2);

    // rcmap flattened
    const rc = await request(app).get("/v1/assessment/response-criteria").set(bearer(token));
    expect(rc.body.data).toHaveLength(2);
    expect(rc.body.data.every((row: { elementName: string }) => row.elementName === "Internal Audit")).toBe(true);

    // unmap
    const unmap = await request(app).put(`/v1/assessment/responses/${r1.body.data.id}/criterion`).set(bearer(token)).send({ criterionId: null });
    expect(unmap.body.data.criterion).toBeNull();
  });

  it("cascades responses + criterion links when a question is deleted", async () => {
    const token = await soLogin();
    const requirementId = await makeRequirement(token);
    const c0 = await request(app).post("/v1/criteria").set(bearer(token)).send({ requirementId, score: 0, description: "No process." });
    const el = await request(app).post("/v1/elements").set(bearer(token)).send({ name: "Internal Audit" });
    const q = await request(app).post("/v1/assessment/questions").set(bearer(token)).send({ elementId: el.body.data.id, text: "Q?" });
    const r = await request(app).post("/v1/assessment/responses").set(bearer(token)).send({ questionId: q.body.data.id, text: "R" });
    await request(app).put(`/v1/assessment/responses/${r.body.data.id}/criterion`).set(bearer(token)).send({ criterionId: c0.body.data.id });

    const del = await request(app).delete(`/v1/assessment/questions/${q.body.data.id}`).set(bearer(token));
    expect(del.status).toBe(200);
    const rc = await request(app).get("/v1/assessment/response-criteria").set(bearer(token));
    expect(rc.body.data).toHaveLength(0);
  });

  it("lists criterion options across frameworks for mapping", async () => {
    const token = await soLogin();
    const requirementId = await makeRequirement(token);
    await request(app).post("/v1/criteria").set(bearer(token)).send({ requirementId, score: 3, description: "Managed." });
    const opts = await request(app).get("/v1/assessment/criterion-options").set(bearer(token));
    expect(opts.status).toBe(200);
    expect(opts.body.data[0].requirementCode).toBe("Clause 9.2.1");
    expect(opts.body.data[0].frameworkName).toBe("ISO 9001");
  });
});
