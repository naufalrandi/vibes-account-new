import { describe, expect, it } from "vitest";
import { IMPLEMENTATION_DATA_SCHEMAS } from "./dataSchemas";
import { MS_MODULES } from "./registry";

/**
 * One regression guard per module schema: an unrecognized key must 400 (schema
 * is `.strict()`), and a payload built only from the fields the schema itself
 * declares must parse clean. Either assertion fails the moment a future edit
 * drops `.strict()` or narrows/renames a field without updating this test.
 */
describe("implementation data schemas reject unknown keys", () => {
  for (const [module, schema] of Object.entries(IMPLEMENTATION_DATA_SCHEMAS)) {
    it(`${module}: rejects a typo'd field`, () => {
      expect(() => schema!.parse({ notARealField: "typo" })).toThrow();
    });

    it(`${module}: accepts an empty payload (every field optional)`, () => {
      expect(schema!.parse({})).toEqual({});
    });
  }
});

/**
 * The 17 SOF-24 scaffold registers OD renders through `renderTenantModule()`'s
 * generic fallback. That fallback writes no field and OD seeds no collection
 * for any of them, so there is no field contract to derive and they stay on the
 * open `data` JSONB (SOF-37) rather than carrying a schema of guesses. Listed
 * here so the coverage guard below still fails on a genuinely unregistered key.
 */
const OPEN_PAYLOAD_MODULES = [
  "capa", "mmr", "hira",
  "cab-schemes", "cab-audits", "cab-decisions", "cab-impartiality", "cab-appeals",
  "pcb-schemes", "pcb-exams", "pcb-candidates", "pcb-decisions", "pcb-appeals",
  "lab-methods", "lab-equipment", "lab-uncertainty", "lab-pt",
];

/**
 * SOF-38's acceptance criterion: every register key with a known field contract
 * validates its payload, not just the five SOF-23 shipped. A new `MS_MODULES`
 * entry without a schema is a silent regression back to
 * `z.record(z.string(), z.unknown())`, so fail here unless it is one of the 17
 * open-payload scaffolds above.
 */
it("covers every registered module", () => {
  const missing = Object.keys(MS_MODULES).filter(
    (k) => !IMPLEMENTATION_DATA_SCHEMAS[k as keyof typeof IMPLEMENTATION_DATA_SCHEMAS] && !OPEN_PAYLOAD_MODULES.includes(k),
  );
  expect(missing).toEqual([]);
});

it("leaves the 17 OD-scaffold registers on the open payload", () => {
  expect(OPEN_PAYLOAD_MODULES.filter((k) => k in MS_MODULES)).toEqual(OPEN_PAYLOAD_MODULES);
  expect(
    OPEN_PAYLOAD_MODULES.filter((k) => IMPLEMENTATION_DATA_SCHEMAS[k as keyof typeof IMPLEMENTATION_DATA_SCHEMAS]),
  ).toEqual([]);
});

/**
 * Keys every generic register carries regardless of module — the two
 * justification notes `ImplementationModal` writes on a Dismissed/Archived
 * save, the activity/comment trails, and the authorship stamps. Dropping one
 * from `envelope` would 400 an ordinary status change, which no per-module
 * payload test would catch.
 */
const ENVELOPE = [
  "createdBy", "createdDate", "lastUpdatedBy", "postedBy", "postDate", "notes", "note",
  "description", "remarks", "activity", "comments", "dismissJustification",
  "archiveJustification", "holdJustification", "justification", "archivedBy", "archivedAt",
  "dismissedBy", "dismissedAt", "_activityNote"
];

/**
 * The module-specific half of each schema, frozen. This is the test that fails
 * if a schema regresses: renaming, dropping or mistyping a field name here is
 * a 400 on a payload the frontend really sends, and the diff says exactly
 * which module and which field. Sources for each list are documented per
 * schema in `dataSchemas.ts`; regenerate by listing `schema.shape` minus
 * `ENVELOPE` if you add a field on purpose.
 */
