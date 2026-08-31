/**
 * SOF-389 (child of SOF-336/SOF-334) — seeds the 5 OD `db.*` collections that
 * map 1:1 to an existing backend model but had zero seeded rows
 * (`parity/DATA-PARITY-2026-08-31.md` "missing" rows for `saasSubs`,
 * `saasWorkspaces`, `saasPipeline`, `siteRequests`, `tenantRoles`). Data is
 * transcribed verbatim from `parity/2026-08-31/dumps/<collection>.json`
 * (OD's `db.*` after its own `seed()` run).
 *
 * Only rows whose OD tenant/partner resolve to an org this repo's `seed.ts`
 * already creates (Garuda/"PT Hammer Industries" idtn5, DamageControl idtn1,
 * their two partners) are included — OD also seeds a few tenants
 * (idtn2/3/4: Alchemax/Brand Corp/Cross Technological) this backend never
 * provisions, so their saasSubs/saasWorkspaces/saasPipeline rows have no
 * valid org_id to seed against and are skipped. SaasPipeline.tenantId is
 * nullable (pre-tenant leads), so its 5 lead rows (no tenant yet) are kept.
 *
 * Idempotency: upsert by natural key — saasPipeline/saasSubscriptions/
 * saasWorkspaces/siteRequests by `code` (unique per their migrations),
 * tenantRoles by `(orgId, code)` (OD's `ROLE-000x` id used as `code`).
 */
import {
  RoleTemplate,
  SaasPipeline,
  SaasSubscription,
  SaasWorkspace,
  SiteRequest,
} from "../models";
import type { SaasPipelineStage, SaasPipelineType } from "../models/saas.models";

interface OrgIds {
  hammerTenantId: string;
  hammerPartnerId: string;
  dcTenantId: string;
  dcPartnerId: string;
}

