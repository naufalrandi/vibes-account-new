import { z } from "zod";

/**
 * Per-module `data` payload schemas. SOF-23 landed the mechanism and the first
 * eleven keys; SOF-38 closes the rest so every registered business module
 * validates its JSONB payload instead of accepting any JSON object.
 *
 * Field names/types are lifted from the "Field-level gaps" tables in
 * `parity/backend.md` — one table per design `db.*` collection, each mapped to
 * its `BIZ_CODE_CONFIG` key — and widened where this port's own frontend
 * writes a field the design extraction never observed (the bespoke enterprise
 * pages under `fe-vibes-new/app/(app)/platform/`, `lib/procurement/*`,
 * `lib/exelera/cab.ts`).
 *
 * Every field is `.optional()` even where the parity table marks it
 * "required": `data` is fully replaced (not merged) on every write
 * (`business.service.ts` `updateBusiness`), and this backend's own
 * server-side writers don't always populate every design-observed field —
 * e.g. `ent-proposals`' `totals` is computed by `assertValidProposalData`
 * after this schema runs, and `ent-projects` records minted by
 * `createProjectFromProposal` carry a different, smaller field set
 * (`proposalId`/`proposalCode`/`totalValue`) than a design-seeded project.
 * Enforcing "required" here would 400 legitimate saves this backend already
 * produces.
 *
 * What IS enforced, on every field that's present: its type, and — via
 * `.strict()` — that no unrecognized key sneaks into the JSONB blob. A typo
 * in a frontend field name still surfaces as a 400.
 */

const unknownArray = z.array(z.unknown());
const unknownObject = z.record(z.string(), z.unknown());
const str = z.string().optional();
const bool = z.boolean().optional();
const strArray = z.array(z.string()).optional();
const arr = unknownArray.optional();
const obj = unknownObject.optional();
const nullableObj = unknownObject.nullable().optional();
/**
 * OD stores several numeric-looking fields as strings (`minWages.amount`,
 * `payComponents.rate`/`cap`, `doaMatrix.max`) and the generic business
 * register submits `""` for a cleared number input, so numeric fields accept
 * both rather than 400ing a payload the product already writes.
 */
const numeric = z.union([z.number(), z.string(), z.null()]).optional();
/** Operating-company scope tag carried in `data.co` on the enterprise modules. */
const co = z.string().optional();

const dnBacklogDataSchema = z
  .object({
    projectId: z.string().optional(),
    kind: z.string().optional(),
    priority: z.string().optional(),
  })
  .strict();

const dnClientsDataSchema = z
  .object({
    name: z.string().optional(),
    industry: z.string().optional(),
    country: z.string().optional(),
    contact: z.string().optional(),
  })
  .strict();

const dnEngagementsDataSchema = z
  .object({
    clientId: z.string().optional(),
    name: z.string().optional(),
    testType: z.string().optional(),
    scope: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    value: z.number().optional(),
  })
  .strict();

const dnFindingsDataSchema = z
  .object({
    engagementId: z.string().optional(),
    severity: z.string().optional(),
    // OD mirrors the finding's workflow state into `data` alongside the row's
    // own `status` column; both are written on every save.
    status: z.string().optional(),
    cvss: z.number().optional(),
    category: z.string().optional(),
    asset: z.string().optional(),
  })
  .strict();

const dnProjectsDataSchema = z
  .object({
    clientId: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    stack: z.string().optional(),
    progress: z.number().optional(),
    start: z.string().optional(),
    target: z.string().optional(),
  })
  .strict();

const entInqDataSchema = z
  .object({
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    service: z.string().optional(),
    serviceName: z.string().optional(),
    variant: z.string().optional(),
    sq: unknownObject.optional(),
    notes: z.string().optional(),
    activity: unknownArray.optional(),
    lifecycle: z.string().optional(),
    source: z.string().optional(),
    co: z.string().optional(),
    ar: unknownObject.optional(),
    contactName: z.string().optional(),
    contactEmail: z.string().optional(),
    contactPhone: z.string().optional(),
  })
  .strict();

