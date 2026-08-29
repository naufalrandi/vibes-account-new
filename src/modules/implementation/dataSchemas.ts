import { z } from "zod";
import type { MsModuleKey } from "./registry";

/**
 * Per-module `data` payload schemas. SOF-23 landed the mechanism (applied in
 * `parseInput` when the module key has a registered schema) plus the first five
 * keys; SOF-38 closes the remaining coverage so every `MS_MODULES` key
 * validates its JSONB payload instead of accepting any JSON object.
 *
 * **Where the field contracts come from.** For the five design-seeded registers
 * (`processes`, `objectives`, `performance`, `risks`, `suppliers`) it is the
 * "Field-level gaps" tables in `parity/backend.md`. For every other key the
 * extractor observed no design records, so the contract is the union of:
 *
 * 1. `fe-vibes-new/lib/implementation/config.ts` — the generic register's
 *    per-module field list, which `ImplementationModal.tsx` writes verbatim
 *    into `data` (plus the `data.*` columns/filters it reads back).
 * 2. The typed views the frontend keeps over `data` for the bespoke workspaces:
 *    `PolicyData`, `DocumentData`, `ExtDocData`, `TrainingData`,
 *    `AwarenessCampaignData`, `psr/types.ts`.
 * 3. Fields this backend itself stamps (`policyControl`, `documentControl`,
 *    `reviewLifecycle`, `trainingLifecycle`, `awarenessControl`, `psrControl`).
 *
 * **Every field is `.optional()`** even where the source marks it required:
 * `data` is fully replaced (not merged) on every write
 * (`implementation.service.ts` `updateRecord`), and this backend's own writers
 * don't always populate every field — e.g. `risks`' `band`/`riskScore`/
 * `riskLevel` are added by `enrichData` after this schema runs, so a
 * fetch→edit→save round-trip must accept them back. Enforcing "required" here
 * would 400 legitimate partial saves the product already produces. It also
 * keeps rows written before a schema landed readable and re-savable — the
 * schema runs on write only, never on GET.
 *
 * What IS enforced, on every field that's present: its type, and — via
 * `.strict()` — that no unrecognized key sneaks into the JSONB blob. A typo in
 * a frontend field name surfaces as a 400 rather than silently persisting.
 *
 * **Numbers.** `ImplementationModal` sends `""` for a cleared numeric field
 * (`payload[f.key] = raw === "" ? "" : Number(raw)`), so every field the
 * generic register renders as `type: "number"` uses `numeric` below rather
 * than a bare `z.number()`.
 */

const str = z.string().optional();
const bool = z.boolean().optional();
const strArray = z.array(z.string()).optional();
const unknownArray = z.array(z.unknown()).optional();
const unknownObject = z.record(z.string(), z.unknown()).optional();
const nullableObject = z.record(z.string(), z.unknown()).nullable().optional();
/** A number the generic register may also submit as `""` (cleared input). */
const numeric = z.union([z.number(), z.literal(""), z.null()]).optional();

/**
 * Keys any generic register can carry regardless of module: the two
 * justification notes `ImplementationModal` writes on a Dismissed/Archived
 * save, the activity/comment trails the workspaces round-trip, and the
 * authorship stamps.
 */
const envelope = {
  createdBy: str,
  createdDate: str,
  lastUpdatedBy: str,
  postedBy: str,
  postDate: str,
  notes: str,
  note: str,
  description: str,
  remarks: str,
  activity: unknownArray,
  comments: unknownArray,
  dismissJustification: str,
  archiveJustification: str,
  holdJustification: str,
  /**
   * The generic dismiss/archive justification (`implementation.service.ts`
   * `resolveJustification`): clients may send the untyped `justification`, and
   * the service answers by stamping the typed key plus its actor/timestamp.
   * All five have to round-trip or the next save 400s.
   */
  justification: str,
  archivedBy: str,
  archivedAt: str,
  dismissedBy: str,
  dismissedAt: str,
  /** `ExternalDoc*Modal` piggybacks a one-off activity line on the save. */
  _activityNote: str,
};