const PIPELINES = [
  {
    code: "PIPE-1005", odId: "pipe-hammer", tenant: "hammer" as const, partner: "hammer" as const,
    tenantName: "PT Hammer Industries", industry: "Manufacturing", contactPerson: "Jennifer Susan Walters",
    contactEmail: "nicole@hammerind.co.id", items: [{ product: "ms", term: "12 months", price: 36000000 }],
    type: "New Tenant / SaaS", stage: "Completed", registrationComplete: true,
    payment: { method: "Bank Transfer", state: "Verified", invoiceNo: "INV-1005", proofUrl: "transfer-INV-1005.pdf", verifiedBy: "AXIA Finance", verifiedAt: "2025-11-04T05:37:07.972Z" },
    audit: [{ ts: "2025-11-04T05:37:07.972Z", msg: "Provisioned — Management System activated" }],
    createdAt: "2025-10-27T05:37:07.972Z", updatedAt: "2025-11-04T05:37:07.972Z", amount: 36000000,
    subOdId: "sub1",
  },
  {
    code: "PIPE-1001", odId: "pipe-dc-ms", tenant: "dc" as const, partner: "dc" as const,
    tenantName: "PT Damage Control", industry: "Construction", contactPerson: "Janet van Dyne",
    contactEmail: "sandra@damagecontrol.co.id", items: [{ product: "ms", term: "12 months", price: 36000000 }],
    type: "New Tenant / SaaS", stage: "Completed", registrationComplete: true,
    payment: { method: "Bank Transfer", state: "Verified", invoiceNo: "INV-1001", proofUrl: "transfer-INV-1001.pdf", verifiedBy: "AXIA Finance", verifiedAt: "2026-02-12T05:37:07.972Z" },
    audit: [{ ts: "2026-02-12T05:37:07.972Z", msg: "Provisioned — Management System activated" }],
    createdAt: "2026-02-04T05:37:07.972Z", updatedAt: "2026-02-12T05:37:07.972Z", amount: 36000000,
    subOdId: "sub2",
  },
  {
    code: "PIPE-1010", odId: "pipe-dc-cab", tenant: "dc" as const, partner: "dc" as const,
    tenantName: "PT Damage Control", industry: "Construction", contactPerson: "Janet van Dyne",
    contactEmail: "sandra@damagecontrol.co.id", items: [{ product: "cab", term: "12 months", price: 60000000 }],
    type: "Add-on: SaaS", stage: "Completed", registrationComplete: true,
    payment: { method: "Bank Transfer", state: "Verified", invoiceNo: "INV-1010", proofUrl: "transfer-INV-1010.pdf", verifiedBy: "AXIA Finance", verifiedAt: "2025-06-27T05:37:07.972Z" },
    audit: [{ ts: "2025-06-27T05:37:07.972Z", msg: "Add-on provisioned — CAB MS activated" }],
    createdAt: "2025-06-19T05:37:07.972Z", updatedAt: "2025-06-27T05:37:07.972Z", amount: 60000000,
    subOdId: "sub3",
  },
  {
    code: "PIPE-1006", odId: "pipe-hm-lab", tenant: "hammer" as const, partner: "hammer" as const,
    tenantName: "PT Hammer Industries", industry: "Manufacturing", contactPerson: "Jennifer Susan Walters",
    contactEmail: "nicole@hammerind.co.id", items: [{ product: "lab", term: "12 months", price: 48000000 }],
    type: "Add-on: SaaS", stage: "Completed", registrationComplete: true,
    payment: { method: "Bank Transfer", state: "Verified", invoiceNo: "INV-1006", proofUrl: "transfer-INV-1006.pdf", verifiedBy: "AXIA Finance", verifiedAt: "2025-08-06T05:37:07.972Z" },
    audit: [{ ts: "2025-08-06T05:37:07.972Z", msg: "Add-on provisioned — Lab IMS activated" }],
    createdAt: "2025-07-29T05:37:07.972Z", updatedAt: "2025-08-06T05:37:07.972Z", amount: 48000000,
    subOdId: "sub-hm-lab",
  },
  {
    code: "PIPE-1007", odId: "pipe-hm-cab", tenant: "hammer" as const, partner: "hammer" as const,
    tenantName: "PT Hammer Industries", industry: "Manufacturing", contactPerson: "Jennifer Susan Walters",
    contactEmail: "nicole@hammerind.co.id", items: [{ product: "cab", term: "12 months", price: 60000000 }],
    type: "Add-on: SaaS", stage: "Completed", registrationComplete: true,
    payment: { method: "Bank Transfer", state: "Verified", invoiceNo: "INV-1007", proofUrl: "transfer-INV-1007.pdf", verifiedBy: "AXIA Finance", verifiedAt: "2025-07-07T05:37:07.972Z" },
    audit: [{ ts: "2025-07-07T05:37:07.972Z", msg: "Add-on provisioned — CAB MS activated" }],
    createdAt: "2025-06-29T05:37:07.972Z", updatedAt: "2025-07-07T05:37:07.972Z", amount: 60000000,
    subOdId: "sub-hm-cab",
  },
  // Pre-tenant leads (OD tenantId null) — tenantId is nullable on this model, kept as-is.
  {
    code: "PIPE-2001", odId: "pipe1", tenant: null, partner: "hammer" as const,
    tenantName: "PT Roxxon Energy", industry: "Energy", contactPerson: "Dario Agger",
    contactEmail: "dario@roxxon.co.id", items: [{ product: "ms", term: "12 months", price: 36000000 }],
    type: "New Tenant / SaaS", stage: "Quote Sent", registrationComplete: false,
    payment: { method: "Bank Transfer", state: "Awaiting Transfer" },
    audit: [{ ts: "2026-08-28T05:37:07.972Z", msg: "Quote sent by PT Parker Industries" }],
    createdAt: "2026-08-28T05:37:07.972Z", updatedAt: "2026-08-28T05:37:07.972Z", amount: 36000000,
    subOdId: null,
  },
  {
    code: "PIPE-2002", odId: "pipe2", tenant: null, partner: null,
    tenantName: "PT Oscorp Laboratories", industry: "Laboratory", contactPerson: "Norman Osborn",
    contactEmail: "norman@oscorp.co.id", items: [{ product: "lab", term: "12 months", price: 48000000 }],
    type: "New Tenant / SaaS", stage: "Registration", registrationComplete: false,
    payment: { method: "Bank Transfer", state: "Awaiting Transfer" },
    audit: [
      { ts: "2026-08-25T05:37:07.972Z", msg: "Quote accepted" },
      { ts: "2026-08-26T05:37:07.972Z", msg: "Registration started by client" },
    ],
    createdAt: "2026-08-25T05:37:07.972Z", updatedAt: "2026-08-29T05:37:07.972Z", amount: 48000000,
    subOdId: null,
  },
  {
    code: "PIPE-2003", odId: "pipe3", tenant: null, partner: null,
    tenantName: "PT Pym Technologies", industry: "Manufacturing", contactPerson: "Henry Pym",
    contactEmail: "hank@pymtech.co.id",
    items: [
      { product: "ms", term: "12 months", price: 36000000 },
      { product: "cab", term: "12 months", price: 60000000 },
    ],
    type: "New Tenant / SaaS", stage: "Awaiting Transfer", registrationComplete: true,
    payment: { method: "Bank Transfer", state: "Awaiting Transfer", invoiceNo: "INV-2003" },
    audit: [
      { ts: "2026-08-22T05:37:07.972Z", msg: "Quote accepted (MS + CAB MS)" },
      { ts: "2026-08-27T05:37:07.972Z", msg: "Registration completed" },
      { ts: "2026-08-29T05:37:07.972Z", msg: "Invoice INV-2003 issued — awaiting bank transfer" },
    ],
    createdAt: "2026-08-22T05:37:07.972Z", updatedAt: "2026-08-30T05:37:07.972Z", amount: 96000000,
    subOdId: null,
  },
  {
    code: "PIPE-2004", odId: "pipe4", tenant: null, partner: "dc" as const,
    tenantName: "PT Baxter Foundation", industry: "Education", contactPerson: "Reed Richards",
    contactEmail: "reed@baxter.co.id", items: [{ product: "personnel", term: "12 months", price: 48000000 }],
    type: "New Tenant / SaaS", stage: "Under Verification", registrationComplete: true,
    payment: { method: "Bank Transfer", state: "Under Verification", invoiceNo: "INV-2004", proofUrl: "transfer-receipt-2004.pdf" },
    audit: [
      { ts: "2026-08-19T05:37:07.972Z", msg: "Quote accepted" },
      { ts: "2026-08-25T05:37:07.972Z", msg: "Registration completed" },
      { ts: "2026-08-28T05:37:07.972Z", msg: "Invoice INV-2004 issued" },
      { ts: "2026-08-30T05:37:07.972Z", msg: "Transfer proof uploaded — awaiting finance verification" },
    ],
    createdAt: "2026-08-19T05:37:07.972Z", updatedAt: "2026-08-30T05:37:07.972Z", amount: 48000000,
    subOdId: null,
  },
  {
    code: "PIPE-2006", odId: "pipe6", tenant: null, partner: null,
    tenantName: "PT Stark Solutions", industry: "Technology", contactPerson: "Morgan Stark",
    contactEmail: "morgan@starksolutions.co.id", items: [{ product: "ms", term: "12 months", price: 36000000 }],
    type: "New Tenant / SaaS", stage: "Provisioning Failed", registrationComplete: true,
    payment: { method: "Bank Transfer", state: "Verified", invoiceNo: "INV-2006", proofUrl: "transfer-receipt-2006.pdf", verifiedBy: "AXIA Finance", verifiedAt: "2026-08-30T05:37:07.972Z" },
    audit: [
      { ts: "2026-08-23T05:37:07.972Z", msg: "Quote accepted" },
      { ts: "2026-08-28T05:37:07.972Z", msg: "Registration completed" },
      { ts: "2026-08-30T05:37:07.972Z", msg: "Payment verified" },
      { ts: "2026-08-30T05:37:07.972Z", msg: "Auto-provisioning failed — queued for retry" },
    ],
    createdAt: "2026-08-23T05:37:07.972Z", updatedAt: "2026-08-30T05:37:07.972Z", amount: 36000000,
    subOdId: null,
  },
];

