import { describe, expect, it } from "vitest";
import { BUSINESS_DATA_SCHEMAS } from "./dataSchemas";

/**
 * One regression guard per module schema: an unrecognized key must 400 (schema
 * is `.strict()`), and a payload built only from the fields the schema itself
 * declares must parse clean. Either assertion fails the moment a future edit
 * drops `.strict()` or narrows/renames a field without updating this test.
 */
describe("business data schemas reject unknown keys", () => {
  for (const [module, schema] of Object.entries(BUSINESS_DATA_SCHEMAS)) {
    it(`${module}: rejects a typo'd field`, () => {
      expect(() => schema.parse({ notARealField: "typo" })).toThrow();
    });

    it(`${module}: accepts an empty payload (every field optional)`, () => {
      expect(schema.parse({})).toEqual({});
    });
  }
});

/**
 * Every field each schema declares, frozen. This is the test that fails if a
 * schema regresses: renaming, dropping or mistyping a field name here is a 400
 * on a payload the frontend really sends, and the diff says exactly which
 * module and which field. Each list's source is documented per schema in
 * `dataSchemas.ts` — the `parity/backend.md` field table for the module's
 * design collection, widened by what this port's own bespoke pages write.
 */
const MODULE_FIELDS: Record<string, string[]> = {
  "dn-backlog": [
   "kind", "priority", "projectId",
  ],
  "dn-clients": [
   "contact", "country", "industry", "name",
  ],
  "dn-engagements": [
   "clientId", "end", "name", "scope", "start", "testType", "value",
  ],
  "dn-findings": [
   "asset", "category", "cvss", "engagementId", "severity", "status",
  ],
  "dn-projects": [
   "clientId", "name", "progress", "stack", "start", "target", "type",
  ],
  "ent-banks": [
   "co", "country", "name", "swift", "type",
  ],
  "ent-comp": [
   "ageMax", "ageMin", "amount", "calc", "cap", "capPeriod", "categories", "city", "co",
   "country", "currency", "default", "frequency", "name", "rate", "region", "sector", "ssBase",
   "taxable", "type", "unit",
  ],
  "ent-ctype-profiles": [
   "co", "country", "expiryAlertDays", "localName", "maxRenewals", "maxTermMonths",
   "noticePeriodDays", "probationCapDays", "ssPrograms", "statutoryRef", "typeId",
  ],
  "ent-ctype-templates": [
   "co", "country", "items", "name", "typeId",
  ],
  "ent-ctypes": [
   "co", "conversionTarget", "countryProfiles", "defaultTerms", "domain", "hasEndDate",
   "leaveEligible", "name", "personnelType", "probationApplies", "renewable",
  ],
  "ent-clauses": [
   "body", "category", "co", "country", "domain", "scope", "title",
  ],
  "ent-db-courses": [
   "active", "audience", "category", "co", "cpdHours", "credential", "delivery", "disciplineId",
   "durationUnit", "durationVal", "elearnMedia", "elearnSupport", "format", "frameworkId",
   "language", "level", "maxPax", "objectives", "outline", "prereqIds", "prereqText", "price",
   "scheme", "summary",
  ],
  "ent-db-disciplines": [
   "co", "name", "order",
  ],
  "ent-fiscal": [
   "co", "end", "name", "start",
  ],
  "ent-holidays": [
   "co", "country", "date", "dayOff", "name", "type",
  ],
  "ent-inq": [
   "activity", "ar", "co", "contactEmail", "contactName", "contactPhone", "leadId", "leadName",
   "lifecycle", "notes", "service", "serviceName", "source", "sq", "variant",
  ],
  "ent-leads": [
   "activity", "city", "co", "company", "contact", "contacts", "country", "email", "industry",
   "legal", "locations", "phone", "processes", "source", "tenantId", "workUnits",
  ],
  "ent-leads-people": [
   "co", "coursesJoined", "email", "interest", "name", "notes", "org", "phone", "source",
  ],
  "ent-leave": [
   "activity", "co", "days", "end", "reason", "requester", "start", "type",
  ],
  "ent-minwage": [
   "ageMax", "ageMin", "amount", "city", "co", "country", "currency", "effective", "note",
   "region", "scope", "sector", "unit",
  ],
  "ent-payroll": [
   "activity", "co", "cutOff", "end", "frequency", "lines", "name", "payDate", "result",
   "rolled", "start",
  ],
  "ent-po": [
   "ack", "activity", "amount", "co", "confirmToken", "currency", "deliveryBy", "issuedDate",
   "payAdvance", "payAnchor", "payRetention", "prId", "sentAt", "sentCount", "supplierId",
   "supplierName", "terms", "voided", "voidedAt",
  ],
  "ent-po-terms": [
   "co", "order", "text",
  ],
  "ent-pr": [
   "activity", "category", "co", "currency", "department", "description", "duration", "estCost",
   "exRate", "intakeReview", "invoice", "kind", "method", "needBy", "origCurrency", "poId",
   "purpose", "qc", "qty", "quotes", "rateBasis", "receipt", "remarks", "requestType",
   "requester", "selectReason", "supplier", "supplierName", "unit", "unitValue",
  ],
  "ent-projects": [
   "activity", "client", "co", "contractId", "currency", "deliver", "endDate", "inqId",
   "leadId", "leadName", "proposalCode", "proposalId", "service", "serviceName", "startDate",
   "totalValue", "value", "variant",
  ],
  "ent-proposals": [
   "activity", "cert", "clauseIds", "co", "contractTypeId", "currency", "discount", "inqId",
   "items", "leadId", "leadName", "notes", "service", "serviceName", "taxPct", "termIds",
   "totals", "validUntil", "variant",
  ],
  "ent-recruitment": [
   "activity", "appliedDate", "co", "contract", "department", "description", "education",
   "email", "entity", "experience", "fullName", "headcount", "interviews", "link", "notes",
   "offer", "openedDate", "openingId", "personId", "phone", "rating", "roleName", "site",
   "source", "stage", "tests", "type", "visibility",
  ],
  "ent-ss": [
   "co", "country", "name", "programs", "ref",
  ],
  "ent-sup-ctypes": [
   "co", "conversionTarget", "countryProfiles", "defaultTerms", "domain", "hasEndDate",
   "leaveEligible", "name", "personnelType", "probationApplies", "renewable",
  ],
  "ent-svc-contracts": [
   "activity", "co", "currency", "endDate", "inqId", "leadId", "leadName", "notes", "propId",
   "service", "serviceName", "startDate", "value", "variant",
  ],
  "ent-svc-ctypes": [
   "co", "conversionTarget", "countryProfiles", "defaultTerms", "domain", "hasEndDate",
   "leaveEligible", "name", "personnelType", "probationApplies", "renewable",
  ],
  "ent-training-sessions": [
   "activity", "arrange", "capacity", "co", "courseCode", "courseId", "courseTitle", "currency",
   "end", "facilitator", "materials", "mode", "posts", "price", "priceBasis", "projectId",
   "roster", "start", "type",
  ],
  "ex-cab": [
   "certNo", "co", "companyId", "complexity", "cycleStart", "findings", "ims", "leadAuditor",
   "legalName", "name", "personnel", "ratePerMd", "scheme", "scope", "sector", "sites", "stage",
   "standards", "validFrom", "validTo", "workflow",
  ],
  "ex-groups": [
   "co", "description", "name", "order",
  ],
  "ex-sp-deps": [
   "category", "co", "description", "name",
  ],
  "ex-sp-envs": [
   "co", "description", "name",
  ],
  "ex-sp-ptypes": [
   "co", "description", "name",
  ],
  "mb-booking": [
   "customer", "days", "from", "nationality", "notes", "odometer", "phone", "pickup",
   "ratePerDay", "ret", "to", "total", "vehicle", "vehicleId",
  ],
  "mb-support": [
   "customer", "notes", "priority", "subject",
  ],
  "mb-vehicle": [
   "addedAt", "condition", "dailyRate", "location", "make", "model", "notes", "odometer",
   "plate", "type", "year",
  ],
};