const entLeadsDataSchema = z
  .object({
    contact: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    source: z.string().optional(),
    industry: z.string().optional(),
    activity: unknownArray.optional(),
    country: z.string().optional(),
    city: z.string().optional(),
    contacts: unknownArray.optional(),
    locations: unknownArray.optional(),
    processes: unknownArray.optional(),
    workUnits: unknownArray.optional(),
    co: z.string().optional(),
    legal: unknownObject.optional(),
    // `leadIdentityOf` (business.service.ts) falls back to `data.company` as
    // the legal-name source for leads predating the `legal.legalName` field.
    company: z.string().optional(),
    // `assertDeletable`'s B-2 guard (business.service.ts) refuses to delete a
    // lead stamped with a tenant workspace id — missing here, this field
    // never survives `parseInput`'s schema pass and the guard can never fire.
    // Nullable: `leadData()` (fe-vibes-new/lib/sales/leads.ts) defaults an
    // absent tenantId to `null`, not `undefined` — `.optional()` alone
    // rejects that and 400s every manual lead/inquiry create.
    tenantId: z.string().nullable().optional(),
    // `leadData()` (fe-vibes-new/lib/sales/leads.ts) always stamps this field
    // on create; the backend never reads it, but `.strict()` 400s on any
    // unrecognized key so it must be declared to accept the payload.
    registeredBy: z.string().optional(),
  })
  .strict();

const entLeadsPeopleDataSchema = z
  .object({
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    org: z.string().optional(),
    interest: z.string().optional(),
    source: z.string().optional(),
    notes: z.string().optional(),
    coursesJoined: z.number().optional(),
    co: z.string().optional(),
  })
  .strict();

const entProjectsDataSchema = z
  .object({
    contractId: z.string().optional(),
    inqId: z.string().optional(),
    leadId: z.string().optional(),
    client: z.string().optional(),
    service: z.string().optional(),
    serviceName: z.string().optional(),
    variant: z.string().optional(),
    currency: z.string().optional(),
    value: z.number().optional(),
    deliver: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    activity: unknownArray.optional(),
    co: z.string().optional(),
    // Stamped by `createProjectFromProposal` when a project is minted from
    // an accepted proposal, in place of the design-seeded field set above.
    proposalId: z.string().optional(),
    proposalCode: z.string().optional(),
    leadName: z.string().optional(),
    totalValue: z.number().optional(),
    // Stamped by EnterpriseServiceContractsPage's `createProject`. OD's
    // `projectConvert` (js/modules.js:2669) has no counterpart for these — they are
    // this port's own delivery-tracking additions, but the payload 400'd without them.
    contractCode: z.string().optional(),
    targetCompletionDate: z.string().optional(),
    progress: z.number().optional(),
    milestones: unknownArray.optional(),
  })
  .strict();

const entProposalsDataSchema = z
  .object({
    inqId: z.string().optional(),
    leadId: z.string().optional(),
    leadName: z.string().optional(),
    service: z.string().optional(),
    serviceName: z.string().optional(),
    variant: z.string().optional(),
    currency: z.string().optional(),
    items: unknownArray.optional(),
    discount: z.number().optional(),
    taxPct: z.number().optional(),
    validUntil: z.string().optional(),
    notes: z.string().optional(),
    activity: unknownArray.optional(),
    // `.nullish()`: EnterpriseProposalsPage.tsx clears the field by posting null.
    contractTypeId: z.string().nullish(),
    termIds: unknownArray.optional(),
    co: z.string().optional(),
    // Posted by EnterpriseProposalsPage.tsx:215-233. `projectId` is additionally
    // written server-side by createProjectFromProposal (business.service.ts:596),
    // so without it here the server stamped a key the next client save could not
    // round-trip through this `.strict()` object.
    serviceId: z.string().nullish(),
    contractTypeTitle: z.string().nullish(),
    totalValue: z.number().nullish(),
    sentAt: z.string().nullish(),
    decidedAt: z.string().nullish(),
    projectId: z.string().nullish(),
    terms: unknownArray.optional(),
    // Server-computed by `assertValidProposalData` (proposalRules.ts) after
    // this schema runs — round-tripped back on the next save.
    totals: unknownObject.optional(),
    // Certification auto-pricing input (`assertValidCertInput`,
    // proposalRules.ts) — a real accepted field with no seeded design record.
    cert: unknownObject.optional(),
    clauseIds: unknownArray.optional(),
  })
  .strict();