const SUBSCRIPTIONS = [
  {
    code: "SUB-1001", odId: "sub1", tenant: "hammer" as const, partner: "hammer" as const, pipelineOdId: "pipe-hammer",
    products: ["ms"], startDate: "2025-11-04T05:37:07.972Z", renewalDate: "2026-11-04T05:37:07.972Z",
    lastPaymentAt: "2025-11-04T05:37:07.972Z", amount: 36000000, graceStartedAt: null, archivedAt: null,
    audit: [{ ts: "2025-11-04T05:37:07.972Z", msg: "Subscription activated · bank transfer verified" }],
  },
  {
    code: "SUB-1002", odId: "sub2", tenant: "dc" as const, partner: "dc" as const, pipelineOdId: "pipe-dc-ms",
    products: ["ms"], startDate: "2026-02-12T05:37:07.972Z", renewalDate: "2026-12-29T05:37:07.972Z",
    lastPaymentAt: "2026-02-12T05:37:07.972Z", amount: 36000000, graceStartedAt: null, archivedAt: null,
    audit: [{ ts: "2026-02-12T05:37:07.972Z", msg: "Subscription activated · bank transfer verified" }],
  },
  {
    code: "SUB-1003", odId: "sub3", tenant: "dc" as const, partner: "dc" as const, pipelineOdId: "pipe-dc-cab",
    products: ["cab"], startDate: "2025-06-27T05:37:07.972Z", renewalDate: "2026-05-03T05:37:07.972Z",
    lastPaymentAt: "2025-06-27T05:37:07.972Z", amount: 60000000,
    graceStartedAt: "2026-06-02T05:37:07.972Z", archivedAt: "2026-07-02T05:37:07.972Z",
    audit: [{ ts: "2025-06-27T05:37:07.972Z", msg: "Subscription activated · bank transfer verified" }],
  },
  {
    code: "SUB-1007", odId: "sub-hm-lab", tenant: "hammer" as const, partner: "hammer" as const, pipelineOdId: "pipe-hm-lab",
    products: ["lab"], startDate: "2025-08-06T05:37:07.972Z", renewalDate: "2026-08-16T05:37:07.972Z",
    lastPaymentAt: "2025-08-06T05:37:07.972Z", amount: 48000000,
    graceStartedAt: "2026-08-16T05:37:07.972Z", archivedAt: null,
    audit: [{ ts: "2025-08-06T05:37:07.972Z", msg: "Subscription activated · bank transfer verified" }],
  },
  {
    code: "SUB-1008", odId: "sub-hm-cab", tenant: "hammer" as const, partner: "hammer" as const, pipelineOdId: "pipe-hm-cab",
    products: ["cab"], startDate: "2025-07-07T05:37:07.972Z", renewalDate: "2026-07-17T05:37:07.972Z",
    lastPaymentAt: "2025-07-07T05:37:07.972Z", amount: 60000000,
    graceStartedAt: "2026-08-16T05:37:07.972Z", archivedAt: null,
    audit: [{ ts: "2025-07-07T05:37:07.972Z", msg: "Subscription activated · bank transfer verified" }],
  },
];