const MODULE_FIELDS: Record<string, string[]> = {
  "awareness": [
   "focus", "objective", "period",
  ],
  "awareness-campaigns": [
   "ackRate", "ackRequired", "acks", "audience", "audienceType", "delivery", "due", "dueDate",
   "evalMethod", "evalRate", "evalRequired", "evals", "focus", "followups", "launchedAt",
   "launchedBy", "message", "programId", "startDate", "topicId", "topics",
  ],
  "awareness-topics": [
   "category", "keyMessages", "materials", "programId", "summary",
  ],
  "cab-clients": [
   "certNo", "expiry", "issued", "nextSurveillance", "scope", "standard",
  ],
  "compliance": [
   "category", "dueDate", "framework", "linkedRiskId", "obligation", "priority", "raisedAsRisk",
   "raisedRiskId", "reference", "reviewDate", "source", "type",
  ],
  "concerns": [
   "category", "classification", "evidence", "process", "reportedBy", "reviewDate",
   "reviewNotes", "reviewer", "routedRecordCode", "routedRecordId", "routedTo", "routingNotes",
   "site", "workUnit",
  ],
  "context": [
   "category", "domain", "domains", "impact", "linkedRiskId", "raisedAsRisk", "raisedRiskId",
   "type",
  ],
  "customer-satisfaction": [
   "category", "cats", "comment", "ftype", "method", "overall", "period", "priority",
   "routedRecordCode", "routedRecordId", "routedTo", "score", "source", "sourceCsatId",
  ],
  "design": [
   "attributes", "category", "changeNotes", "inputs", "kind", "options", "outputs", "owner",
   "project", "reviewNotes", "stage", "summary", "targetDate", "validationNotes",
   "verificationNotes", "version",
  ],
  "documents": [
   "access", "ackAudience", "ackRequired", "approvalNotes", "approvedBy", "approvedDate",
   "approver", "category", "changeSummary", "content", "distribution", "effectiveDate", "ext",
   "lineageId", "nextReview", "prevVersionId", "publishedBy", "publishedDate",
   "reasonForChange", "reviewComments", "reviewDecision", "reviewFreq", "submittedBy",
   "submittedDate", "supersededBy", "supersedes", "type", "version",
  ],
  "improvements": [
   "benefit", "category", "due", "priority", "sourceConcernCode", "sourceConcernId",
   "sourceCsatId", "suggestedAction", "type",
  ],
  "incidents": [
   "correctiveAction", "discoveredDate", "followups", "handler", "immediate", "incidentDate",
   "investigation", "rootCause", "severity", "sourceConcernCode", "sourceConcernId", "system",
   "type",
  ],
  "lab-scope": [
   "cmc", "discipline", "field", "method", "range", "standard",
  ],
  "nonconformities": [
   "cap", "capStatus", "category", "due", "linkedRiskId", "pic", "process", "raisedAsRisk",
   "raisedRiskId", "rootCause", "severity", "site", "sourceConcernCode", "sourceConcernId",
   "sourceCsatId", "workUnit",
  ],
  "objectives": [
   "actions", "actual", "actualManual", "baseline", "defaultBaseline", "defaultTarget", "dir",
   "due", "name", "owner", "period", "progress", "resources", "source", "state", "target",
   "targetDate", "theme", "type", "unit",
  ],
  "parties": [
   "category", "influence", "linkedObligations", "linkedRiskId", "needs", "party",
   "raisedAsRisk", "raisedRiskId",
  ],
  "pcb-persons": [
   "certNo", "certified", "expiry", "scheme",
  ],
  "performance": [
   "actual", "calc", "cat", "date", "dir", "indicators", "metric", "objId", "objTitle",
   "objectives", "period", "route", "source", "src", "summary", "target", "unit",
  ],
  "policies": [
   "additionalApprovals", "approvedBy", "approvedDate", "approver", "apxDef", "apxRef",
   "apxResp", "category", "commitments", "definitions", "editingFormat", "effectiveDate",
   "freeText", "lineageId", "nextReview", "prevVersionId", "publishedBy", "publishedDate",
   "purpose", "references", "relatedDocs", "relatedObjectives", "relatedObligations",
   "relatedRisks", "responsibilities", "reviewComments", "reviewFreq", "roles", "scope",
   "statement", "supersededBy", "supersedes", "version",
  ],
  "processes": [
   "category", "customers", "group", "inputs", "kpis", "name", "outputs", "owner", "resources",
   "risksCount", "sourceType", "steps", "suppliers", "type",
  ],
  "provision": [
   "approvedDate", "approver", "clause", "conditions", "controlPoints", "controls", "process",
   "processId", "processName", "productService", "revision", "route",
  ],
  "psr": [
   "appliesTo", "attachments", "attributes", "category", "currency", "customer", "docType",
   "kind", "linkedOffering", "name", "product", "provisionType", "requirement", "review",
   "reviewDate", "revision", "sku", "spec", "templateId", "templateName", "type", "value",
  ],
  "record-folders": [
   "order", "parentId",
  ],
  "records": [
   "category", "clauses", "effectiveDate", "file", "folder", "folderId", "issueDate", "issuer",
   "lastChecked", "link", "monitorNotes", "nextReview", "number", "obligations", "processes",
   "publishedDate", "publisher", "receivedDate", "reference", "reviewDate", "reviewFreq",
   "reviewStatus", "url", "version", "versionHistory", "workUnits",
  ],
  "reviews": [
   "agenda", "cancelReason", "chairperson", "date", "external", "finalizedBy", "finalizedDate",
   "format", "invited", "link", "location", "minutesSummary", "openActions", "openDecisions",
   "prep", "recorder", "scheduled", "time", "topics", "topicsCount", "tz", "version",
  ],
  "risks": [
   "assessedBy", "assessedDate", "band", "category", "domains", "impact", "issueCategory",
   "level", "likelihood", "methodology", "processId", "raisedBy", "raisedDate", "riskLevel",
   "riskScore", "source", "stepId", "treatment",
  ],
  "suppliers": [
   "bankAccount", "bankCode", "bankName", "categories", "category", "city", "contact",
   "contactName", "country", "criticality", "email", "entityName", "evaluations", "name",
   "payAdvance", "payAnchor", "payRetention", "phone", "qualifiedDate", "requalDate", "state",
   "taxNumber", "terms", "type", "website",
  ],
  "training": [
   "assessmentId", "assignmentId", "audience", "completedBy", "completionDate",
   "completionEvidence", "completionNotes", "completionResult", "delivery", "due",
   "effectiveStatus", "gapDescription", "gapId", "linkedReassessId", "memberId", "memberName",
   "outcome", "overdue", "priority", "provider", "reassessDue", "reassessRequired",
   "reassessResult", "reqId", "reqTitle", "roleId", "roleName", "source", "sourceRecordId",
   "type",
  ],
  "work-units": [
   "deps", "envs", "function", "headcount", "parentId", "processes", "site",
  ],
};