const entTrainingSessionsDataSchema = z
  .object({
    co: z.string().optional(),
    courseId: z.string().optional(),
    courseCode: z.string().optional(),
    courseTitle: z.string().optional(),
    type: z.string().optional(),
    projectId: z.unknown().nullable().optional(),
    mode: z.string().optional(),
    capacity: z.number().nullable().optional(),
    facilitator: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    currency: z.string().optional(),
    price: z.number().optional(),
    priceBasis: z.string().optional(),
    activity: unknownArray.optional(),
    roster: unknownArray.optional(),
    arrange: unknownObject.optional(),
    materials: unknownArray.optional(),
    posts: unknownArray.optional(),
  })
  .strict();

// --- Enterprise: HR reference data (`contractTypes` family, SOF-38) ----------

/**
 * `contractTypes` (`parity/backend.md`). One shape, three register keys: OD
 * splits the same collection by `data.domain` — Employment (`ent-ctypes`),
 * Service (`ent-svc-ctypes`) and Supplier (`ent-sup-ctypes`) — so the three
 * keys share this schema rather than duplicating it.
 */
const contractTypesDataSchema = z
  .object({
    name: str,
    personnelType: str,
    hasEndDate: bool,
    probationApplies: bool,
    renewable: bool,
    leaveEligible: bool,
    conversionTarget: str,
    domain: str,
    defaultTerms: arr,
    // Per-country statutory profiles, joined onto the type by the ported
    // Contract Types page (`contract-types/ContractTypesPage.tsx`).
    countryProfiles: arr,
    co,
  })
  .strict();

/** `contractTypeProfiles` (`parity/backend.md`). */
const entCtypeProfilesDataSchema = z
  .object({
    typeId: str,
    country: str,
    localName: str,
    maxTermMonths: numeric,
    maxRenewals: numeric,
    probationCapDays: numeric,
    noticePeriodDays: numeric,
    expiryAlertDays: numeric,
    statutoryRef: str,
    ssPrograms: arr,
    co,
  })
  .strict();

/** `contractTemplates` (`parity/backend.md`) — a clause snapshot list per type. */
const entCtypeTemplatesDataSchema = z
  .object({ typeId: str, country: str, name: str, items: arr, co })
  .strict();

/**
 * `clauses` (`parity/backend.md`) — the reusable clause library `contractTemplates`/
 * `contractDocs` snapshot from. Was wrongly aliased to `FrameworkRequirement`
 * (a framework/audit clause, unrelated concept); this is its own module (SOF-58).
 */
const entClausesDataSchema = z
  .object({ title: str, category: str, country: str, scope: str, body: str, domain: str, co })
  .strict();

/** `banks` (`parity/backend.md`). */
const entBanksDataSchema = z.object({ country: str, name: str, swift: str, type: str, co }).strict();

/** `holidays` (`parity/backend.md`); see also `business-days/holidaySeed.ts`. */
const entHolidaysDataSchema = z
  .object({ country: str, date: str, name: str, type: str, dayOff: bool, co })
  .strict();

/** `fiscalPeriods` (`parity/backend.md`). */
const entFiscalDataSchema = z.object({ name: str, start: str, end: str, co }).strict();

/** `leaveRequests` (`parity/backend.md`). */
const entLeaveDataSchema = z
  .object({
    requester: str,
    type: str,
    start: str,
    end: str,
    days: numeric,
    reason: str,
    activity: arr,
    co,
  })
  .strict();

/** `minWages` (`parity/backend.md`). `amount`/`ageMin`/`ageMax` are strings in OD. */
const entMinwageDataSchema = z
  .object({
    country: str,
    scope: str,
    region: str,
    city: str,
    amount: numeric,
    currency: str,
    unit: str,
    effective: str,
    note: str,
    ageMin: numeric,
    ageMax: numeric,
    sector: str,
    co,
  })
  .strict();

/** `payComponents` (`parity/backend.md`) + `EnterpriseCompensationPage.tsx`. */
const entCompDataSchema = z
  .object({
    name: str,
    type: str,
    calc: str,
    rate: numeric,
    frequency: str,
    taxable: bool,
    ssBase: bool,
    country: str,
    region: str,
    city: str,
    sector: str,
    currency: str,
    unit: str,
    amount: numeric,
    ageMin: numeric,
    ageMax: numeric,
    default: bool,
    cap: numeric,
    capPeriod: str,
    categories: str,
    co,
  })
  .strict();