describe("declared fields", () => {
  it("covers every registered module", () => {
    expect(Object.keys(BUSINESS_DATA_SCHEMAS).sort()).toEqual(Object.keys(MODULE_FIELDS).sort());
  });

  for (const [module, fields] of Object.entries(MODULE_FIELDS)) {
    it(`${module}: declares exactly its documented fields`, () => {
      const shape = Object.keys((BUSINESS_DATA_SCHEMAS[module] as unknown as { shape: object }).shape);
      expect(shape.sort()).toEqual([...fields].sort());
    });
  }
});

describe("ent-proposals data schema", () => {
  const schema = BUSINESS_DATA_SCHEMAS["ent-proposals"];

  it("accepts the server-computed totals/cert round-trip fields", () => {
    const data = {
      currency: "IDR",
      items: [{ description: "x", qty: 1, unitPrice: 100 }],
      discount: 0,
      taxPct: 11,
      totals: { sub: 100, discount: 0, tax: 11, total: 111 },
      cert: { standards: ["ISO 9001"], personnel: 5 },
      clauseIds: ["c1"],
    };
    expect(schema.parse(data)).toEqual(data);
  });
});

describe("ent-projects data schema", () => {
  const schema = BUSINESS_DATA_SCHEMAS["ent-projects"];

  it("accepts the smaller field set createProjectFromProposal actually writes", () => {
    const data = {
      proposalId: "p1",
      proposalCode: "PRO-4001",
      leadId: "LD-2001",
      leadName: "Acme",
      service: "impl",
      variant: "Full Consultancy",
      currency: "IDR",
      totalValue: 111,
    };
    expect(schema.parse(data)).toEqual(data);
  });
});