describe("declared fields", () => {
  it("gives every module the shared envelope", () => {
    for (const [module, schema] of Object.entries(IMPLEMENTATION_DATA_SCHEMAS)) {
      const shape = Object.keys((schema as unknown as { shape: object }).shape);
      expect(ENVELOPE.filter((f) => !shape.includes(f)), `${module} is missing envelope fields`).toEqual([]);
    }
  });

  for (const [module, fields] of Object.entries(MODULE_FIELDS)) {
    it(`${module}: declares exactly its documented fields`, () => {
      const schema = IMPLEMENTATION_DATA_SCHEMAS[module as keyof typeof IMPLEMENTATION_DATA_SCHEMAS]!;
      const shape = Object.keys((schema as unknown as { shape: object }).shape);
      expect(shape.filter((f) => !ENVELOPE.includes(f)).sort()).toEqual(fields);
    });
  }
});

describe("risks data schema", () => {
  const schema = IMPLEMENTATION_DATA_SCHEMAS.risks!;

  it("accepts the full design-observed shape", () => {
    const data = {
      category: "Quality Risks",
      source: "Business Process",
      processId: "BP-0021",
      stepId: "",
      issueCategory: "Process Risk",
      domains: [],
      description: "desc",
      raisedBy: "Jane",
      raisedDate: "2026-08-21T17:22:40.547Z",
      likelihood: 3,
      impact: 4,
      level: 12,
      activity: [],
      methodology: "basic",
      assessedBy: "Bob",
      assessedDate: "2026-08-25",
      treatment: "Mitigate",
      lastUpdatedBy: "Bob",
      band: "High",
      riskScore: 12,
      riskLevel: "High",
    };
    expect(schema.parse(data)).toEqual(data);
  });

  it("accepts null likelihood/impact/level (unassessed risk)", () => {
    expect(schema.parse({ likelihood: null, impact: null, level: null })).toEqual({
      likelihood: null,
      impact: null,
      level: null,
    });
  });

  it("rejects a non-numeric level", () => {
    expect(() => schema.parse({ level: "high" })).toThrow();
  });

  /**
   * `ImplementationModal` submits `""` — not `null`, not `0` — for a numeric
   * field the user cleared. A bare `z.number()` would 400 that save.
   */
  it("accepts a cleared numeric field as an empty string", () => {
    expect(schema.parse({ likelihood: "", impact: "" })).toEqual({ likelihood: "", impact: "" });
  });
});

/**
 * The high-traffic tenant registers, each against a payload shaped like the
 * one its own frontend workspace really posts (`fe-vibes-new`'s seeded
 * records and form handlers). These are the saves that would break loudest.
 */