// --- Context & planning (clause 4–6) -----------------------------------------

const contextDataSchema = z
  .object({
    ...envelope,
    domain: str,
    domains: strArray,
    type: str,
    category: str,
    impact: str,
    linkedRiskId: str,
    raisedRiskId: str,
    raisedAsRisk: bool,
  })
  .strict();

const partiesDataSchema = z
  .object({
    ...envelope,
    category: str,
    needs: str,
    influence: str,
    party: str,
    linkedObligations: strArray,
    linkedRiskId: str,
    raisedRiskId: str,
    raisedAsRisk: bool,
  })
  .strict();

const processesDataSchema = z
  .object({
    ...envelope,
    name: str,
    group: str,
    category: str,
    type: str,
    sourceType: str,
    owner: str,
    inputs: z.union([z.string(), z.array(z.unknown())]).optional(),
    outputs: z.union([z.string(), z.array(z.unknown())]).optional(),
    suppliers: z.union([z.string(), z.array(z.unknown())]).optional(),
    customers: z.union([z.string(), z.array(z.unknown())]).optional(),
    resources: z.union([z.string(), z.array(z.unknown())]).optional(),
    kpis: unknownArray,
    steps: unknownArray,
    risksCount: numeric,
  })
  .strict();

const risksDataSchema = z
  .object({
    ...envelope,
    category: str,
    source: str,
    processId: str,
    stepId: str,
    issueCategory: str,
    domains: unknownArray,
    raisedBy: str,
    raisedDate: str,
    likelihood: numeric,
    impact: numeric,
    level: numeric,
    methodology: str,
    assessedBy: str,
    assessedDate: str,
    treatment: str,
    // Added by `enrichData` (registry.ts) after this schema runs — never
    // client-authored, but round-tripped back on the next save.
    band: str,
    riskScore: numeric,
    riskLevel: str,
  })
  .strict();

const objectivesDataSchema = z
  .object({
    ...envelope,
    name: str,
    state: str,
    type: str,
    theme: str,
    baseline: numeric,
    defaultBaseline: numeric,
    defaultTarget: numeric,
    target: z.union([z.number(), z.string(), z.null()]).optional(),
    actual: z.union([z.number(), z.string(), z.null()]).optional(),
    actualManual: numeric,
    progress: numeric,
    unit: str,
    dir: str,
    actions: str,
    resources: str,
    period: str,
    due: str,
    targetDate: str,
    owner: str,
    source: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  })
  .strict();

const complianceDataSchema = z
  .object({
    ...envelope,
    type: str,
    category: str,
    priority: str,
    framework: str,
    reference: str,
    source: str,
    obligation: str,
    dueDate: str,
    reviewDate: str,
    linkedRiskId: str,
    raisedRiskId: str,
    raisedAsRisk: bool,
  })
  .strict();

// --- Governance & documented information -------------------------------------

const policiesDataSchema = z
  .object({
    ...envelope,
    category: str,
    version: str,
    approver: str,
    additionalApprovals: strArray,
    reviewFreq: str,
    effectiveDate: str,
    // Derived by `policyControl.ts` from effectiveDate + reviewFreq.
    nextReview: str,
    editingFormat: str,
    // Structured template fields (OD `polFmtAreaHtml`).
    purpose: str,
    scope: str,
    references: str,
    definitions: str,
    responsibilities: str,
    statement: str,
    commitments: str,
    roles: str,
    apxResp: str,
    apxDef: str,
    apxRef: str,
    // Free-text mode.
    freeText: str,
    relatedDocs: strArray,
    relatedObjectives: strArray,
    relatedRisks: strArray,
    relatedObligations: strArray,
    approvedBy: str,
    approvedDate: str,
    publishedBy: str,
    publishedDate: str,
    lineageId: str,
    prevVersionId: str,
    supersedes: str,
    supersededBy: str,
    reviewComments: str,
  })
  .strict();