const WORKSPACES = [
  { code: "WS-1001", odId: "ws1", tenant: "hammer" as const, subOdId: "sub1", product: "ms", name: "Management System", standard: "ISO 9001:2015", provisionedAt: "2025-11-04T05:37:07.972Z", audit: [{ ts: "2025-11-04T05:37:07.972Z", msg: "Workspace provisioned (Management System)" }] },
  { code: "WS-1002", odId: "ws2", tenant: "dc" as const, subOdId: "sub2", product: "ms", name: "Management System", standard: "ISO 9001:2015", provisionedAt: "2026-02-12T05:37:07.972Z", audit: [{ ts: "2026-02-12T05:37:07.972Z", msg: "Workspace provisioned (Management System)" }] },
  { code: "WS-1003", odId: "ws3", tenant: "dc" as const, subOdId: "sub3", product: "cab", name: "CAB MS", standard: "ISO/IEC 17021-1:2015", provisionedAt: "2025-06-27T05:37:07.972Z", audit: [{ ts: "2025-06-27T05:37:07.972Z", msg: "Workspace provisioned (CAB MS)" }] },
  { code: "WS-1007", odId: "ws-hm-lab", tenant: "hammer" as const, subOdId: "sub-hm-lab", product: "lab", name: "Lab IMS", standard: "ISO/IEC 17025:2017", provisionedAt: "2025-08-06T05:37:07.972Z", audit: [{ ts: "2025-08-06T05:37:07.972Z", msg: "Workspace provisioned (Lab IMS)" }] },
  { code: "WS-1008", odId: "ws-hm-cab", tenant: "hammer" as const, subOdId: "sub-hm-cab", product: "cab", name: "CAB MS", standard: "ISO/IEC 17021-1:2015", provisionedAt: "2025-07-07T05:37:07.972Z", audit: [{ ts: "2025-07-07T05:37:07.972Z", msg: "Workspace provisioned (CAB MS)" }] },
];