/**
 * Procurement is the sharpest case for payload validation: `ent-pr`/`ent-po`
 * already enforce a transition graph (`prLifecycle.ts`), so an unvalidated
 * payload under a validated state machine was the loudest inconsistency SOF-38
 * closes. These are the shapes `lib/procurement/*` really posts.
 */
describe("procurement payloads", () => {
  it("ent-pr: accepts a fulfilled request with its receipt/QC/invoice blocks", () => {
    const data = {
      category: "Electronics - Endpoint Devices", purpose: "Replace laptops",
      description: "Developer laptops", requester: "Matthew", department: "Operations",
      method: "Order", kind: "Product", requestType: "Purchase", needBy: "2026-08-15",
      unit: "unit", qty: 3, origCurrency: "USD", unitValue: 1450, exRate: 17991.28,
      currency: "IDR", estCost: 78262068, remarks: "", activity: [],
      supplier: "84-1", supplierName: "Stark Industries Supply", quotes: [],
      poId: "PO-2044", receipt: { date: "2026-08-10", qty: 3 }, qc: { result: "Accept" },
      invoice: { number: "INV-1", amount: 78262068 },
    };
    expect(BUSINESS_DATA_SCHEMAS["ent-pr"].parse(data)).toEqual(data);
  });

  it("ent-po: accepts an acknowledged purchase order", () => {
    const data = {
      prId: "PR-3001", supplierId: "84-1", supplierName: "Stark Industries Supply",
      amount: 21589536, currency: "IDR", terms: "30", payAnchor: "invoice",
      payAdvance: 0, payRetention: 0, deliveryBy: "2026-08-01",
      issuedDate: "2026-07-11T09:30:00", activity: [], confirmToken: "a0ws2e2044",
      sentAt: "2026-07-11T09:30:00", sentCount: 1, ack: { at: "2026-07-12", by: "supplier" },
    };
    expect(BUSINESS_DATA_SCHEMAS["ent-po"].parse(data)).toEqual(data);
  });
});

/**
 * OD stores several numeric-looking values as strings (`minWages.amount`,
 * `payComponents.rate`/`cap`). A bare `z.number()` would 400 the design's own
 * seeded shape.
 */
describe("OD string-numerics", () => {
  it("ent-minwage: accepts a string amount and age band", () => {
    const data = {
      country: "ID", scope: "Region", region: "DKI Jakarta", amount: "5396761",
      currency: "IDR", unit: "Month", effective: "2025-01-01", note: "UMP DKI Jakarta",
      ageMin: "21", ageMax: "",
    };
    expect(BUSINESS_DATA_SCHEMAS["ent-minwage"].parse(data)).toEqual(data);
  });

  it("ent-comp: accepts a percentage component with a string rate and cap", () => {
    const data = {
      name: "Wellness Allowance", type: "Allowance", calc: "pct", rate: "2",
      frequency: "Monthly", taxable: true, ssBase: false, country: "ID",
      cap: "2000000", capPeriod: "Year", categories: "Gym, Spa, Salon, Massage",
    };
    expect(BUSINESS_DATA_SCHEMAS["ent-comp"].parse(data)).toEqual(data);
  });
});