/** OD's external-document control block on a `documents` row (`x.ext`). */
const documentExtSchema = z
  .object({
    source: str,
    publisher: str,
    number: str,
    revision: str,
    effDate: str,
    link: str,
    storage: str,
    monitoringOwner: str,
    lastChecked: str,
    notes: str,
    status: str,
  })
  .strict();

const documentsDataSchema = z
  .object({
    ...envelope,
    type: str,
    category: str,
    version: str,
    // OD `cdForm` cd-wu (core.js:19816): the Work Unit a document ties to.
    workUnit: str,
    effectiveDate: str,
    reviewFreq: str,
    // Derived by `documentControl.ts` from effectiveDate + reviewFreq.
    nextReview: str,
    access: str,
    // OD cd-vscope/cd-vu-units/cd-vu-users/cd-plink (core.js:19828): per-unit/
    // per-user view-access scoping, enforced server-side in
    // `documentControl.filterViewableDocuments`.
    viewScope: str,
    viewUnits: strArray,
    viewUsers: strArray,
    publicLink: bool,
    ackRequired: bool,
    ackAudience: strArray,
    distribution: strArray,
    content: str,
    changeSummary: str,
    reasonForChange: str,
    approvalNotes: str,
    approver: str,
    // OD cd-frmode (core.js:19816): Top Management vs a specific authorized
    // final reviewer.
    finalReviewerMode: str,
    reviewDecision: str,
    reviewComments: str,
    submittedBy: str,
    submittedDate: str,
    approvedBy: str,
    approvedDate: str,
    publishedBy: str,
    publishedDate: str,
    lineageId: str,
    prevVersionId: str,
    supersedes: str,
    supersededBy: str,
    ext: documentExtSchema.nullable().optional(),
  })
  .strict();

const recordFoldersDataSchema = z
  .object({
    ...envelope,
    parentId: str,
    order: numeric,
  })
  .strict();

const recordsDataSchema = z
  .object({
    ...envelope,
    folderId: str,
    /** Denormalized folder name (OD stores both). */
    folder: str,
    category: str,
    issuer: str,
    publisher: str,
    number: str,
    version: str,
    effectiveDate: str,
    publishedDate: str,
    receivedDate: str,
    link: str,
    file: nullableObject,
    reviewFreq: str,
    lastChecked: str,
    nextReview: str,
    reviewStatus: str,
    monitorNotes: str,
    clauses: strArray,
    obligations: strArray,
    processes: strArray,
    workUnits: strArray,
    versionHistory: unknownArray,
    // Pre-migration keys the FE still reads for back-compat (`extDocData`).
    reference: str,
    url: str,
    reviewDate: str,
    issueDate: str,
  })
  .strict();

// --- People: training & awareness --------------------------------------------

const trainingDataSchema = z
  .object({
    ...envelope,
    source: str,
    gapId: str,
    assignmentId: str,
    assessmentId: str,
    sourceRecordId: str,
    memberId: str,
    memberName: str,
    audience: strArray,
    roleId: str,
    roleName: str,
    reqId: str,
    reqTitle: str,
    gapDescription: str,
    type: str,
    delivery: str,
    provider: str,
    due: str,
    priority: str,
    reassessRequired: bool,
    reassessDue: str,
    completionDate: str,
    completedBy: strArray,
    completionEvidence: str,
    completionNotes: str,
    completionResult: str,
    /** OD's competence-gap verdict; `updateRecord` closes the gap on it. */
    outcome: str,
    reassessResult: str,
    linkedReassessId: str,
    // Decorated on read by `trainingLifecycle.ts` — never persisted by the
    // client, but round-tripped back on the next save.
    overdue: bool,
    effectiveStatus: str,
  })
  .strict();