describe("high-traffic register payloads", () => {
  it("policies: accepts a published structured policy", () => {
    const data = {
      category: "High-Level Policy", version: "1", approver: "Jennifer Susan Walters",
      reviewFreq: "Annually", editingFormat: "structured",
      effectiveDate: "2026-02-01T09:00:00.000Z", nextReview: "2027-02-01T09:00:00.000Z",
      statement: "We commit.", commitments: "…", scope: "…", roles: "…", responsibilities: "…",
      relatedDocs: ["DOC-0001"], relatedRisks: [],
      createdBy: "Scott", approvedBy: "Jennifer", approvedDate: "2026-02-01T09:00:00.000Z",
      publishedBy: "Jennifer", publishedDate: "2026-02-01T09:00:00.000Z",
    };
    expect(IMPLEMENTATION_DATA_SCHEMAS.policies!.parse(data)).toEqual(data);
  });

  it("documents: accepts an external document with its ext control block", () => {
    const data = {
      type: "External Document", category: "Information Security", version: "2022",
      approver: "Tenant Administrator", access: "Public within tenant", reviewFreq: "Annually",
      ackRequired: true, ackAudience: ["All Users"], changeSummary: "Registered external standard",
      content: "…",
      ext: {
        source: "ISO", publisher: "ISO / IEC", number: "ISO/IEC 27001:2022", revision: "2022",
        effDate: "2026-06-17T00:00:00.000Z", link: "", storage: "Compliance library",
        monitoringOwner: "Tenant Administrator", lastChecked: "2026-06-17T00:00:00.000Z",
        notes: "", status: "Active",
      },
    };
    expect(IMPLEMENTATION_DATA_SCHEMAS.documents!.parse(data)).toEqual(data);
  });

  it("records: accepts an external-document row including its back-compat keys", () => {
    const data = {
      folderId: "f1", folder: "Standards", category: "Standard", issuer: "ISO", number: "ISO 9001",
      version: "2015", effectiveDate: "2015-09-15", link: "https://iso.org", file: null,
      reviewFreq: "Annually", nextReview: "2027-01-01", clauses: ["4.1"], obligations: [],
      processes: [], workUnits: [], versionHistory: [], reference: "ISO 9001", url: "https://iso.org",
    };
    expect(IMPLEMENTATION_DATA_SCHEMAS.records!.parse(data)).toEqual(data);
  });

  it("training: accepts a completed plan with the server-decorated read fields", () => {
    const data = {
      source: "Competence Gap", gapId: "g1", memberId: "m1", memberName: "Peter",
      roleId: "r1", roleName: "Internal Auditor", type: "Internal Audit Training",
      delivery: "Classroom", provider: "In-house", due: "2026-09-01", priority: "High",
      reassessRequired: true, reassessDue: "2026-10-01", completionDate: "2026-08-30",
      completedBy: ["Peter"], completionResult: "Completed", overdue: false,
      effectiveStatus: "Completed",
    };
    expect(IMPLEMENTATION_DATA_SCHEMAS.training!.parse(data)).toEqual(data);
  });

  it("reviews: accepts a finalized management review", () => {
    const data = {
      date: "2026-06-01", time: "09:00", tz: "Asia/Jakarta", format: "Hybrid",
      link: "", location: "HQ", chairperson: "Jennifer", recorder: "Scott",
      invited: [], external: [], agenda: "…", prep: "…", topics: [],
      minutesSummary: "…", finalizedBy: "Jennifer", finalizedDate: "2026-06-02", version: 1,
    };
    expect(IMPLEMENTATION_DATA_SCHEMAS.reviews!.parse(data)).toEqual(data);
  });

  it("nonconformities: accepts a routed NC carrying its corrective-action plan", () => {
    const data = {
      category: "Process", process: "Procurement", description: "…", pic: "Peter",
      due: "2026-09-01", cap: { rootCause: "…", actions: [], effectiveness: "Not Checked" },
      capStatus: "Planned", sourceConcernId: "c1", sourceConcernCode: "CON-0001",
    };
    expect(IMPLEMENTATION_DATA_SCHEMAS.nonconformities!.parse(data)).toEqual(data);
  });

  it("awareness-campaigns: accepts the OD campaign hierarchy and its roll-ups", () => {
    const data = {
      programId: "AWP-0001", topics: ["t1", "t2"], focus: ["Quality"],
      audience: { type: "All Team Members", members: [], roles: [], workUnits: [] },
      message: "…", delivery: ["Email"], startDate: "2026-06-01", dueDate: "2026-06-30",
      ackRequired: true, evalRequired: false, evalMethod: [], acks: [], evals: [],
      followups: [], ackRate: 0.5, evalRate: null, launchedAt: "2026-06-01", launchedBy: "Scott",
    };
    expect(IMPLEMENTATION_DATA_SCHEMAS["awareness-campaigns"]!.parse(data)).toEqual(data);
  });

});