/**
 * `ent-ctypes`, `ent-svc-ctypes` and `ent-sup-ctypes` are OD's one
 * `contractTypes` collection split by `data.domain`, so they share a schema.
 * Give them separate entries and the three registers drift apart silently.
 */
it("shares one contract-type schema across the three domain-split keys", () => {
  expect(BUSINESS_DATA_SCHEMAS["ent-svc-ctypes"]).toBe(BUSINESS_DATA_SCHEMAS["ent-ctypes"]);
  expect(BUSINESS_DATA_SCHEMAS["ent-sup-ctypes"]).toBe(BUSINESS_DATA_SCHEMAS["ent-ctypes"]);
});

/**
 * `ent-recruitment` carries OD's `jobOpenings` and `candidates` in one module,
 * split by `data.entity` — `nextCode` special-cases the key for exactly that
 * reason, so both halves have to parse against the one schema.
 */
describe("ent-recruitment", () => {
  const schema = BUSINESS_DATA_SCHEMAS["ent-recruitment"];

  it("accepts a job opening", () => {
    const data = {
      entity: "opening", roleName: "Internal Auditor", department: "Quality",
      type: "Permanent", site: "AXIA HQ", headcount: 1, visibility: "Public",
      openedDate: "2026-06-02", link: "axia.io/careers/internal-auditor", description: "…",
    };
    expect(schema.parse(data)).toEqual(data);
  });

  it("accepts a candidate, including the nullable openingId/personId", () => {
    const data = {
      entity: "candidate", openingId: null, fullName: "Peter Benjamin Parker",
      email: "peter.parker@example.com", phone: "+62 811 2001", source: "Advert",
      stage: "Interview", appliedDate: "2026-06-03", rating: 4, education: [],
      experience: [], interviews: [], tests: [], offer: null, contract: null,
      notes: "", personId: null,
    };
    expect(schema.parse(data)).toEqual(data);
  });
});

describe("ex-cab data schema", () => {
  it("accepts a certified client with its ISO/IEC 17021-1 phase workflow", () => {
    const data = {
      name: "PT Sinar Kimia Nusantara", legalName: "PT Sinar Kimia Nusantara",
      sector: "IAF 12 · Chemicals", sites: 1, personnel: 140, standards: ["ISO 9001:2015"],
      ims: false, scope: "Manufacture and supply of industrial cleaning chemicals.",
      stage: "Certified", leadAuditor: "Rina Hartati", cycleStart: "2026-02-25",
      companyId: "exelera", findings: [], certNo: "EXL-1001-2026",
      validFrom: "2026-03-25", validTo: "2029-03-25", complexity: { risk: "High" },
      ratePerMd: 5000000, workflow: { initial: { plan: {}, decision: {} } },
    };
    expect(BUSINESS_DATA_SCHEMAS["ex-cab"].parse(data)).toEqual(data);
  });
});

describe("motoran data schemas", () => {
  it("mb-vehicle: accepts a fleet row", () => {
    const data = {
      plate: "DK 3182 AB", make: "Honda", model: "Vario 160", type: "Scooter",
      year: 2023, dailyRate: 80000, location: "Kuta", odometer: 12400,
      condition: "Good", addedAt: "2026-02-06T18:24:19.924Z",
    };
    expect(BUSINESS_DATA_SCHEMAS["mb-vehicle"].parse(data)).toEqual(data);
  });

  it("mb-booking: accepts OD's pickup/ret keys and the ported from/to pair", () => {
    const data = {
      customer: "Liam Anderson", phone: "+61 412 553 210", nationality: "Australia",
      vehicleId: "MB-0001", vehicle: "Honda Vario 160", from: "2026-08-22", to: "2026-08-29",
      pickup: "2026-08-22T18:24:19.924Z", ret: "2026-08-29T18:24:19.924Z",
      days: 7, ratePerDay: 80000, total: 560000, notes: "",
    };
    expect(BUSINESS_DATA_SCHEMAS["mb-booking"].parse(data)).toEqual(data);
  });
});