const awarenessDataSchema = z
  .object({
    ...envelope,
    period: str,
    objective: str,
    focus: strArray,
  })
  .strict();

const awarenessTopicsDataSchema = z
  .object({
    ...envelope,
    category: str,
    summary: str,
    keyMessages: str,
    materials: unknownArray,
    programId: str,
  })
  .strict();

const awarenessCampaignsDataSchema = z
  .object({
    ...envelope,
    programId: str,
    topics: strArray,
    focus: strArray,
    audience: unknownObject,
    message: str,
    delivery: strArray,
    startDate: str,
    dueDate: str,
    due: str,
    ackRequired: bool,
    evalRequired: bool,
    evalMethod: strArray,
    acks: unknownArray,
    evals: unknownArray,
    followups: unknownArray,
    // Roll-ups decorated on read by `awarenessControl.ts`.
    ackRate: numeric,
    evalRate: numeric,
    launchedAt: str,
    launchedBy: str,
    // Legacy keys `campaignData` migrates on read — still accepted on write so
    // a pre-parity row survives an edit.
    topicId: str,
    audienceType: str,
  })
  .strict();

// --- Suppliers, performance, evaluation --------------------------------------

const suppliersDataSchema = z
  .object({
    ...envelope,
    name: str,
    entityName: str,
    taxNumber: str,
    type: str,
    website: str,
    // The bespoke supplier page stores a list; the generic register writes a
    // single free-text category. Both are real, so both are accepted — as is
    // the plural `categories` the create path uses.
    category: z.union([z.string(), z.array(z.unknown())]).optional(),
    categories: unknownArray,
    criticality: str,
    contact: str,
    contactName: str,
    email: str,
    phone: str,
    country: str,
    state: str,
    city: str,
    // Stamped server-side by `updateRecord`'s supplier-qualify path on
    // Approved, before this schema would see them again on the next edit.
    qualifiedDate: str,
    requalDate: str,
    evaluations: unknownArray,
    terms: str,
    payAnchor: str,
    bankName: str,
    bankAccount: str,
    bankCode: str,
    payAdvance: numeric,
    payRetention: numeric,
  })
  .strict();

/**
 * OD `db.tnPOs` (`tnPoForm`/`tnPoSeed`, `core.js:8676`/`8711`, SOF-58
 * follow-up). `id`/`tenantId` are the envelope's `id`/org scoping;
 * `supplierId` links to the `suppliers` register.
 */
const supplierPoDataSchema = z
  .object({
    ...envelope,
    supplierId: str,
    supplierName: str,
    date: str,
    provisionType: str,
    items: unknownArray,
    requiredDate: str,
    value: str,
    currency: str,
    receipt: nullableObject,
    evaluation: nullableObject,
    activity: unknownArray,
  })
  .strict();

const performanceDataSchema = z
  .object({
    ...envelope,
    period: str,
    date: str,
    summary: str,
    metric: str,
    target: z.union([z.number(), z.string(), z.null()]).optional(),
    actual: z.union([z.number(), z.string(), z.null()]).optional(),
    unit: str,
    dir: str,
    calc: str,
    cat: str,
    source: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    src: str,
    objId: str,
    objTitle: str,
    route: str,
    indicators: unknownArray,
    objectives: unknownArray,
  })
  .strict();

const reviewsDataSchema = z
  .object({
    ...envelope,
    date: str,
    time: str,
    tz: str,
    format: str,
    link: str,
    location: str,
    chairperson: str,
    recorder: str,
    invited: unknownArray,
    external: unknownArray,
    agenda: str,
    prep: str,
    // OD keeps the minutes topic tree here; older rows stored a prose blob.
    topics: z.union([z.string(), z.array(z.unknown())]).optional(),
    minutesSummary: str,
    finalizedBy: str,
    finalizedDate: str,
    cancelReason: str,
    version: numeric,
    // Register-table roll-ups decorated on read.
    scheduled: str,
    topicsCount: numeric,
    openDecisions: numeric,
    openActions: numeric,
  })
  .strict();