const SITE_REQUESTS = [
  {
    code: "SRQ-1001", tenant: "hammer" as const, type: "Site Addition" as const, requestedBy: "Tenant", status: "Submitted" as const,
    proposed: { name: "Bandung Distribution Center", siteType: "Warehouse", country: "ID", address: "Jl. Soekarno Hatta 210", city: "Bandung", state: "Jawa Barat", postalCode: "40235" },
    reason: "New regional distribution hub to serve West Java.",
    audit: [
      { ts: "2026-05-10T04:00:00.000Z", msg: "Request submitted by Tenant Administrator" },
      { ts: "2026-05-10T04:00:00.000Z", msg: "Request created" },
    ],
  },
  {
    code: "SRQ-1002", tenant: "hammer" as const, type: "Site Change" as const, requestedBy: "Tenant", status: "Under Review" as const,
    proposed: { address: "Kawasan Industri MM2100 Blok C-5", city: "Bekasi", state: "Jawa Barat", postalCode: "17520" },
    reason: "Corrected building/block in registered address after relocation within the estate.",
    audit: [
      { ts: "2026-05-13T04:00:00.000Z", msg: "Moved to Under Review by Service Provider" },
      { ts: "2026-05-12T04:00:00.000Z", msg: "Request submitted by Tenant Administrator" },
    ],
  },
  {
    code: "SRQ-1003", tenant: "hammer" as const, type: "Site Closure" as const, requestedBy: "Partner", status: "Draft" as const,
    proposed: {},
    reason: "Warehouse lease ending; consolidating into the new Bandung DC.",
    audit: [{ ts: "2026-05-14T04:00:00.000Z", msg: "Request drafted by Partner" }],
  },
  {
    code: "SRQ-1004", tenant: "dc" as const, type: "Site Addition" as const, requestedBy: "Partner", status: "Approved" as const,
    proposed: { name: "Bandung Sales Office", siteType: "Branch Office", country: "ID", address: "Jl. Asia Afrika 50", city: "Bandung", state: "Jawa Barat", postalCode: "40111" },
    reason: "Expansion of sales coverage.",
    audit: [
      { ts: "2026-05-09T04:00:00.000Z", msg: "Request approved — awaiting site provisioning" },
      { ts: "2026-05-08T04:00:00.000Z", msg: "Request submitted by Partner" },
    ],
  },
];