/** `payrollCycles` (`parity/backend.md`) + the run output `EnterprisePayrollPage` stores. */
const entPayrollDataSchema = z
  .object({
    name: str,
    frequency: str,
    start: str,
    end: str,
    cutOff: str,
    payDate: str,
    // Written by the payroll run itself, not the cycle form.
    lines: arr,
    result: obj,
    rolled: bool,
    activity: arr,
    co,
  })
  .strict();

/** `ssSchemes` (`parity/backend.md`). */
const entSsDataSchema = z.object({ country: str, name: str, ref: str, programs: arr, co }).strict();

/** `courseDisciplines` (`parity/backend.md`). */
const entDbDisciplinesDataSchema = z.object({ name: str, order: numeric, co }).strict();

/** `courses` (`parity/backend.md`). */
const entDbCoursesDataSchema = z
  .object({
    // OD `courseCatSeedIfNeeded` (js/modules.js:1877-1882) mints a meaningful
    // 4-digit code per level band (7001 foundation, 71xx awareness, 72xx/73xx/74xx
    // requirements/implementation/audit) and the catalog's "Cat #" column renders it.
    code: str,
    category: str,
    level: numeric,
    summary: str,
    active: bool,
    maxPax: numeric,
    durationVal: numeric,
    durationUnit: str,
    cpdHours: numeric,
    delivery: arr,
    credential: str,
    language: str,
    price: obj,
    objectives: arr,
    outline: arr,
    audience: str,
    prereqText: str,
    prereqIds: arr,
    format: arr,
    elearnMedia: arr,
    elearnSupport: arr,
    disciplineId: str,
    frameworkId: str,
    // Posted by CourseEditModal.tsx:164-186 and read by the catalog's
    // "Discipline / Standard" column (courseCatalogConstants.ts:213), which is
    // OD `courseScopeLabel` -> `courseStdName(c.frameworkId)` (js/modules.js:1863).
    standard: str,
    materialsFee: numeric,
    examFee: numeric,
    currency: str,
    fxRate: numeric,
    scheme: str,
    co,
  })
  .strict();

/**
 * `jobOpenings` ∪ `candidates` (`parity/backend.md`). OD carries both
 * collections in one module split by `data.entity` — `nextCode` already
 * special-cases the key for exactly that reason (`business.service.ts`), so
 * one union schema matches how the module is actually addressed.
 */
const entRecruitmentDataSchema = z
  .object({
    entity: str,
    // Opening side.
    roleName: str,
    department: str,
    type: str,
    site: str,
    headcount: numeric,
    visibility: str,
    openedDate: str,
    link: str,
    description: str,
    // Candidate side.
    openingId: z.string().nullable().optional(),
    fullName: str,
    email: str,
    phone: str,
    source: str,
    stage: str,
    appliedDate: str,
    rating: numeric,
    education: arr,
    experience: arr,
    interviews: arr,
    tests: arr,
    offer: nullableObj,
    contract: nullableObj,
    notes: str,
    personId: z.string().nullable().optional(),
    activity: arr,
    co,
  })
  .strict();

// --- Enterprise: procurement (SOF-38) ----------------------------------------

/** `purchaseRequests` (`parity/backend.md`) + `lib/procurement/purchaseRequests.ts`. */
const entPrDataSchema = z
  .object({
    category: str,
    purpose: str,
    description: str,
    requester: str,
    department: str,
    method: str,
    kind: str,
    requestType: str,
    needBy: str,
    unit: str,
    qty: numeric,
    rateBasis: str,
    duration: numeric,
    origCurrency: str,
    unitValue: numeric,
    exRate: numeric,
    currency: str,
    estCost: numeric,
    remarks: str,
    activity: arr,
    supplier: str,
    supplierName: str,
    quotes: arr,
    selectReason: str,
    sourceNote: str,
    intakeReview: nullableObj,
    poId: str,
    receipt: nullableObj,
    qc: nullableObj,
    // R495 — a Rental's handover inspection is its own record, and the return
    // stamps whether it closed with a damage charge.
    handoverQc: nullableObj,
    qcDamageCharge: z.boolean().optional(),
    invoice: nullableObj,
    co,
  })
  .strict();