// --- Improvement --------------------------------------------------------------

const nonconformitiesDataSchema = z
  .object({
    ...envelope,
    category: str,
    severity: str,
    process: str,
    site: str,
    workUnit: str,
    pic: str,
    due: str,
    // The corrective-action plan block (`CapEditorModal`) and the status the
    // service derives from it (`deriveNcStatusFromCap`).
    cap: nullableObject,
    capStatus: str,
    rootCause: str,
    sourceConcernId: str,
    sourceConcernCode: str,
    sourceCsatId: str,
    linkedRiskId: str,
    raisedRiskId: str,
    raisedAsRisk: bool,
  })
  .strict();

const improvementsDataSchema = z
  .object({
    ...envelope,
    category: str,
    type: str,
    priority: str,
    due: str,
    suggestedAction: str,
    benefit: str,
    sourceConcernId: str,
    sourceConcernCode: str,
    sourceCsatId: str,
  })
  .strict();

const concernsDataSchema = z
  .object({
    ...envelope,
    category: str,
    process: str,
    site: str,
    workUnit: str,
    evidence: str,
    reportedBy: str,
    reviewer: str,
    reviewDate: str,
    reviewNotes: str,
    classification: str,
    routingNotes: str,
    routedTo: str,
    routedRecordId: str,
    routedRecordCode: str,
  })
  .strict();

const incidentsDataSchema = z
  .object({
    ...envelope,
    type: str,
    severity: str,
    incidentDate: str,
    discoveredDate: str,
    system: str,
    handler: str,
    immediate: str,
    investigation: str,
    rootCause: str,
    correctiveAction: str,
    followups: str,
    sourceConcernId: str,
    sourceConcernCode: str,
  })
  .strict();

const customerSatisfactionDataSchema = z
  .object({
    ...envelope,
    method: str,
    ftype: str,
    score: numeric,
    overall: numeric,
    period: str,
    category: str,
    cats: unknownArray,
    comment: str,
    priority: str,
    source: str,
    sourceCsatId: str,
    routedTo: str,
    routedRecordId: str,
    routedRecordCode: str,
  })
  .strict();

// --- ISO 9001 extensions ------------------------------------------------------

/**
 * `psr` carries three OD entities in one register, split by `data.kind`
 * (`"offering"` / `"template"` / `"record"`, see `PsrWorkspace.tsx` and
 * `psrControl.ts`). One union of their fields rather than three schemas,
 * because the register key — which is what `parseInput` dispatches on — is one.
 */
const psrDataSchema = z
  .object({
    ...envelope,
    kind: str,
    // Offering / spec-template side.
    name: str,
    type: str,
    category: str,
    templateId: str,
    templateName: str,
    sku: str,
    revision: str,
    reviewDate: str,
    spec: unknownObject,
    attributes: unknownArray,
    appliesTo: strArray,
    // Requirements-review record side.
    docType: str,
    provisionType: str,
    customer: str,
    value: z.union([z.number(), z.string(), z.null()]).optional(),
    currency: str,
    linkedOffering: str,
    attachments: unknownArray,
    review: nullableObject,
    product: str,
    requirement: str,
  })
  .strict();

const designDataSchema = z
  .object({
    ...envelope,
    kind: str,
    project: str,
    stage: str,
    category: str,
    summary: str,
    version: str,
    targetDate: str,
    owner: str,
    inputs: z.union([z.string(), z.array(z.unknown())]).optional(),
    outputs: z.union([z.string(), z.array(z.unknown())]).optional(),
    options: unknownArray,
    attributes: unknownArray,
    reviewNotes: str,
    verificationNotes: str,
    validationNotes: str,
    changeNotes: str,
  })
  .strict();