const TENANT_ROLES = [
  {
    code: "ROLE-0001", name: "Top Management", category: "Governance",
    purpose: "Provide leadership, accountability, resources, and strategic direction for the management system.",
    workUnits: ["Executive Management"], frameworks: ["ISO 9001:2015", "ISO/IEC 27001:2022"],
    responsibilities: [
      "Ensure the management system achieves intended results.", "Establish policy and objectives.",
      "Provide necessary resources.", "Promote continual improvement.",
      "Review management system performance.", "Assign responsibilities and authorities.",
    ],
    authorities: [
      "Approve management system policies.", "Approve objectives and major improvement plans.",
      "Assign management system responsibilities.", "Approve management review outputs.",
    ],
    createdAt: "2026-08-11T05:37:13.264Z", updatedAt: "2026-08-19T05:37:13.264Z",
  },
  {
    code: "ROLE-0002", name: "Document Controller", category: "Management System",
    purpose: "Maintain controlled documents and support document review, approval, publication, and obsolete document control.",
    workUnits: ["Governance / Quality Management"], frameworks: ["ISO 9001:2015"],
    responsibilities: [
      "Maintain the controlled document register.", "Coordinate document review and approval.",
      "Ensure documents have owners, versions, and review dates.", "Prevent unintended use of obsolete documents.",
      "Support document distribution and retrieval.",
    ],
    authorities: [
      "Register approved documents.", "Request document corrections.",
      "Archive obsolete documents.", "Escalate overdue document reviews.",
    ],
    createdAt: "2026-08-12T05:37:13.264Z", updatedAt: "2026-08-20T05:37:13.264Z",
  },
  {
    code: "ROLE-0003", name: "Internal Auditor", category: "Audit",
    purpose: "Conduct internal audits objectively and report audit findings.",
    workUnits: ["Governance / Quality Management"], frameworks: ["ISO 9001:2015", "ISO/IEC 27001:2022"],
    responsibilities: [
      "Prepare for assigned audit sessions.", "Review audit criteria and evidence.",
      "Conduct audit interviews or evidence reviews.", "Record audit findings.",
      "Submit findings for lead auditor review.",
    ],
    authorities: [
      "Request audit evidence.", "Raise audit findings.",
      "Recommend improvement opportunities.", "Escalate unresolved audit issues to lead auditor.",
    ],
    createdAt: "2026-08-13T05:37:13.264Z", updatedAt: "2026-08-21T05:37:13.264Z",
  },
  {
    code: "ROLE-0004", name: "Process Owner", category: "Process",
    purpose: "Own and maintain assigned business processes, performance, risks, and improvement actions.",
    workUnits: ["Software Development"], frameworks: ["ISO 9001:2015"],
    responsibilities: [
      "Maintain assigned business process information.", "Monitor process performance.",
      "Address risks and opportunities.", "Respond to audit findings and corrective actions.",
      "Ensure process records are maintained.",
    ],
    authorities: [
      "Approve process-level updates.", "Assign process action owners.",
      "Request resources for process improvement.", "Escalate process issues to management.",
    ],
    createdAt: "2026-08-14T05:37:13.264Z", updatedAt: "2026-08-22T05:37:13.264Z",
  },
  {
    code: "ROLE-0005", name: "Information Security Officer", category: "Information Security",
    purpose: "Coordinate information security governance, risk treatment, and security performance monitoring.",
    workUnits: ["IT Infrastructure"], frameworks: ["ISO/IEC 27001:2022", "ISO/IEC 27701:2025"],
    responsibilities: [
      "Coordinate information security risk management.", "Monitor information security controls.",
      "Support incident response and security improvement.", "Report information security performance.",
      "Maintain security-related documented information.",
    ],
    authorities: [
      "Request security control implementation.", "Escalate security risks.",
      "Review security-related access or control issues.", "Recommend corrective actions for security nonconformities.",
    ],
    createdAt: "2026-08-15T05:37:13.264Z", updatedAt: "2026-08-23T05:37:13.264Z",
  },
];

const CREATED_BY = "Jennifer Susan Walters";