/** `purchaseOrders` (`parity/backend.md`) + `lib/procurement/purchaseOrders.ts`. */
const entPoDataSchema = z
  .object({
    prId: str,
    supplierId: str,
    supplierName: str,
    amount: numeric,
    currency: str,
    terms: str,
    payAnchor: str,
    payAdvance: numeric,
    payRetention: numeric,
    deliveryBy: str,
    issuedDate: str,
    activity: arr,
    confirmToken: str,
    sentAt: str,
    sentCount: numeric,
    ack: nullableObj,
    voided: bool,
    voidedAt: str,
    co,
  })
  .strict();

/** `poTermsStd` (`parity/backend.md`) — one standard PO term per row. */
const entPoTermsDataSchema = z.object({ text: str, order: numeric, co }).strict();

/**
 * R496 — the Delegation of Authority matrix (`ent-doa`). One module holds two
 * record shapes: an approval BAND (`max`/`currency`/`approver`/`finance`/
 * `quotes`, with the approver kind carried in `status`) and a per-category
 * sourcing METHOD (`kind: "method"`, with Order/Direct in `status`). The FE
 * has posted to this key all along with no registered schema — see
 * `EnterpriseProcurementPolicyPage`.
 */
const entDoaDataSchema = z
  .object({
    kind: str,
    type: str,
    max: numeric,
    currency: str,
    approver: str,
    finance: bool,
    quotes: bool,
    method: str,
    co,
  })
  .strict();

/**
 * R822 / R173 — the Website CMS's five `ent-mkt-*` collections. The FE posts
 * to them (`app/(app)/platform/website-cms/cms-shared.tsx`) but they had no
 * registered schema, so every CMS write fell through unvalidated and the
 * module-key drift gate could not see them. Field sets are the ones each tab
 * actually writes; OD's own `db.cms*` arrays are the source (app.html:6789+).
 */
const entMktPagesDataSchema = z
  .object({ slug: str, path: str, template: str, body: str, seoTitle: str, seoDesc: str, author: str, co })
  .strict();
const entMktPostsDataSchema = z
  .object({ slug: str, category: str, publishDate: str, tags: arr, excerpt: str, body: str, author: str, co })
  .strict();
const entMktMediaDataSchema = z
  .object({ type: str, size: numeric, alt: str, uploadedBy: str, co })
  .strict();
const entMktMenuDataSchema = z
  .object({ target: str, url: str, order: numeric, co })
  .strict();
const entMktSettingsDataSchema = z
  .object({
    siteName: str, domain: str, tagline: str, primary: str,
    analytics: str, seoTitle: str, seoDesc: str, live: bool, co,
  })
  .strict();