const provisionDataSchema = z
  .object({
    ...envelope,
    process: str,
    processId: str,
    processName: str,
    productService: str,
    controls: str,
    controlPoints: unknownArray,
    conditions: str,
    clause: str,
    revision: str,
    approver: str,
    approvedDate: str,
    route: str,
  })
  .strict();

// --- Accreditation-body registers (SOF-24) ------------------------------------

/**
 * SOF-24 registered 20 accreditation-body keys. Only three of them have an OD
 * field contract, and they are the three below: OD dispatches `tn-m-cab-clients`,
 * `tn-m-pcb-persons` and `tn-m-lab-scope` to purpose-built renderers
 * (`renderCabClients` / `renderPcbPersons` / `renderLabScope`, `js/core.js:9819`
 * onward), each with a seed shape and an edit form naming its fields, and the
 * ported frontend has a real page for each.
 *
 * The other 17 (`capa`, `mmr`, `hira`, five `cab-*`, five `pcb-*`, four `lab-*`)
 * reach OD's generic `renderTenantModule()` fallback (`js/core.js:8957`), which
 * renders an intent line, a card grid of `TN_MODULES[key].sub` labels and an
 * empty register whose New Record button is wired to
 * `toast('New record (scaffold)')`. It writes no field, OD seeds no collection
 * for any of them, and the ported page repeats the same scaffold. There is no
 * OD field contract to derive, so those 17 stay on the open `data` JSONB — they
 * are deliberately absent from `IMPLEMENTATION_DATA_SCHEMAS` below. Adding a
 * `.strict()` schema of standard-derived guesses would 400 the first real
 * payload a screen sends; give a key a schema when its screen lands.
 */

const cabClientsDataSchema = z
  .object({ ...envelope, standard: str, scope: str, certNo: str, issued: str, expiry: str, nextSurveillance: str })
  .strict();

const pcbPersonsDataSchema = z
  .object({ ...envelope, scheme: str, certNo: str, certified: str, expiry: str })
  .strict();

const labScopeDataSchema = z
  .object({ ...envelope, field: str, discipline: str, standard: str, method: str, range: str, cmc: str })
  .strict();

// --- Organization --------------------------------------------------------------

const workUnitsDataSchema = z
  .object({
    ...envelope,
    function: str,
    headcount: numeric,
    parentId: str,
    site: str,
    processes: unknownArray,
    envs: unknownArray,
    deps: unknownArray,
  })
  .strict();

export const IMPLEMENTATION_DATA_SCHEMAS: Partial<Record<MsModuleKey, z.ZodTypeAny>> = {
  awareness: awarenessDataSchema,
  "awareness-campaigns": awarenessCampaignsDataSchema,
  "awareness-topics": awarenessTopicsDataSchema,
  "cab-clients": cabClientsDataSchema,
  compliance: complianceDataSchema,
  concerns: concernsDataSchema,
  context: contextDataSchema,
  "customer-satisfaction": customerSatisfactionDataSchema,
  design: designDataSchema,
  documents: documentsDataSchema,
  improvements: improvementsDataSchema,
  incidents: incidentsDataSchema,
  "lab-scope": labScopeDataSchema,
  nonconformities: nonconformitiesDataSchema,
  objectives: objectivesDataSchema,
  parties: partiesDataSchema,
  "pcb-persons": pcbPersonsDataSchema,
  performance: performanceDataSchema,
  policies: policiesDataSchema,
  processes: processesDataSchema,
  provision: provisionDataSchema,
  psr: psrDataSchema,
  "record-folders": recordFoldersDataSchema,
  records: recordsDataSchema,
  reviews: reviewsDataSchema,
  risks: risksDataSchema,
  suppliers: suppliersDataSchema,
  "supplier-po": supplierPoDataSchema,
  training: trainingDataSchema,
  "work-units": workUnitsDataSchema,
};

export function getImplementationDataSchema(module: string): z.ZodTypeAny | undefined {
  return IMPLEMENTATION_DATA_SCHEMAS[module as MsModuleKey];
}