export async function seedSaasLifecycle(orgIds: OrgIds): Promise<void> {
  const tenantId = (t: "hammer" | "dc" | null) =>
    t === "hammer" ? orgIds.hammerTenantId : t === "dc" ? orgIds.dcTenantId : null;
  const partnerId = (p: "hammer" | "dc" | null) =>
    p === "hammer" ? orgIds.hammerPartnerId : p === "dc" ? orgIds.dcPartnerId : null;

  const pipelineIdByOdId = new Map<string, string>();
  for (const p of PIPELINES) {
    const [row] = await SaasPipeline.findOrCreate({
      where: { code: p.code },
      defaults: {
        code: p.code, tenantId: tenantId(p.tenant), tenantName: p.tenantName, partnerId: partnerId(p.partner),
        industry: p.industry, contactPerson: p.contactPerson, contactEmail: p.contactEmail,
        items: p.items, type: p.type as SaasPipelineType, stage: p.stage as SaasPipelineStage, registrationComplete: p.registrationComplete,
        payment: p.payment, subId: p.subOdId ?? null, audit: p.audit,
        createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt), amount: p.amount,
      },
    });
    pipelineIdByOdId.set(p.odId, row.id);
  }

  const subIdByOdId = new Map<string, string>();
  for (const s of SUBSCRIPTIONS) {
    const tId = tenantId(s.tenant);
    if (!tId) continue;
    const [row] = await SaasSubscription.findOrCreate({
      where: { code: s.code },
      defaults: {
        code: s.code, tenantId: tId, pipelineId: pipelineIdByOdId.get(s.pipelineOdId) ?? null,
        partnerId: partnerId(s.partner), products: s.products,
        startDate: new Date(s.startDate), renewalDate: new Date(s.renewalDate), lastPaymentAt: new Date(s.lastPaymentAt),
        amount: s.amount, graceStartedAt: s.graceStartedAt ? new Date(s.graceStartedAt) : null,
        archivedAt: s.archivedAt ? new Date(s.archivedAt) : null, audit: s.audit,
      },
    });
    subIdByOdId.set(s.odId, row.id);
  }

  // Backfill the pipeline's display subId now that the real subscription UUID exists.
  for (const p of PIPELINES) {
    if (!p.subOdId) continue;
    const subId = subIdByOdId.get(p.subOdId);
    const pipeId = pipelineIdByOdId.get(p.odId);
    if (!subId || !pipeId) continue;
    await SaasPipeline.update({ subId }, { where: { id: pipeId, subId: p.subOdId } });
  }

  for (const w of WORKSPACES) {
    const tId = tenantId(w.tenant);
    const subId = subIdByOdId.get(w.subOdId);
    if (!tId || !subId) continue;
    await SaasWorkspace.findOrCreate({
      where: { code: w.code },
      defaults: {
        code: w.code, tenantId: tId, subId, product: w.product, name: w.name, standard: w.standard,
        provisionedAt: new Date(w.provisionedAt), audit: w.audit,
      },
    });
  }
}

export async function seedSiteRequests(orgIds: OrgIds): Promise<void> {
  for (const sr of SITE_REQUESTS) {
    const orgId = sr.tenant === "hammer" ? orgIds.hammerTenantId : orgIds.dcTenantId;
    await SiteRequest.findOrCreate({
      where: { code: sr.code },
      defaults: {
        orgId, code: sr.code, type: sr.type, siteId: null, requestedBy: sr.requestedBy,
        proposed: sr.proposed, reason: sr.reason, status: sr.status, audit: sr.audit,
      },
    });
  }
}

export async function seedTenantRoles(hammerTenantId: string): Promise<void> {
  for (const r of TENANT_ROLES) {
    await RoleTemplate.findOrCreate({
      where: { orgId: hammerTenantId, code: r.code },
      defaults: {
        orgId: hammerTenantId, code: r.code, name: r.name, category: r.category, purpose: r.purpose,
        workUnits: r.workUnits, processes: [], frameworks: r.frameworks,
        responsibilities: r.responsibilities, authorities: r.authorities, status: "Active", notes: "",
        createdBy: CREATED_BY, lastUpdatedBy: CREATED_BY,
        activity: [{ ts: r.createdAt, user: CREATED_BY, action: "Role template created", summary: r.name }],
        comments: [], createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt),
      },
    });
  }
}