/** `serviceContracts` (`parity/backend.md`). */
const entSvcContractsDataSchema = z
  .object({
    inqId: str,
    propId: str,
    leadId: str,
    leadName: str,
    service: str,
    serviceName: str,
    variant: str,
    currency: str,
    value: numeric,
    startDate: str,
    endDate: str,
    notes: str,
    activity: arr,
    co,
    /** OD `contractIssue` (js/modules.js:2657) copies the accepted proposal's
     *  `contractTypeId` and its `termIds` onto the contract. Both were missing here,
     *  so an issued contract could never carry the contract type or its clauses. */
    contractTypeId: str,
    /** OD stores clause ids (`(p.termIds||[]).slice()`); this port currently sends the
     *  proposal's prose payment-milestone string. Accepts both pending a decision on
     *  which representation is canonical — see the `propDefaultTerms` question. */
    terms: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .strict();

// --- Exelera (certification body) --------------------------------------------

/**
 * `excClients` (`parity/backend.md`) plus the ISO/IEC 17021-1 phase workflow
 * the ported CAB page keeps under `data.workflow`
 * (`fe-vibes-new/lib/exelera/cab.ts` `CabClientData`).
 */
const exCabDataSchema = z
  .object({
    name: str,
    legalName: str,
    sector: str,
    sites: numeric,
    personnel: numeric,
    standards: strArray,
    ims: bool,
    scope: str,
    stage: str,
    scheme: str,
    leadAuditor: str,
    cycleStart: str,
    companyId: str,
    findings: arr,
    certNo: str,
    validFrom: str,
    validTo: str,
    complexity: obj,
    ratePerMd: numeric,
    workflow: obj,
    co,
  })
  .strict();

/** `groups` (`parity/backend.md`) — the framework/regulation grouping list. */
const exGroupsDataSchema = z.object({ name: str, description: str, order: numeric, co }).strict();

/** `spDeps` (`parity/backend.md`). */
const exSpDepsDataSchema = z.object({ name: str, category: str, description: str, co }).strict();

/** `spEnvs` (`parity/backend.md`). */
const exSpEnvsDataSchema = z.object({ name: str, description: str, co }).strict();

/** `spPtypes` (`parity/backend.md`). */
const exSpPtypesDataSchema = z.object({ name: str, description: str, co }).strict();

// --- Motoran (vehicle rental) -------------------------------------------------

/** `mbVehicles` (`parity/backend.md`). */
const mbVehicleDataSchema = z
  .object({
    plate: str,
    make: str,
    model: str,
    type: str,
    year: numeric,
    dailyRate: numeric,
    location: str,
    odometer: numeric,
    condition: str,
    addedAt: str,
    notes: str,
  })
  .strict();

/** `mbBookings` (`parity/backend.md`). */
const mbBookingDataSchema = z
  .object({
    customer: str,
    phone: str,
    nationality: str,
    vehicleId: str,
    // Denormalized vehicle label; `from`/`to` are the pre-parity date keys the
    // seeded rows still carry alongside OD's `pickup`/`ret`.
    vehicle: str,
    from: str,
    to: str,
    pickup: str,
    ret: str,
    days: numeric,
    ratePerDay: numeric,
    total: numeric,
    odometer: numeric,
    notes: str,
  })
  .strict();

/** `mbTickets` (`parity/backend.md`). */
const mbSupportDataSchema = z
  .object({ customer: str, subject: str, priority: str, notes: str })
  .strict();

export const BUSINESS_DATA_SCHEMAS: Record<string, z.ZodTypeAny> = {
  "dn-backlog": dnBacklogDataSchema,
  "dn-clients": dnClientsDataSchema,
  "dn-engagements": dnEngagementsDataSchema,
  "dn-findings": dnFindingsDataSchema,
  "dn-projects": dnProjectsDataSchema,
  "ent-inq": entInqDataSchema,
  "ent-leads": entLeadsDataSchema,
  "ent-leads-people": entLeadsPeopleDataSchema,
  "ent-projects": entProjectsDataSchema,
  "ent-proposals": entProposalsDataSchema,
  "ent-training-sessions": entTrainingSessionsDataSchema,
  "ent-banks": entBanksDataSchema,
  "ent-comp": entCompDataSchema,
  "ent-ctype-profiles": entCtypeProfilesDataSchema,
  "ent-ctype-templates": entCtypeTemplatesDataSchema,
  "ent-ctypes": contractTypesDataSchema,
  "ent-clauses": entClausesDataSchema,
  "ent-db-courses": entDbCoursesDataSchema,
  "ent-db-disciplines": entDbDisciplinesDataSchema,
  "ent-fiscal": entFiscalDataSchema,
  "ent-holidays": entHolidaysDataSchema,
  "ent-leave": entLeaveDataSchema,
  "ent-minwage": entMinwageDataSchema,
  "ent-payroll": entPayrollDataSchema,
  "ent-po": entPoDataSchema,
  "ent-doa": entDoaDataSchema,
  "ent-mkt-media": entMktMediaDataSchema,
  "ent-mkt-menu": entMktMenuDataSchema,
  "ent-mkt-pages": entMktPagesDataSchema,
  "ent-mkt-posts": entMktPostsDataSchema,
  "ent-mkt-settings": entMktSettingsDataSchema,
  "ent-po-terms": entPoTermsDataSchema,
  "ent-pr": entPrDataSchema,
  "ent-recruitment": entRecruitmentDataSchema,
  "ent-ss": entSsDataSchema,
  "ent-sup-ctypes": contractTypesDataSchema,
  "ent-svc-contracts": entSvcContractsDataSchema,
  "ent-svc-ctypes": contractTypesDataSchema,
  "ex-cab": exCabDataSchema,
  "ex-groups": exGroupsDataSchema,
  "ex-sp-deps": exSpDepsDataSchema,
  "ex-sp-envs": exSpEnvsDataSchema,
  "ex-sp-ptypes": exSpPtypesDataSchema,
  "mb-booking": mbBookingDataSchema,
  "mb-support": mbSupportDataSchema,
  "mb-vehicle": mbVehicleDataSchema,
};

export function getBusinessDataSchema(module: string): z.ZodTypeAny | undefined {
  return BUSINESS_DATA_SCHEMAS[module];
}
