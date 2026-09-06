import "dotenv/config";
import { sequelize } from "../sequelize";
import {
  initModels,
  Organization,
  User,
  Role,
  Menu,
  Action,
  RoleMenuGrant,
  RoleActionGrant,
  Subscription,
  PartnerProfile,
  PartnerAgreement,
  AgreementTemplate,
  TenantProfile,
  Site,
  Plan,
  Invoice,
  Ticket,
  Assessment,
  AssessmentAnswer,
  Gap,
  FrameworkAssignment,
  Framework,
  ImplementationRecord,
  RecordEvent,
  IaProgram,
  IaPlan,
  IaSession,
  IaFinding,
  IaReport,
  PerfEval,
  TestingService,
  KbArticle,
  Notification,
  WorkUnit,
  ApprovalPoolMember,
  ScopeDataset,
} from "../models";
import { ACTIONS, MENU_SEED, type SeedMenu } from "../../modules/iam/actions.catalog";
import { seedAxiaTeam } from "./axiaTeam";
import { agreementHistoryFor, seedOdPartners } from "./odPartners";
import { grantEverythingExceptSpOnly } from "../../modules/iam/tenantGrants";
import { seedComplianceEngine } from "./complianceEngine";
import { seedIsraLibrary } from "./isra";
import { seedIsraTenantDemo } from "./israTenantDemo";
import { seedCms } from "./cms";
import { seedBpCatalog } from "./businessProcess";
import { seedSaasLifecycle, seedSiteRequests, seedTenantRoles } from "./dataParity";
import { seedCompetenceRolesAndAssignments } from "./competenceRoles";
import { seedAwareness, seedCompetenceAssessmentsAndGaps, seedTrainingPlans } from "./personnelSeed";
import { seedOrgUnits } from "./orgUnits";
import { seedDoaMatrix } from "./doaMatrix";
import type { AgreementBlock, AgreementTemplateStatus } from "../models/agreementTemplate.model";
import { generateStatementForPartner } from "../../modules/billing/billing.service";
import { hashPassword } from "../../lib/password";
import { ensureGlobalSeed as ensureScopeDatasetSeed } from "../../modules/scope/scopeDataset.service";
import {
  seedBusinessRecords, seedEnterpriseSuppliers, seedTenantSuppliers,
  seedCustomerSatisfaction, seedDesignItems, seedPsr, seedControlPlans,
  seedInterestedParties, seedManagementReviews, seedMsScope,
  seedCabClients, seedPcbPersons, seedLabScope, seedTenantSupplierPOs,
} from "./businessRecordsSeed";

const DEFAULT_PASSWORD = "ChangeMe123";

// belongsToMany generates a `setRoles` mixin at runtime; the User model does not
// declare it, so reach it through a narrow association-only cast.
type WithSetRoles = { setRoles: (roles: Role[]) => Promise<unknown> };

async function seedMenuTree(nodes: SeedMenu[], parentId: string | null, baseSort: number): Promise<void> {
  let sort = baseSort;
  for (const node of nodes) {
    sort += 1;
    const [menu] = await Menu.findOrCreate({
      where: { name: node.name, parentId },
      defaults: {
        parentId,
        name: node.name,
        heading: node.heading ?? null,
        route: node.route ?? null,
        routeSeo: node.routeSeo ?? null,
        icon: node.icon ?? null,
        sorting: sort,
        status: true,
      },
    });
    let aSort = 0;
    for (const action of node.actions ?? []) {
      aSort += 1;
      await Action.findOrCreate({
        where: { key: action.key },
        defaults: { menuId: menu.id, key: action.key, name: action.name, sorting: aSort, status: true },
      });
    }
    if (node.children?.length) await seedMenuTree(node.children, menu.id, 0);
  }
}

/** Grant a role every menu + every action (full access, explicit grants). Service-Owner roles only. */
async function grantEverything(roleId: string): Promise<void> {
  for (const menu of await Menu.findAll()) {
    await RoleMenuGrant.findOrCreate({ where: { roleId, menuId: menu.id }, defaults: { roleId, menuId: menu.id, granted: true } });
  }
  for (const action of await Action.findAll()) {
    await RoleActionGrant.findOrCreate({ where: { roleId, actionId: action.id }, defaults: { roleId, actionId: action.id, granted: true } });
  }
}

// SP_ONLY_ACTIONS + grantEverythingExceptSpOnly (B2/P0-6 curated grant set for
// Distributor/Tenant admin roles) now live in `../../modules/iam/tenantGrants`
// so the seeder and live BE tenant provisioning (`tenant.service.ts`
// `provisionTenant`, `registration.service.ts` `approveRegistration`) share
// one definition instead of drifting.

/** Grant a role specific menus (by name) and specific action keys. */
async function grantAccess(roleId: string, menuNames: string[], actionKeys: string[]): Promise<void> {
  const menus = await Menu.findAll();
  const byName = new Map(menus.map((m) => [m.name, m]));
  for (const name of menuNames) {
    const menu = byName.get(name);
    if (menu) {
      await RoleMenuGrant.findOrCreate({ where: { roleId, menuId: menu.id }, defaults: { roleId, menuId: menu.id, granted: true } });
    }
  }
  const actions = await Action.findAll({ where: { key: actionKeys } });
  for (const action of actions) {
    await RoleActionGrant.findOrCreate({ where: { roleId, actionId: action.id }, defaults: { roleId, actionId: action.id, granted: true } });
  }
}

/** OD `seedTenants()`'s own `c(d)` helper: `new Date(2026, 4, d, 10, 0, 0)`
 * (open-design core.js:6867). */
const odMay = (day: number): Date => new Date(2026, 4, day, 10, 0, 0);

async function ensureUser(
  username: string,
  fullName: string,
  email: string,
  orgId: string,
  role: Role,
  tenantId: string | null = null,
): Promise<void> {
  const [user] = await User.findOrCreate({
    where: { username },
    defaults: {
      orgId,
      tenantId,
      fullName,
      username,
      email,
      passwordHash: await hashPassword(DEFAULT_PASSWORD),
      status: "Active",
      position: role.name,
      workUnit: null,
      lastLogin: null,
      activationToken: null,
      resetToken: null,
      resetExpires: null,
    },
  });
  await (user as unknown as WithSetRoles).setRoles([role]);
}

export async function seed(): Promise<void> {
  initModels();
  await sequelize.authenticate();

  // 1. Menus + actions (the CRUD-style operation catalog).
  await seedMenuTree(MENU_SEED, null, 0);

  // 2. Service Owner organization.
  const [so] = await Organization.findOrCreate({
    where: { code: "AXIA" },
    defaults: {
      name: "AXIA", code: "AXIA", type: "ServiceOwner", status: "Active",
      parentOrgId: null, tenantId: null, email: "ops@axia.io", phone: null, website: null, country: "SG", address: null,
    },
  });

  // 3. Roles: Super Admin (bypass), Administrator (all grants), User (read-only).
  const [superAdminRole] = await Role.findOrCreate({
    where: { name: "Super Admin", orgId: so.id },
    defaults: { name: "Super Admin", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true },
  });
  const [adminRole] = await Role.findOrCreate({
    where: { name: "Administrator", orgId: so.id },
    defaults: { name: "Administrator", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true },
  });
  const [userRole] = await Role.findOrCreate({
    where: { name: "User", orgId: so.id },
    defaults: { name: "User", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true },
  });
  // R7 / OD `ROLE_GROUPS` (js/core.js:111) — 'Basic User' is one of the four
  // groups Team Management offers, and it is the profile-only preset: the
  // Organization Settings profile page and nothing else. Without it the group
  // is unassignable, and the nearest analogue ('User', seeded above) carries
  // 21 menus and 24 read actions — a far wider grant than OD's.
  const [basicUserRole] = await Role.findOrCreate({
    where: { name: "Basic User", orgId: so.id },
    defaults: { name: "Basic User", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true },
  });
  // OD `ROLE_GROUPS` — the role groups Team Management actually offers a
  // Service Provider user (`role.catalog.ts` ServiceOwner). Without these two,
  // every seeded staff member collapses onto Administrator, and the ticket
  // assignee pool (`ticket.service.ts`, which selects Administrator OR
  // Technical Support) can never contain a support engineer.
  const [billingRole] = await Role.findOrCreate({
    where: { name: "Billing Manager", orgId: so.id },
    defaults: { name: "Billing Manager", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true },
  });
  const [supportRole] = await Role.findOrCreate({
    where: { name: "Technical Support", orgId: so.id },
    defaults: { name: "Technical Support", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: false, status: true },
  });

  // 4. Grants. Super Admin bypasses checks (and also gets explicit grants so the
  //    grant matrix UI shows it fully enabled). Administrator = full CRUD.
  await grantEverything(superAdminRole.id);
  await grantEverything(adminRole.id);
  // R7 — 'Basic User' is the profile-only preset: `['org-profile']`, no actions.
  await grantAccess(basicUserRole.id, ["Organization Settings"], []);
  // User = read-only: can view the main sections + read, nothing that mutates.
  await grantAccess(
    userRole.id,
    [
      "Dashboard", "Organizations", "Users", "Roles & Access", "Audit Log",
      "Organization Settings", "Partners", "Partnership Agreements", "Billing",
      "Tenants", "Sites", "Site Requests", "Tickets", "Gap Assessment", "Management System", "LIMS", "Knowledge Base",
      "Frameworks", "Requirement Library", "Element Library", "Cross References",
    ],
    [
      ACTIONS.ORG_READ,
      ACTIONS.USER_READ,
      ACTIONS.ROLE_READ,
      ACTIONS.MENU_READ,
      ACTIONS.AUDIT_READ,
      ACTIONS.SIGNATORY_READ,
      ACTIONS.PARTNER_READ,
      ACTIONS.AGREEMENT_READ,
      ACTIONS.BILLING_READ,
      ACTIONS.TENANT_READ,
      ACTIONS.SITE_READ,
      ACTIONS.SITE_REQUEST_READ,
      ACTIONS.FRAMEWORK_ASSIGNMENT_READ,
      ACTIONS.TICKET_READ,
      ACTIONS.TICKET_CREATE,
      ACTIONS.TICKET_REPLY,
      ACTIONS.FRAMEWORK_READ,
      ACTIONS.ELEMENT_READ,
      ACTIONS.REQUIREMENT_READ,
      ACTIONS.ASSESSMENT_READ,
      ACTIONS.ASSESSMENT_RUN_READ,
      ACTIONS.MS_READ,
      ACTIONS.PERFEVAL_READ,
      ACTIONS.LIMS_READ,
      ACTIONS.KB_READ,
    ],
  );

  // Role-group grants: each fixed group sees its own module (OD `PermissionZone`
  // maps Billing Manager -> billing, Technical Support -> ticket).
  await grantAccess(billingRole.id, ["Dashboard", "Billing"], [ACTIONS.BILLING_READ, ACTIONS.BILLING_MANAGE]);
  await grantAccess(
    supportRole.id,
    ["Dashboard", "Tickets"],
    [ACTIONS.TICKET_READ, ACTIONS.TICKET_CREATE, ACTIONS.TICKET_REPLY, ACTIONS.TICKET_MANAGE],
  );

  // 5. One demo user per role (all under the SO org → Service-Owner scope).
  await ensureUser("soadmin", "Super Admin", "soadmin@axia.io", so.id, superAdminRole);
  await ensureUser("admin", "Administrator", "admin@axia.io", so.id, adminRole);
  await ensureUser("user", "Standard User", "user@axia.io", so.id, userRole);

  //    ...plus OD `seedUsers()`: the fourteen-person AXIA staff roster behind
  //    Team Management. Runs after the roles above so each member can be
  //    attached to its OD role group.
  await seedAxiaTeam(so.id);

  // 6. Platform subscription for the SO org.
  await Subscription.findOrCreate({
    where: { orgId: so.id },
    defaults: { orgId: so.id, plan: "platform", entitlements: { all: true }, status: "Active", startDate: new Date(), endDate: null },
  });

  // 7. Multi-persona demo data so the FE shells (Distributor / Tenant) can be
  //    exercised against real auth + nav. Each persona gets an org-scoped
  //    "Administrator" role (the name the FE nav matrix keys on) with full grants
  //    — data access is still bounded to the org's subtree by request scoping.
  const [distributor] = await Organization.findOrCreate({
    where: { code: "NPART" },
    defaults: {
      name: "Nusantara Partners", code: "NPART", type: "Distributor", status: "Active",
      parentOrgId: so.id, tenantId: null, email: "ops@nusantara.id", phone: null, website: null, country: "ID", address: null,
    },
  });
  const [distAdminRole] = await Role.findOrCreate({
    where: { name: "Administrator", orgId: distributor.id },
    defaults: { name: "Administrator", tierScope: "Distributor", orgId: distributor.id, isSuperAdmin: false, status: true },
  });
  await grantEverythingExceptSpOnly(distAdminRole.id);
  await ensureUser("partner", "Partner Admin", "admin@nusantara.id", distributor.id, distAdminRole);

  // Tenant acquired through the distributor (acquisition = Partner).
  const [tenant] = await Organization.findOrCreate({
    // OD `idtn5` / `TEN-1005` — the PT Hammer Industries persona this org stands
    // for. The org `code` stays `GARUDA`: `findOrCreate` keys on it, and the
    // container runs `node dist/server.js` with no migrate/seed step, so the
    // deployed database persists across releases. Renaming the code would not
    // rename the existing row — it would seed a SECOND Damage Control / Garuda
    // org beside it. Aligning codes to OD's TEN-nnnn is a data migration, not a
    // seeder edit.
    // in for throughout the seeds (open-design core.js:6894).
    where: { code: "GARUDA" },
    defaults: {
      name: "Garuda Manufacturing", code: "GARUDA", type: "Tenant", status: "Active",
      parentOrgId: distributor.id, tenantId: null, email: "ops@garuda.id", phone: null, website: null, country: "ID", address: null,
    },
  });
  const [tenantAdminRole] = await Role.findOrCreate({
    where: { name: "Administrator", orgId: tenant.id },
    defaults: { name: "Administrator", tierScope: "Tenant", orgId: tenant.id, isSuperAdmin: false, status: true },
  });
  await grantEverythingExceptSpOnly(tenantAdminRole.id);
  // Tenant users carry their own org id as the tenant scope on the JWT.
  await ensureUser("tenant", "Tenant Admin", "admin@garuda.id", tenant.id, tenantAdminRole, tenant.id);

  await Subscription.findOrCreate({
    where: { orgId: tenant.id },
    defaults: { orgId: tenant.id, plan: "standard", entitlements: { frameworks: ["ISO 9001:2015"] }, status: "Active", startDate: new Date(), endDate: null },
  });

  // 8. Phase 3 — commercial profile for the demo distributor so it surfaces on
  //    the Partners list, plus seed agreement templates (SO master data).
  await PartnerProfile.findOrCreate({
    where: { orgId: distributor.id },
    defaults: {
      orgId: distributor.id,
      code: "PRT-1001",
      tier: "Gold",
      status: "Active",
      adminUserId: null,
      commercialSummary: { revenueSharePct: 20, currency: "IDR" },
      audit: [{ ts: new Date().toISOString(), msg: "Partner organization created" }],
    },
  });

  // OD `PARTNER_AG_HISTORY` — the partner's agreement timeline, sliced by how
  // far the partnership got (`odPartners.ts`). Without it the Agreement tab had
  // an empty timeline: the live service only appends events as they happen, and
  // a seeded partner never went through generate/send/approve.
  await PartnerAgreement.findOrCreate({
    where: { orgId: distributor.id },
    defaults: {
      orgId: distributor.id,
      templateId: null,
      templateName: "Principal Partner Agreement",
      number: "AGR-2026-0001",
      version: "1.0",
      status: "Approved",
      effectiveDate: "2026-01-01",
      expirationDate: "2027-12-31",
      vars: {},
      renderedBlocks: [],
      history: agreementHistoryFor("Active"),
    },
  });

  // ...and OD's remaining four partners (PRT-1002..1005), which carry the Draft /
  // Pending Approval / Suspended / Terminated states this list otherwise never shows.
  await seedOdPartners(so.id);

  const templates: Array<{
    code: string;
    name: string;
    description: string | null;
    version: string;
    status: AgreementTemplateStatus;
    blocks: AgreementBlock[];
  }> = [
    {
      code: "AGT-1001",
      name: "Standard Reseller Agreement",
      description: "Default reseller terms",
      version: "v2.1",
      status: "Active" as const,
      blocks: [
        { id: "b1", type: "heading", text: "PARTNERSHIP AGREEMENT" },
        { id: "b2", type: "paragraph", text: "This agreement is made with {{partner_name}} ({{partner_code}})." },
        { id: "b3", type: "clause", text: "Revenue share is {{revenue_share_percentage}}% settled in {{currency}}." },
        { id: "b4", type: "signature", text: "{{service_provider_signatory_name}} — {{partner_signatory_name}}" },
      ],
    },
    {
      code: "AGT-1002",
      name: "Distributor Agreement",
      description: "Distributor terms",
      version: "v1.4",
      status: "Active" as const,
      blocks: [{ id: "b1", type: "heading", text: "DISTRIBUTOR AGREEMENT" }],
    },
    {
      code: "AGT-1003",
      name: "Principal Partner Agreement",
      description: null,
      version: "v1.0",
      status: "Draft" as const,
      blocks: [{ id: "b1", type: "heading", text: "PRINCIPAL PARTNER AGREEMENT" }],
    },
  ];
  for (const t of templates) {
    await AgreementTemplate.findOrCreate({
      where: { code: t.code },
      defaults: { orgId: so.id, ...t },
    });
  }

  // 9. Phase 4 — onboard the demo tenant (Garuda) as a fully provisioned tenant:
  //    a tenant_profile (acquired via the distributor) + a primary site.
  const [garudaProfile] = await TenantProfile.findOrCreate({
    where: { orgId: tenant.id },
    defaults: {
      orgId: tenant.id,
      acquisition: "Partner",
      partnerOrgId: distributor.id,
      billingOwner: "Tenant Admin",
      status: "Active",
      subscriptionSummary: { plan: "standard" },
      audit: [{ ts: new Date().toISOString(), msg: "Tenant organization created" }],
    },
  });
  // Subscription Agreement + timeline for the sp-tenant Billing tab (OD
  // index.html:7224 seed shape). Idempotent: only set when still missing
  // (migration 0045 backfills pre-existing rows the same way).
  if (!garudaProfile.agreement) {
    garudaProfile.agreement = {
      number: "TA-2026-0001", name: "VIBES Subscription Agreement", version: "1.0", status: "Active",
      subscriptionType: "Professional", billingCycle: "Monthly",
      effectiveDate: "2026-01-01", expirationDate: "2026-12-31", currency: "IDR", paymentDueDays: 14,
      history: [
        { date: "2025-12-20", event: "Agreement Generated" },
        { date: "2025-12-21", event: "Agreement Sent to Tenant" },
        { date: "2025-12-23", event: "Agreement Approved by Tenant" },
        { date: "2026-01-01", event: "Subscription Became Active" },
        { date: "2026-02-01", event: "Billing Period Closed" },
        { date: "2026-03-01", event: "Billing Period In Progress" },
      ],
    };
    await garudaProfile.save();
  }
  const [siteHq] = await Site.findOrCreate({
    where: { code: "STE-1001" },
    defaults: {
      orgId: tenant.id, code: "STE-1001", name: "Garuda HQ", type: "Head Office",
      country: "ID", address: "Jl. Industri Raya No. 1, Bekasi", status: "Active", isPrimary: true,
      description: null, contactPerson: "Tenant Admin", contactEmail: "admin@garuda.id", contactPhone: null,
    },
  });
  // Two more sites (OD PT Hammer Industries: Head Office/Factory A/Warehouse,
  // app.html:14987) so the Work Units seed below (`wuSeedIfNeeded`,
  // 9132-9181) has somewhere to distribute its 3 site indices across.
  const [siteFactory] = await Site.findOrCreate({
    where: { code: "STE-1002" },
    defaults: {
      orgId: tenant.id, code: "STE-1002", name: "Garuda Factory A", type: "Factory",
      country: "ID", address: "Kawasan Industri MM2100, Bekasi", status: "Active", isPrimary: false,
      description: "Primary production facility — assembly and finishing lines.", contactPerson: "Tenant Admin", contactEmail: "admin@garuda.id", contactPhone: null,
    },
  });
  const [siteWarehouse] = await Site.findOrCreate({
    where: { code: "STE-1003" },
    defaults: {
      orgId: tenant.id, code: "STE-1003", name: "Garuda Warehouse", type: "Warehouse",
      country: "ID", address: "Jl. Raya Cakung 88, Bekasi", status: "Active", isPrimary: false,
      description: "Finished-goods storage and distribution hub.", contactPerson: "Tenant Admin", contactEmail: "admin@garuda.id", contactPhone: null,
    },
  });

  // 10. Phase 5 — billing demo data: plans, a paid + an unpaid invoice for the
  //     tenant, and a partner revenue-share statement computed from the paid
  //     invoice (Gold tier → 20%). Internally consistent so KPIs reconcile.
  const plans = [
    { code: "PLN-0001", name: "Starter", description: "Entry plan for small organizations and single-site tenants.", frequency: "Monthly" as const, status: "Active" as const },
    { code: "PLN-0002", name: "Professional", description: "Multi-site implementation with standard framework support.", frequency: "Monthly" as const, status: "Active" as const },
    { code: "PLN-0003", name: "Enterprise", description: "Unlimited sites, priority support, and advanced frameworks.", frequency: "Annual" as const, status: "Active" as const },
  ];
  for (const p of plans) await Plan.findOrCreate({ where: { code: p.code }, defaults: p });

  const [paidInvoice] = await Invoice.findOrCreate({
    where: { number: "INV-2026-0001" },
    defaults: {
      number: "INV-2026-0001", orgId: tenant.id, period: "January 2026",
      periodStart: "2026-01-01", periodEnd: "2026-01-31", amount: 12000000, currency: "IDR",
      status: "Paid", paidDate: "2026-02-05", dueDate: null,
    },
  });
  await Invoice.findOrCreate({
    where: { number: "INV-2026-0002" },
    defaults: {
      number: "INV-2026-0002", orgId: tenant.id, period: "February 2026",
      periodStart: "2026-02-01", periodEnd: "2026-02-28", amount: 12000000, currency: "IDR",
      status: "Unpaid", paidDate: null, dueDate: "2026-03-14",
    },
  });
  void paidInvoice;

  // Revenue-share statement + pending payout for the distributor (idempotent:
  // only generate when none exists yet for this partner).
  const existingStmt = await import("../models").then((m) =>
    m.RevenueShareStatement.findOne({ where: { partnerOrgId: distributor.id } }),
  );
  if (!existingStmt) await generateStatementForPartner(distributor.id, "January 2026");

  // 11. Phase 6 — OD's 8 seeded support tickets (`seedTickets`, app.html:26557-
  //     15505), spanning all 5 statuses and 4 priorities across tenant + partner
  //     scope. OD's four flavor orgs (PT Hammer Industries / PT Parker Industries
  //     / PT Damage Control / PT Stark Industries) map onto our seeded orgs:
  //     Hammer/Parker → the existing Garuda/Nusantara pair; Damage Control/Stark
  //     are a second, independent partner+tenant pair created here solely to
  //     reproduce OD's cross-partner ticket-isolation scenario (a partner must
  //     never see another partner's managed-tenant tickets).
  const [stark] = await Organization.findOrCreate({
    where: { code: "STARKIND" },
    defaults: {
      name: "PT Stark Industries", code: "STARKIND", type: "Distributor", status: "Active",
      parentOrgId: so.id, tenantId: null, email: "ops@starkindustries.com", phone: null, website: null, country: "US", address: null,
    },
  });
  const [damageControl] = await Organization.findOrCreate({
    // OD `idtn1` / `TEN-1001` (open-design core.js:6870).
    where: { code: "DMGCTRL" },
    defaults: {
      name: "PT Damage Control", code: "DMGCTRL", type: "Tenant", status: "Active",
      parentOrgId: stark.id, tenantId: null, email: "ops@damagecontrol.co.id", phone: null, website: null, country: "ID", address: null,
    },
  });
  const TICKET_ORGS: Record<string, string> = { tenant: tenant.id, distributor: distributor.id, damageControl: damageControl.id, stark: stark.id };
  const ticketSeed: {
    code: string; subject: string; description: string; category: string; priority: string; status: string;
    scope: "sp" | "partner" | "tenant"; orgTag: string; managedBy: string | null;
    createdBy: { name: string; email: string }; assignedTo: string | null;
    messages: { author: { name: string; kind: "user" | "support" }; text: string; ts: string }[];
    activity: { event: string; ts: string }[];
    attachments: { name: string; size: number; date: string }[];
  }[] = [
    {
      code: "TKT-2026-0001", subject: "Cannot Activate Tenant Administrator", description: "The activation link for our administrator account returns an error when clicked. Please advise.",
      category: "Technical Support", priority: "High", status: "In Progress",
      scope: "tenant", orgTag: "tenant", managedBy: "Nusantara Partners",
      createdBy: { name: "Jennifer Susan Walters", email: "nicole@hammerind.co.id" }, assignedTo: "Nicholas Joseph Fury",
      messages: [{ author: { name: "Jennifer Susan Walters", kind: "user" }, text: "Hi, our admin can’t activate — the link errors out. Screenshot attached.", ts: "2026-06-02T09:00:00.000Z" }, { author: { name: "Nicholas Joseph Fury", kind: "support" }, text: "Thanks Maria, we’re looking into it. Could you confirm the email address the link was sent to?", ts: "2026-06-02T14:00:00.000Z" }, { author: { name: "Jennifer Susan Walters", kind: "user" }, text: "It was sent to maria@hammerind.co.id.", ts: "2026-06-02T16:00:00.000Z" }],
      activity: [{ event: "Ticket created", ts: "2026-06-02T09:00:00.000Z" }, { event: "Assigned to Raka Pratama", ts: "2026-06-02T12:00:00.000Z" }, { event: "Status changed to In Progress", ts: "2026-06-02T12:00:00.000Z" }],
      attachments: [{ name: "activation-error.png", size: 184320, date: "2026-06-02T09:00:00.000Z" }],
    },
    {
      code: "TKT-2026-0002", subject: "Invoice Status Incorrect", description: "INV-2026-0007 shows as unpaid but we have completed the bank transfer.",
      category: "Billing", priority: "Medium", status: "Waiting for Customer",
      scope: "tenant", orgTag: "tenant", managedBy: "Nusantara Partners",
      createdBy: { name: "Jennifer Susan Walters", email: "nicole@hammerind.co.id" }, assignedTo: "Natalia Alianovna Romanova",
      messages: [{ author: { name: "Jennifer Susan Walters", kind: "user" }, text: "Our May invoice still shows unpaid after payment.", ts: "2026-06-05T10:00:00.000Z" }, { author: { name: "Natalia Alianovna Romanova", kind: "support" }, text: "Could you share the transfer reference number so we can match it?", ts: "2026-06-05T18:00:00.000Z" }],
      activity: [{ event: "Ticket created", ts: "2026-06-05T10:00:00.000Z" }, { event: "Assigned to Dewi Lestari", ts: "2026-06-05T18:00:00.000Z" }, { event: "Status changed to Waiting for Customer", ts: "2026-06-05T18:00:00.000Z" }],
      attachments: [],
    },
    {
      code: "TKT-2026-0003", subject: "Need Assistance with Partner Onboarding", description: "We would like guidance on onboarding our first batch of tenants.",
      category: "Commercial", priority: "Medium", status: "Open",
      scope: "partner", orgTag: "distributor", managedBy: null,
      createdBy: { name: "Anthony Edward Stark", email: "leonardo@starkindustries.com" }, assignedTo: null,
      messages: [{ author: { name: "Anthony Edward Stark", kind: "user" }, text: "Hello, can someone walk us through onboarding tenants under our partnership?", ts: "2026-06-07T13:00:00.000Z" }],
      activity: [{ event: "Ticket created", ts: "2026-06-07T13:00:00.000Z" }],
      attachments: [],
    },
    {
      code: "TKT-2026-0004", subject: "Document Upload Error", description: "Uploading a PDF over 5MB fails silently.",
      category: "Bug Report", priority: "High", status: "Resolved",
      scope: "tenant", orgTag: "tenant", managedBy: "Nusantara Partners",
      createdBy: { name: "Jennifer Susan Walters", email: "nicole@hammerind.co.id" }, assignedTo: "Nicholas Joseph Fury",
      messages: [{ author: { name: "Jennifer Susan Walters", kind: "user" }, text: "Large PDF uploads fail with no message.", ts: "2026-06-01T08:00:00.000Z" }, { author: { name: "Nicholas Joseph Fury", kind: "support" }, text: "Fixed in the latest release — please retry and confirm.", ts: "2026-06-01T20:00:00.000Z" }, { author: { name: "Jennifer Susan Walters", kind: "user" }, text: "Working now, thank you!", ts: "2026-06-02T09:00:00.000Z" }],
      activity: [{ event: "Ticket created", ts: "2026-06-01T08:00:00.000Z" }, { event: "Status changed to In Progress", ts: "2026-06-01T20:00:00.000Z" }, { event: "Ticket resolved", ts: "2026-06-02T09:00:00.000Z" }],
      attachments: [],
    },
    {
      code: "TKT-2026-0005", subject: "Feature Request: Bulk Site Import", description: "Could we import sites via CSV for large tenants?",
      category: "Feature Request", priority: "Low", status: "Open",
      scope: "partner", orgTag: "distributor", managedBy: null,
      createdBy: { name: "Anthony Edward Stark", email: "leonardo@starkindustries.com" }, assignedTo: null,
      messages: [{ author: { name: "Anthony Edward Stark", kind: "user" }, text: "A CSV bulk site import would save us a lot of time.", ts: "2026-06-08T11:00:00.000Z" }],
      activity: [{ event: "Ticket created", ts: "2026-06-08T11:00:00.000Z" }],
      attachments: [],
    },
    {
      code: "TKT-2026-0006", subject: "Need Help Assigning Framework", description: "How do we map ISO 9001 to a specific site?",
      category: "General Inquiry", priority: "Medium", status: "Closed",
      scope: "tenant", orgTag: "tenant", managedBy: "Nusantara Partners",
      createdBy: { name: "Jennifer Susan Walters", email: "nicole@hammerind.co.id" }, assignedTo: "Matthew Michael Murdock",
      messages: [{ author: { name: "Jennifer Susan Walters", kind: "user" }, text: "Where do I assign a framework to our factory site?", ts: "2026-06-01T09:00:00.000Z" }, { author: { name: "Matthew Michael Murdock", kind: "support" }, text: "Frameworks are assigned per site — this is coming soon to your workspace.", ts: "2026-06-01T13:00:00.000Z" }],
      activity: [{ event: "Ticket created", ts: "2026-06-01T09:00:00.000Z" }, { event: "Ticket resolved", ts: "2026-06-01T18:00:00.000Z" }, { event: "Ticket closed", ts: "2026-06-02T12:00:00.000Z" }],
      attachments: [],
    },
    {
      code: "TKT-2026-0007", subject: "Critical: Tenant Cannot Sign In", description: "All users at PT Damage Control are locked out after the maintenance window.",
      category: "Technical Support", priority: "Critical", status: "In Progress",
      scope: "tenant", orgTag: "damageControl", managedBy: "PT Stark Industries",
      createdBy: { name: "Janet van Dyne", email: "sandra@damagecontrol.co.id" }, assignedTo: "Nicholas Joseph Fury",
      messages: [{ author: { name: "Janet van Dyne", kind: "user" }, text: "Nobody can sign in since this morning. This is urgent.", ts: "2026-06-09T08:00:00.000Z" }, { author: { name: "Nicholas Joseph Fury", kind: "support" }, text: "Escalated and investigating now — we’ll update within the hour.", ts: "2026-06-09T14:00:00.000Z" }],
      activity: [{ event: "Ticket created", ts: "2026-06-09T08:00:00.000Z" }, { event: "Assigned to Raka Pratama", ts: "2026-06-09T09:00:00.000Z" }, { event: "Status changed to In Progress", ts: "2026-06-09T14:00:00.000Z" }],
      attachments: [],
    },
    {
      code: "TKT-2026-0008", subject: "Billing Inquiry — Revenue Share", description: "Requesting a breakdown of our Q2 revenue share statements.",
      category: "Billing", priority: "Medium", status: "Resolved",
      scope: "partner", orgTag: "distributor", managedBy: null,
      createdBy: { name: "Anthony Edward Stark", email: "leonardo@starkindustries.com" }, assignedTo: "Natalia Alianovna Romanova",
      messages: [{ author: { name: "Anthony Edward Stark", kind: "user" }, text: "Can we get a breakdown of our revenue share for Q2?", ts: "2026-06-04T10:00:00.000Z" }, { author: { name: "Natalia Alianovna Romanova", kind: "support" }, text: "Statement summary attached — let us know if you need more detail.", ts: "2026-06-04T15:00:00.000Z" }],
      activity: [{ event: "Ticket created", ts: "2026-06-04T10:00:00.000Z" }, { event: "Ticket resolved", ts: "2026-06-06T15:00:00.000Z" }],
      attachments: [{ name: "q2-revenue-share.xlsx", size: 48128, date: "2026-06-06T15:00:00.000Z" }],
    },
  ];
  for (const t of ticketSeed) {
    await Ticket.findOrCreate({
      where: { code: t.code },
      defaults: {
        code: t.code, subject: t.subject, description: t.description,
        category: t.category as never, priority: t.priority as never, status: t.status as never,
        scope: t.scope, orgId: TICKET_ORGS[t.orgTag], managedBy: t.managedBy,
        createdBy: t.createdBy, assignedTo: t.assignedTo,
        messages: t.messages, activity: t.activity, attachments: t.attachments,
      },
    });
  }

  // 12. Phase 7 — framework meta-model: the OD compliance-engine seed content —
  //     framework groups, the 9 OD frameworks, the full requirement catalogues
  //     with clause text, the 27 canonical FWEs (21 Core + 6 Extension), the
  //     CQ/CQR library, requirement criteria, and the FWRC statement rows
  //     (see src/db/seeders/complianceEngine.ts and the generated
  //     complianceEngine.*.data.ts modules). Returns the handles the Phase 8
  //     demo assessment below wires against.
  const { iso27001, auditEl, riskEl, q1, q1r5, qRisk, qRiskR0, crit5, critR0 } = await seedComplianceEngine();

  // 12b. ISRA + SoA (F-2b) — global reference-library seed: the 93-row Annex A
  //      master, Threat/Vuln libraries, the Primary/Secondary asset taxonomy
  //      and its asset libraries, the re-derived V2 knowledge maps, the
  //      1,950-row Vuln→Annex A map, RTP treatment templates, and the KM
  //      publish-state singleton (see src/db/seeders/isra.ts). Global (no
  //      org_id) — no tenant/demo wiring needed here.
  const isra = await seedIsraLibrary();
  // eslint-disable-next-line no-console
  console.log(
    `[seed] ISRA — annexA ${isra.annexA}, threats ${isra.threats}, vulns ${isra.vulns}, ` +
      `taxonomy pa ${isra.taxonomy.paGroups}/${isra.taxonomy.paSubgroups} sa ${isra.taxonomy.saGroups}/${isra.taxonomy.saSubgroups}, ` +
      `assets ${isra.taxonomy.primary} primary / ${isra.taxonomy.secondary} secondary, ` +
      `km ${isra.kmSaThreat.seeded}+${isra.kmThreatVuln.seeded}+${isra.kmVulnControl}, treatTemplates ${isra.treatTemplates}`,
  );

  // 12b-ii. ISRA tenant demo workspace — OD's generated demo risk register on
  //      top of that library, scoped to the demo tenant (see
  //      src/db/seeders/israTenantDemo.ts). Seeds only into an empty register,
  //      so it never overwrites edits made in the demo workspace.
  const israDemo = await seedIsraTenantDemo(tenant.id);
  // eslint-disable-next-line no-console
  console.log(
    israDemo.skipped
      ? "[seed] ISRA demo workspace — already populated, skipped"
      : `[seed] ISRA demo workspace — scenarios ${israDemo.scenarios}, vulns ${israDemo.vulns}, impacts ${israDemo.impacts}, ` +
        `existingControls ${israDemo.existingControls}, treatments ${israDemo.treatments}, rtps ${israDemo.rtps}/${israDemo.rtpActions} actions, ` +
        `assetMaps ${israDemo.assetMaps}, evidence ${israDemo.evidence}, audit ${israDemo.audit}, initiatives ${israDemo.initiatives}, ` +
        `baseline ${israDemo.controlBaseline}` +
        (israDemo.skippedScenarios || israDemo.skippedVulns || israDemo.skippedBaseline
          ? ` — SKIPPED (missing library FK): scenarios ${israDemo.skippedScenarios}, vulns ${israDemo.skippedVulns}, baseline ${israDemo.skippedBaseline}`
          : ""),
  );

  // 12c. Marketing CMS (SOF-336) — OD's `cmsSeedIfNeeded()` demo content
  //      (pages/posts/media/menu), owned by the AXIA ServiceOwner org since
  //      it describes the VIBES marketing site itself (see src/db/seeders/cms.ts).
  await seedCms(so.id);

  // 12d. Business Process catalog (SOF-381) — OD's `bpCatSeedIfNeeded()`
  //      385-row master catalog (`db.bpCatalog`), materialised into the demo
  //      tenant's ISO 4.4 process register (see src/db/seeders/businessProcess.ts).
  await seedBpCatalog(tenant.id);

  // 12d-2. OD `seedTenants()` (open-design core.js:6867-6900) — the remaining
  //        three of OD's five tenant organizations. `TEN-1001` (PT Damage
  //        Control) and `TEN-1005` (the Hammer persona, seeded above as Garuda
  //        Manufacturing) already existed; `TEN-1002`/`TEN-1003`/`TEN-1004` had
  //        no org at all, which is why `dataParity.ts` had to drop OD's
  //        SUB-1004/1005/1006 + WS-1004/1005/1006 + PIPE-1002/1003/1004 rows.
  //
  //        Codes, names, acquisition, contact details, billing plan and audit
  //        trails are OD verbatim. Each tenant's OD `admin` becomes a User row
  //        (no password, no Role) so the Tenants list has an administrator to
  //        show — roster entries, not login principals, exactly as
  //        `odPartners.ts` seeds partner staff.
  //
  //        One deliberate omission: OD's per-tenant `sites[]`. OD's `site()`
  //        helper (core.js:6868) derives `STE-1003`..`STE-1008` for them and
  //        `Site.code` is globally unique here — `STE-1003` is already the
  //        Garuda Warehouse seeded above. Site parity is its own slice.
  const OD_TENANTS = [
    {
      odId: "idtn2", code: "TEN-1002", name: "PT Alchemax", acquisition: "Direct" as const,
      partnerOrgCode: null, email: "admin@alchemax.co.id", phone: "+62 31 5550 2000",
      website: "alchemax.co.id", country: "ID", address: "Jl. Rungkut Industri 5, Surabaya",
      orgStatus: "Active" as const, profileStatus: "Active" as const,
      createdAt: odMay(4), updatedAt: odMay(12),
      admin: { fullName: "Samuel Thomas Wilson", username: "xavier.admin", email: "xavier@alchemax.co.id", status: "Active" as const },
      billing: { plan: "Enterprise · Annual", status: "Active" },
      audit: [
        { ts: odMay(12).toISOString(), msg: 'Site "Makassar Branch" created' },
        { ts: odMay(5).toISOString(), msg: "Tenant Administrator activated account" },
        { ts: odMay(4).toISOString(), msg: "Tenant organization created (Direct)" },
      ],
    },
    {
      // OD seeds `idtn3` as Pending Activation, then `saasProvSeedIfNeeded()`
      // flips it (and its admin) to Active — "activate the one legacy
      // Pending-Activation tenant — new model provisions to Active on payment"
      // (core.js:2941). SUB-1006/WS-1006 are seeded for it below, so Active is
      // the post-seed OD state.
      odId: "idtn3", code: "TEN-1003", name: "PT Brand Corporation", acquisition: "Direct" as const,
      partnerOrgCode: null, email: "it@brandcorp.co.id", phone: "+62 22 5550 3000",
      website: "brandcorp.co.id", country: "ID", address: "Jl. Soekarno Hatta 88, Bandung",
      orgStatus: "Active" as const, profileStatus: "Active" as const,
      createdAt: odMay(14), updatedAt: odMay(14),
      admin: { fullName: "Elizabeth Ross", username: "julia.admin", email: "julia@brandcorp.co.id", status: "Active" as const },
      billing: { plan: "Growth · Annual", status: "Pending" },
      audit: [
        { ts: odMay(14).toISOString(), msg: "Activation email sent" },
        { ts: odMay(14).toISOString(), msg: 'Primary site "Bandung Plant" created' },
        { ts: odMay(14).toISOString(), msg: "Tenant organization created (Direct)" },
      ],
    },
    {
      // OD `partnerId:'idpr4'` — `odPartners.ts` seeds that partner as
      // `PRT-1004` / org code `ROXXON`.
      odId: "idtn4", code: "TEN-1004", name: "PT Cross Technological Enterprises", acquisition: "Partner" as const,
      partnerOrgCode: "ROXXON", email: "admin@cte.co.id", phone: "+62 361 5550 4000",
      website: "cte.co.id", country: "ID", address: "Jl. Bypass Ngurah Rai No. 100, Denpasar, Bali",
      orgStatus: "Suspended" as const, profileStatus: "Suspended" as const,
      createdAt: odMay(1), updatedAt: odMay(15),
      admin: { fullName: "Clinton Francis Barton", username: "lionel.admin", email: "lionel@cte.co.id", status: "Suspended" as const },
      billing: { plan: "Starter · Annual", status: "Partner-managed" },
      audit: [
        { ts: odMay(15).toISOString(), msg: "Tenant suspended" },
        { ts: odMay(2).toISOString(), msg: "Tenant Administrator activated account" },
        { ts: odMay(1).toISOString(), msg: "Tenant organization created (Partner: Roxxon Energy GmbH)" },
      ],
    },
  ];
  // `idpr4` — seeded by `seedOdPartners` in step 8b, well before this point.
  const roxxonPartner = await Organization.findOne({ where: { code: "ROXXON" } });
  if (!roxxonPartner) throw new Error("Partner org ROXXON (OD idpr4) missing — seedOdPartners must run first");
  const odTenantOrgIdByOdId = new Map<string, string>();
  for (const t of OD_TENANTS) {
    const partnerOrg = t.partnerOrgCode === "ROXXON" ? roxxonPartner : null;
    const [org] = await Organization.findOrCreate({
      where: { code: t.code },
      defaults: {
        name: t.name, code: t.code, type: "Tenant", status: t.orgStatus,
        parentOrgId: partnerOrg?.id ?? so.id, tenantId: null,
        email: t.email, phone: t.phone, website: t.website, country: t.country, address: t.address,
        createdAt: t.createdAt, updatedAt: t.updatedAt,
      },
    });
    odTenantOrgIdByOdId.set(t.odId, org.id);
    const [adminUser] = await User.findOrCreate({
      where: { email: t.admin.email },
      defaults: {
        orgId: org.id, tenantId: org.id, fullName: t.admin.fullName, username: t.admin.username,
        email: t.admin.email, passwordHash: null, status: t.admin.status, position: "Administrator",
        workUnit: null, lastLogin: null, activationToken: null, resetToken: null, resetExpires: null,
        provisioned: true, createdAt: t.createdAt,
      },
    });
    await TenantProfile.findOrCreate({
      where: { orgId: org.id },
      defaults: {
        orgId: org.id, acquisition: t.acquisition, partnerOrgId: partnerOrg?.id ?? null,
        billingOwner: t.acquisition === "Partner" ? (partnerOrg?.name ?? null) : t.admin.fullName,
        status: t.profileStatus, subscriptionSummary: null, adminUserId: adminUser.id,
        billing: t.billing, audit: t.audit,
      },
    });
  }

  const odTenantOrg = (odId: string): string => {
    const id = odTenantOrgIdByOdId.get(odId);
    if (!id) throw new Error(`OD tenant ${odId} was not seeded`);
    return id;
  };

  // 12e. SOF-389 (data parity) — the 5 OD `db.*` collections that map 1:1 to
  //      an existing model but had zero seeded rows: saasSubs/saasWorkspaces/
  //      saasPipeline (see src/db/seeders/dataParity.ts), siteRequests, and
  //      tenantRoles. Reuses the tenant/distributor (Hammer persona) and
  //      damageControl/stark (Damage Control persona) orgs from steps 7 & 11,
  //      plus OD's TEN-1002/1003/1004 tenants from step 12d-2.
  const dataParityOrgIds = {
    hammerTenantId: tenant.id, hammerPartnerId: distributor.id,
    dcTenantId: damageControl.id, dcPartnerId: stark.id,
    // OD idtn2/idtn3/idtn4 + idpr4, from step 12d-2 / `odPartners.ts`.
    alchemaxTenantId: odTenantOrg("idtn2"),
    brandCorpTenantId: odTenantOrg("idtn3"),
    crossTechTenantId: odTenantOrg("idtn4"),
    crossTechPartnerId: roxxonPartner.id,
  };
  await seedSaasLifecycle(dataParityOrgIds);
  await seedSiteRequests(dataParityOrgIds);
  await seedTenantRoles(tenant.id);

  // 12f. SOF-399 (child of SOF-334/SOF-388) — db.roles/db.roleAssignments,
  //      the mixed-shape collection split across CompetenceRole/RoleTemplate
  //      per the SOF-388 mapping design (see src/db/seeders/competenceRoles.ts).
  //      Must run after seedTenantRoles (needs its RoleTemplate rows for the
  //      shape-B roleId resolution).
  await seedCompetenceRolesAndAssignments(tenant.id, so.id);

  // 12f-2. Personnel/Competence tenant registers (SOF-322 gap) — OD's `db.aw*` (Awareness
  //        workspace: topics/programs/campaigns, with acks/evals nested into the campaign),
  //        `db.trainingPlans` (Training Plan workspace), and `db.assessments`/`db.gaps`
  //        (Competence Assessments/Gaps). `db.compTraining` is NOT seeded here — it's the
  //        global training catalog already seeded lazily by `ensureTrainingCatalogSeed()`.
  //        Must run after `seedCompetenceRolesAndAssignments` (needs its CompetenceAssignment
  //        rows to resolve OD's personId -> assignment/role); assessments/gaps must seed before
  //        training plans (the plan cross-links to the real gap/assessment id, and the gap in
  //        turn is patched with the real training-plan id once it exists).
  const { assessmentIdMap, gapIdMap } = await seedCompetenceAssessmentsAndGaps(tenant.id, so.id);
  await seedTrainingPlans(tenant.id, so.id, assessmentIdMap, gapIdMap);
  await seedAwareness(tenant.id, so.id);

  // 12g. SOF-407 (design: SOF-386) — Enterprise org structure (32 `OrgUnit`
  //      rows + synthetic lead roster) and the Delegation-of-Authority spend
  //      matrix (22 `DoaMatrixEntry` rows). Demo tenant org only (not `so`,
  //      the AXIA ServiceOwner org). seedOrgUnits must run first — doaMatrix's
  //      Finance band looks up the tier-A/L1 CEO user it creates.
  await seedOrgUnits(tenant.id);
  await seedDoaMatrix(tenant.id);

  // 13. Phase 8 — a finalized demo assessment for the tenant against ISO 27001.
  //     Internal Audit answered "mature" (score 5, no gap); Risk Assessment
  //     answered "ad hoc" (score 0 → High gap → Risk Management module).
  //     maturity = (5 + 0) / 2 = 2.5.
  const tenantSite = await Site.findOne({ where: { code: "STE-1001" } });
  // Framework assignment so the tenant can start a new assessment from the UI.
  if (tenantSite) {
    await FrameworkAssignment.findOrCreate({
      where: { code: "FA-1001" },
      defaults: { orgId: tenant.id, code: "FA-1001", siteId: tenantSite.id, frameworkId: iso27001.id, status: "Active", assignedDate: "2026-01-15", notes: null },
    });
  }
  // OD PT Hammer Industries' remaining 3 site↔framework assignments
  // (core.js:6904 audit trail): ISO 9001:2015 → Head Office, ISO 14001:2015 →
  // Factory A, ISO 45001:2018 → Warehouse. FA-1001 above covers ISO/IEC
  // 27001:2022 → Head Office — together the 4 match OD 1:1.
  const extraFas: { code: string; frameworkName: string; site: typeof siteHq }[] = [
    { code: "FA-1002", frameworkName: "ISO 9001:2015", site: siteHq },
    { code: "FA-1003", frameworkName: "ISO 14001:2015", site: siteFactory },
    { code: "FA-1004", frameworkName: "ISO 45001:2018", site: siteWarehouse },
  ];
  for (const fa of extraFas) {
    const fw = await Framework.findOne({ where: { name: fa.frameworkName } });
    if (fw && fa.site) {
      await FrameworkAssignment.findOrCreate({
        where: { code: fa.code },
        defaults: { orgId: tenant.id, code: fa.code, siteId: fa.site.id, frameworkId: fw.id, status: "Active", assignedDate: "2026-01-15", notes: null },
      });
    }
  }
  const [demoAssessment, demoCreated] = await Assessment.findOrCreate({
    where: { code: "ASM-1001" },
    defaults: {
      code: "ASM-1001", orgId: tenant.id, siteId: tenantSite?.id ?? null, frameworkId: iso27001.id,
      title: "Assessment — ISO/IEC 27001:2022", status: "Completed", version: 1,
      maturityScore: 2.5, startedAt: new Date(), completedAt: new Date(),
    },
  });
  if (demoCreated) {
    await AssessmentAnswer.create({ assessmentId: demoAssessment.id, questionId: q1.id, responseId: q1r5.id, criterionId: crit5.id, score: 5 });
    await AssessmentAnswer.create({ assessmentId: demoAssessment.id, questionId: qRisk.id, responseId: qRiskR0.id, criterionId: critR0.id, score: 0 });
    await Gap.create({
      assessmentId: demoAssessment.id, elementId: riskEl.id, elementName: riskEl.name, score: 0, severity: "High",
      recommendedModuleKey: "risk-management", recommendedModuleLabel: "Risk Management", recommendedRoute: "/implementation/risks",
    });
  }

  // 14. Phase 9 — a few ISO clause-register entries for the tenant so the
  //     Management-System registers render real data on first load.
  // OD `ocSeedIfNeeded` (core.js:9138–9219) — the four §4.1 context issues,
  // codes from `ocNewId()` (FWE-001-N). Issues 2 & 3 were raised as risks one
  // day after posting (RISK-0001 / RISK-0002); `riskMethodSeedIfNeeded`
  // (10488) then re-raises issues 1–3 as RISK-0003/0004/0005, overwriting
  // `linkedRiskId` and unshifting a newer "Raised as risk" entry — seeded
  // here as that END state. The newest issue carries OD's 24-entry demo
  // activity log, the cloud issue the long worked-demo remarks. OD `comments`
  // have no field here — dropped.
  const msRelIso = (n: number): string => new Date(Date.now() - n * 86400000).toISOString();
  const ocActors = ["Jennifer Susan Walters", "Peter Benjamin Parker", "Wanda Maximoff", "Robert Bruce Banner", "Carol Susan Jane Danvers", "Natalia Alianovna Romanova"];
  const ocLeadTmpl: [string, string][] = [
    ["Issue created", "Issue posted"],
    ["Comment added", "Flagged for quality team review"],
    ["Framework relevance changed", "Added ISO 14001:2015"],
    ["Issue edited", "Refined topic wording"],
    ["Status changed", "Open → Monitored"],
    ["Comment added", "Requested an owner be assigned"],
    ["Issue edited", "Updated domain to include Market"],
    ["Comment added", "Linked to the upcoming surveillance audit"],
    ["Issue edited", "Added supporting description"],
    ["Status changed", "Monitored → Open"],
    ["Comment added", "Discussed at the weekly QMS sync"],
    ["Framework relevance changed", "Removed a duplicate framework tag"],
    ["Issue edited", "Clarified scope of impact"],
    ["Comment added", "Awaiting management input"],
    ["Status changed", "Open → Monitored"],
    ["Issue edited", "Updated category context"],
    ["Comment added", "Evidence gathering in progress"],
    ["Issue edited", "Adjusted framework relevance"],
    ["Comment added", "Reviewed against ISO 9001:2015 clause 4.1"],
    ["Status changed", "Monitored → Open"],
    ["Issue edited", "Minor wording correction"],
    ["Comment added", "Pending decision on risk escalation"],
    ["Issue reviewed", "Periodic context review completed"],
    ["Comment added", "No further action required at this time"],
  ];
  const ocLeadActivity = ocLeadTmpl.map(([action, summary], k) => ({ ts: new Date(Date.now() - (24 - k) * 0.66 * 86400000).toISOString(), user: ocActors[k % ocActors.length], action, summary }));
  // OD ocSeedIfNeeded worked-demo `remarks` on the cloud-reliance issue, verbatim.
  const ocCloudRemarks = "Migration of core registration, records and analytics workloads to third-party cloud platforms has accelerated over the past two quarters. While this improves scalability and resilience, it also shifts parts of our security control boundary to the provider and introduces new considerations we must actively manage:\n\n• Data residency and sovereignty — customer personal data may be processed or replicated across regions with differing legal regimes; contractual and configuration controls must keep processing within approved jurisdictions.\n• Shared-responsibility gaps — provider secures the platform, but tenant configuration (IAM, network policy, key management, logging) remains our responsibility and is a common source of exposure.\n• Identity and access — federated SSO, service accounts and API tokens broaden the attack surface; least-privilege, short-lived credentials and periodic access reviews are required.\n• Third-party dependency and lock-in — availability and continuity now depend on the provider’s SLAs and our exit/portability plans.\n\nThis issue is monitored through the information security risk assessment (linked risk) and reviewed at each management review; framework relevance spans ISO/IEC 27001:2022 and ISO/IEC 27701:2025.";
  // OD `polSeedIfNeeded` (core.js:12234): one shared effective date, 4 days
  // ago, with the next review one year out (`polNextReview`, freq "Annually").
  const polEffD = new Date(Date.now() - 4 * 86400000);
  const polEff = polEffD.toISOString();
  const polNextD = new Date(polEffD);
  polNextD.setMonth(polNextD.getMonth() + 12);
  const polNext = polNextD.toISOString();
  const msSeed: { module: string; code: string; title: string; status: string; owner: string | null; data: Record<string, unknown>; elementId?: string | null; frameworks?: string[] }[] = [
    { module: "context", code: "FWE-001-1", title: "New customer requirements and regulatory expectations are increasing the need for stronger documented quality controls.", status: "Open", owner: "Jennifer Susan Walters", frameworks: ["ISO 9001:2015", "ISO 14001:2015"], data: { category: "External Issues", domains: ["Regulatory", "Market"], postedBy: "Jennifer Susan Walters", raisedAsRisk: true, linkedRiskId: "RISK-0003", activity: [{ ts: msRelIso(9), user: "Jennifer Susan Walters", action: "Raised as risk", summary: "Linked risk RISK-0003" }, ...ocLeadActivity] } },
    { module: "context", code: "FWE-001-2", title: "Increased reliance on cloud-based systems introduces new information security and privacy considerations.", status: "Monitored", owner: "Peter Benjamin Parker", frameworks: ["ISO/IEC 27001:2022", "ISO/IEC 27701:2025"], data: { category: "External Issues", domains: ["Technological", "Regulatory"], postedBy: "Peter Benjamin Parker", description: ocCloudRemarks, raisedAsRisk: true, linkedRiskId: "RISK-0004", activity: [{ ts: msRelIso(13), user: "Gwendolyne Maxine Stacy", action: "Raised as risk", summary: "Linked risk RISK-0004" }, { ts: msRelIso(5), user: "Peter Benjamin Parker", action: "Raised as risk", summary: "Linked risk RISK-0001" }, { ts: msRelIso(6), user: "Peter Benjamin Parker", action: "Issue created", summary: "Issue posted" }] } },
    { module: "context", code: "FWE-001-3", title: "Limited availability of trained personnel may affect the consistency of process implementation.", status: "Monitored", owner: "Jennifer Susan Walters", frameworks: ["ISO 9001:2015", "ISO 45001:2018"], data: { category: "Internal Issues", domains: ["Human Resources", "Operational"], postedBy: "Jennifer Susan Walters", raisedAsRisk: true, linkedRiskId: "RISK-0005", activity: [{ ts: msRelIso(17), user: "Jennifer Susan Walters", action: "Raised as risk", summary: "Linked risk RISK-0005" }, { ts: msRelIso(8), user: "Jennifer Susan Walters", action: "Raised as risk", summary: "Linked risk RISK-0002" }, { ts: msRelIso(9), user: "Jennifer Susan Walters", action: "Issue created", summary: "Issue posted" }] } },
    { module: "context", code: "FWE-001-4", title: "Several operational records are still maintained in spreadsheets, creating traceability and version control challenges.", status: "Open", owner: "Wanda Maximoff", frameworks: ["ISO 9001:2015", "ISO/IEC 27001:2022"], data: { category: "Internal Issues", domains: ["Information Systems", "Infrastructure"], postedBy: "Wanda Maximoff", activity: [{ ts: msRelIso(13), user: "Wanda Maximoff", action: "Issue created", summary: "Issue posted" }] } },
    // Risks 1:1 with OD's seeded register: `ocSeedIfNeeded` (core.js:9138)
    // raises RISK-0001/0002 from the cloud-reliance and trained-personnel
    // context issues (RISK-0001 then enriched by `riskDemoEnrich`,
    // core.js:10541 — long description, High priority, In Treatment and a
    // 5-action treatment plan); `riskMethodSeedIfNeeded` (core.js:10488) adds
    // RISK-0003..0010 from the first three context issues, first three
    // interested-party requirements and the Change Management / Internal
    // Audit business processes (owner rotation over PT Hammer's 4-person
    // team, day offsets 9+4·idx).
    { module: "risks", code: "RISK-0001", title: "Increased reliance on cloud-based systems introduces new information security and privacy considerations", status: "In Treatment", owner: "Peter Benjamin Parker", frameworks: ["ISO/IEC 27001:2022", "ISO/IEC 27701:2025"], elementId: riskEl.id, data: {
      category: "Quality Risks", source: "Organizational Context", sourceIssueId: "FWE-001-2", issueCategory: "External Issues",
      domains: ["Technological", "Regulatory"], methodology: "basic", likelihood: null, impact: null, priority: "High",
      raisedBy: "Peter Benjamin Parker", raisedDate: msRelIso(5),
      description: "Increased reliance on third-party cloud platforms for core registration, records and analytics workloads concentrates operational and information-security risk in a provider outside our direct control. A prolonged outage, a tenant-side misconfiguration, or a security incident at the provider could interrupt service delivery, expose customer data, or breach contractual and regulatory obligations.\n\nKey drivers:\n• Availability — dependence on the provider’s SLA and multi-region redundancy; an outage halts registration and records processing.\n• Security & configuration — tenant IAM, network policy, key management and logging remain our responsibility and are a common source of exposure.\n• Data residency & privacy — customer personal data may be processed across regions with differing legal regimes.\n• Third-party dependency & exit — continuity depends on the provider’s SLAs and on our portability / exit plans.\n\nThe risk is treated through the action plan below and reviewed at each management review; residual risk is monitored against the risk appetite.",
      rtp: { createdAt: msRelIso(62), createdBy: "Peter Benjamin Parker", msApprovedBy: "Jennifer Susan Walters", approvedBy: "Jennifer Susan Walters", approvedAt: msRelIso(58), actionPlans: [
        { id: "ap-1-1", title: "Harden tenant cloud configuration (IAM, network policy, key management)", deadline: msRelIso(30), resources: [], pics: ["Peter Benjamin Parker"], status: "Verified", createdAt: msRelIso(60) },
        { id: "ap-1-2", title: "Review sub-processor list and confirm processing stays in approved regions", deadline: msRelIso(24), resources: [], pics: ["Peter Benjamin Parker"], status: "Verified", createdAt: msRelIso(60) },
        { id: "ap-1-3", title: "Enable centralized log export to the SIEM with 90-day retention", deadline: msRelIso(-14), resources: [], pics: ["Peter Benjamin Parker"], status: "In Progress", createdAt: msRelIso(60) },
        { id: "ap-1-4", title: "Establish a provider incident-notification and escalation runbook", deadline: msRelIso(-21), resources: [], pics: ["Peter Benjamin Parker"], status: "In Progress", createdAt: msRelIso(60) },
        { id: "ap-1-5", title: "Document and test the exit / data-portability plan", deadline: msRelIso(-45), resources: [], pics: ["Peter Benjamin Parker"], status: "Todo", createdAt: msRelIso(60) },
      ] },
    } },
    { module: "risks", code: "RISK-0002", title: "Limited availability of trained personnel may affect the consistency of process implementation", status: "Unassigned", owner: null, frameworks: ["ISO 9001:2015", "ISO 45001:2018"], elementId: riskEl.id, data: { category: "Quality Risks", source: "Organizational Context", sourceIssueId: "FWE-001-3", issueCategory: "Internal Issues", domains: ["Human Resources", "Operational"], methodology: "basic", likelihood: null, impact: null, priority: null, raisedBy: "Jennifer Susan Walters", raisedDate: msRelIso(8), description: "Limited availability of trained personnel may affect the consistency of process implementation." } },
    { module: "risks", code: "RISK-0003", title: "New customer requirements and regulatory expectations are increasing the", status: "In Treatment", owner: "Scott Edward Harris Lang", frameworks: ["ISO 9001:2015", "ISO 14001:2015"], elementId: riskEl.id, data: { category: "Quality Risks", source: "Organizational Context", sourceIssueId: "FWE-001-1", issueCategory: "External Issues", domains: [], methodology: "basic", likelihood: null, impact: null, priority: "High", raisedBy: "Jennifer Susan Walters", raisedDate: msRelIso(9), description: "New customer requirements and regulatory expectations are increasing the need for stronger documented quality controls.", rtp: { createdAt: msRelIso(9), createdBy: "Scott Edward Harris Lang", msApprovedBy: "Scott Edward Harris Lang", approvedBy: "Scott Edward Harris Lang", approvedAt: msRelIso(9), actionPlans: [{ id: "ap-3-1", title: "Implement mitigating controls", deadline: "", resources: [], pics: ["Scott Edward Harris Lang"], status: "In Progress", createdAt: msRelIso(9) }, { id: "ap-3-2", title: "Update the affected procedure", deadline: "", resources: [], pics: ["Scott Edward Harris Lang"], status: "Verified", createdAt: msRelIso(9) }] } } },
    { module: "risks", code: "RISK-0004", title: "Increased reliance on cloud-based systems introduces new information security", status: "Pending Approval", owner: "Monica Rambeau", frameworks: ["ISO/IEC 27001:2022", "ISO/IEC 27701:2025"], elementId: riskEl.id, data: { category: "Quality Risks", source: "Organizational Context", sourceIssueId: "FWE-001-2", issueCategory: "External Issues", domains: [], methodology: "basic", likelihood: null, impact: null, priority: "High", raisedBy: "Gwendolyne Maxine Stacy", raisedDate: msRelIso(13), description: "Increased reliance on cloud-based systems introduces new information security and privacy considerations.", rtp: { createdAt: msRelIso(13), createdBy: "Monica Rambeau", actionPlans: [{ id: "ap-4-1", title: "Define and implement mitigating controls", deadline: "", resources: [], pics: ["Monica Rambeau"], status: "Todo", createdAt: msRelIso(13) }] } } },
    { module: "risks", code: "RISK-0005", title: "Limited availability of trained personnel may affect the consistency", status: "Monitored", owner: "Scott Edward Harris Lang", frameworks: ["ISO 9001:2015", "ISO 45001:2018"], elementId: riskEl.id, data: { category: "Quality Risks", source: "Organizational Context", sourceIssueId: "FWE-001-3", issueCategory: "Internal Issues", domains: [], methodology: "basic", likelihood: null, impact: null, priority: "Medium", raisedBy: "Jennifer Susan Walters", raisedDate: msRelIso(17), description: "Limited availability of trained personnel may affect the consistency of process implementation.", rtp: { createdAt: msRelIso(17), createdBy: "Scott Edward Harris Lang", msApprovedBy: "Scott Edward Harris Lang", approvedBy: "Scott Edward Harris Lang", approvedAt: msRelIso(17), actionPlans: [{ id: "ap-5-1", title: "Mitigating controls implemented and verified", deadline: "", resources: [], pics: ["Scott Edward Harris Lang"], status: "Verified", createdAt: msRelIso(17) }] } } },
    { module: "risks", code: "RISK-0006", title: "Employees need clear roles, competence support, safe working conditions", status: "Assigned", owner: "Monica Rambeau", frameworks: ["ISO 9001:2015", "ISO 45001:2018"], elementId: riskEl.id, data: { category: "Quality Risks", source: "Interested Party", sourceReqId: "IP-REQ-0001", issueCategory: "Requirement", domains: [], methodology: "basic", likelihood: null, impact: null, priority: "Medium", raisedBy: "Gwendolyne Maxine Stacy", raisedDate: msRelIso(21), description: "Employees need clear roles, competence support, safe working conditions, and access to relevant procedures." } },
    { module: "risks", code: "RISK-0007", title: "The organization must comply with applicable occupational health and", status: "Pending Approval", owner: "Scott Edward Harris Lang", frameworks: ["ISO 45001:2018"], elementId: riskEl.id, data: { category: "Quality Risks", source: "Interested Party", sourceReqId: "IP-REQ-0002", issueCategory: "Legal / Regulatory Requirement", domains: [], methodology: "basic", likelihood: null, impact: null, priority: "High", raisedBy: "Jennifer Susan Walters", raisedDate: msRelIso(25), description: "The organization must comply with applicable occupational health and safety legal requirements.", rtp: { createdAt: msRelIso(25), createdBy: "Scott Edward Harris Lang", actionPlans: [{ id: "ap-7-1", title: "Define and implement mitigating controls", deadline: "", resources: [], pics: ["Scott Edward Harris Lang"], status: "Todo", createdAt: msRelIso(25) }] } } },
    { module: "risks", code: "RISK-0008", title: "Customer expects consistent service delivery, protection of shared information", status: "Assigned", owner: "Monica Rambeau", frameworks: ["ISO 9001:2015", "ISO/IEC 27001:2022"], elementId: riskEl.id, data: { category: "Quality Risks", source: "Interested Party", sourceReqId: "IP-REQ-0003", issueCategory: "Customer Requirement", domains: [], methodology: "basic", likelihood: null, impact: null, priority: "Medium", raisedBy: "Gwendolyne Maxine Stacy", raisedDate: msRelIso(29), description: "Customer expects consistent service delivery, protection of shared information, and prompt handling of complaints." } },
    { module: "risks", code: "RISK-0009", title: "Risk arising from the Change Management business process —", status: "Monitored", owner: "Scott Edward Harris Lang", frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0019", stepId: "", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: null, impact: null, priority: "Low", raisedBy: "Jennifer Susan Walters", raisedDate: msRelIso(33), description: "Risk arising from the Change Management business process — a failure here would affect conformity of the management system.", rtp: { createdAt: msRelIso(33), createdBy: "Scott Edward Harris Lang", msApprovedBy: "Scott Edward Harris Lang", approvedBy: "Scott Edward Harris Lang", approvedAt: msRelIso(33), actionPlans: [{ id: "ap-9-1", title: "Mitigating controls implemented and verified", deadline: "", resources: [], pics: ["Scott Edward Harris Lang"], status: "Verified", createdAt: msRelIso(33) }] } } },
    { module: "risks", code: "RISK-0010", title: "Risk arising from the Internal Audit business process —", status: "Assigned", owner: "Monica Rambeau", frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0030", stepId: "", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: null, impact: null, priority: "High", raisedBy: "Gwendolyne Maxine Stacy", raisedDate: msRelIso(37), description: "Risk arising from the Internal Audit business process — a failure here would affect conformity of the management system." } },
    // OD `bpRiskSeedIfNeeded` (core.js:9778): two risks raised from the
    // Business Processes register — one assessed (L3 × C4 = 12, Change
    // Management's "Approve change?" step, 8 days old), one unassessed
    // (Internal Audit, 4 days old). Step ids follow the seeded
    // `data.steps[]` ids above (`<code>-s<n>`).
    { module: "risks", code: "RISK-0011", title: "Unassessed change approved", status: "Monitored", owner: null, frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0019", stepId: "PRC-0019-s3", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: 3, impact: 4, level: 12, priority: null, raisedBy: "Peter Benjamin Parker", raisedDate: msRelIso(8), description: "A change is approved without adequate impact and security assessment, introducing uncontrolled risk to production systems.", activity: [{ ts: msRelIso(8), user: "Peter Benjamin Parker", action: "Risk raised from Business Process", summary: "Process Change Management · step Approve change?" }] } },
    { module: "risks", code: "RISK-0012", title: "Audit programme behind schedule", status: "Unassigned", owner: null, frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0030", stepId: "", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: null, impact: null, priority: null, raisedBy: "Jennifer Susan Walters", raisedDate: msRelIso(4), description: "The internal audit programme is not completed on schedule, reducing assurance over process conformity across the management system.", activity: [{ ts: msRelIso(4), user: "Jennifer Susan Walters", action: "Risk raised from Business Process", summary: "Process Internal Audit" }] } },
    // OD `bpSeedSteps44` `addRisk` (core.js:9477-9478): eight step-linked
    // process risks, all Monitored and assessed L3 × C4 = 12, raised/owned by
    // Bobbi Morse. Titles per OD `riskDeriveTitle` (first sentence).
    { module: "risks", code: "RISK-0013", title: "Data loss or extended downtime because database backups are not verified as restorable", status: "Monitored", owner: "Bobbi Morse", frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0004", stepId: "PRC-0004-s2", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: 3, impact: 4, level: 12, priority: null, raisedBy: "Bobbi Morse", raisedDate: msRelIso(0), description: "Data loss or extended downtime because database backups are not verified as restorable.", treatment: "Controls defined at the process step; residual risk accepted and monitored." } },
    { module: "risks", code: "RISK-0014", title: "A critical vulnerability is exploited because remediation is not prioritized and tracked to closure", status: "Monitored", owner: "Bobbi Morse", frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0006", stepId: "PRC-0006-s3", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: 3, impact: 4, level: 12, priority: null, raisedBy: "Bobbi Morse", raisedDate: msRelIso(0), description: "A critical vulnerability is exploited because remediation is not prioritized and tracked to closure.", treatment: "Controls defined at the process step; residual risk accepted and monitored." } },
    { module: "risks", code: "RISK-0015", title: "Unauthorized lateral movement because network segmentation is misconfigured", status: "Monitored", owner: "Bobbi Morse", frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0012", stepId: "PRC-0012-s2", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: 3, impact: 4, level: 12, priority: null, raisedBy: "Bobbi Morse", raisedDate: msRelIso(0), description: "Unauthorized lateral movement because network segmentation is misconfigured.", treatment: "Controls defined at the process step; residual risk accepted and monitored." } },
    { module: "risks", code: "RISK-0016", title: "A failed production release causes an outage because rollback is not tested", status: "Monitored", owner: "Bobbi Morse", frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0014", stepId: "PRC-0014-s3", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: 3, impact: 4, level: 12, priority: null, raisedBy: "Bobbi Morse", raisedDate: msRelIso(0), description: "A failed production release causes an outage because rollback is not tested.", treatment: "Controls defined at the process step; residual risk accepted and monitored." } },
    { module: "risks", code: "RISK-0017", title: "A security incident escalates because detection and containment are too slow", status: "Monitored", owner: "Bobbi Morse", frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0015", stepId: "PRC-0015-s3", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: 3, impact: 4, level: 12, priority: null, raisedBy: "Bobbi Morse", raisedDate: msRelIso(0), description: "A security incident escalates because detection and containment are too slow.", treatment: "Controls defined at the process step; residual risk accepted and monitored." } },
    { module: "risks", code: "RISK-0018", title: "Excessive privileges are granted because access requests are not verified against least-privilege", status: "Monitored", owner: "Bobbi Morse", frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0017", stepId: "PRC-0017-s2", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: 3, impact: 4, level: 12, priority: null, raisedBy: "Bobbi Morse", raisedDate: msRelIso(0), description: "Excessive privileges are granted because access requests are not verified against least-privilege.", treatment: "Controls defined at the process step; residual risk accepted and monitored." } },
    { module: "risks", code: "RISK-0019", title: "A non-conforming or unapproved supplier is engaged because evaluation is bypassed", status: "Monitored", owner: "Bobbi Morse", frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0024", stepId: "PRC-0024-s2", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: 3, impact: 4, level: 12, priority: null, raisedBy: "Bobbi Morse", raisedDate: msRelIso(0), description: "A non-conforming or unapproved supplier is engaged because evaluation is bypassed.", treatment: "Controls defined at the process step; residual risk accepted and monitored." } },
    { module: "risks", code: "RISK-0020", title: "An erroneous or unauthorized payment is made because segregation of duties is not enforced", status: "Monitored", owner: "Bobbi Morse", frameworks: [], elementId: riskEl.id, data: { category: "Quality Risks", source: "Business Process", processId: "PRC-0029", stepId: "PRC-0029-s2", issueCategory: "Process Risk", domains: [], methodology: "basic", likelihood: 3, impact: 4, level: 12, priority: null, raisedBy: "Bobbi Morse", raisedDate: msRelIso(0), description: "An erroneous or unauthorized payment is made because segregation of duties is not enforced.", treatment: "Controls defined at the process step; residual risk accepted and monitored." } },
    // Objectives 1:1 with OD `objSeed` (core.js:8084) — five OBJ rows, same
    // codes, titles, themes, owners, targets, baselines, sources and plans.
    { module: "objectives", code: "OBJ-0001", title: "Achieve ≥ 92% training completion across the workforce", status: "Open", owner: "Bobbi Morse", frameworks: [], data: { theme: "Competence & Awareness", unit: "%", dir: "up", target: 92, baseline: 78, source: { kind: "indicator", indicator: "Training completion rate" }, period: "FY 2026", due: "2026-12-31", actions: "Publish the annual training calendar, assign role-based plans from competence gaps, and escalate overdue actions monthly.", resources: "LMS licences; line-manager review time.", createdBy: "Jennifer Susan Walters" } },
    { module: "objectives", code: "OBJ-0002", title: "Raise awareness acknowledgment to ≥ 97%", status: "Open", owner: "Maria Rambeau", frameworks: [], data: { theme: "Competence & Awareness", unit: "%", dir: "up", target: 97, baseline: 88, source: { kind: "indicator", indicator: "Awareness acknowledgment rate" }, period: "FY 2026", due: "2026-12-31", actions: "Run quarterly awareness campaigns with reminder cycles and track acknowledgment per campaign.", resources: "Comms channel; awareness content authoring.", createdBy: "Jennifer Susan Walters" } },
    { module: "objectives", code: "OBJ-0003", title: "Close ≥ 90% of internal audit findings on time", status: "Open", owner: "Daniel Rand", frameworks: [], data: { theme: "Risk & Compliance", unit: "%", dir: "up", target: 90, baseline: 70, source: { kind: "indicator", indicator: "Audit finding closure rate" }, period: "FY 2026", due: "2026-12-31", actions: "Assign corrective-action owners at the closing meeting; review open findings at each management review.", resources: "Auditor follow-up time.", createdBy: "Jennifer Susan Walters" } },
    { module: "objectives", code: "OBJ-0004", title: "Maintain zero open High / Critical risks", status: "Open", owner: "Scott Edward Harris Lang", frameworks: [], data: { theme: "Risk & Compliance", unit: "#", dir: "down", target: 0, baseline: 2, source: { kind: "indicator", indicator: "Open High / Critical risks" }, period: "FY 2026", due: "2026-12-31", actions: "Prioritise treatment of elevated risks; verify residual level before monitoring.", resources: "Risk treatment budget; owner time.", createdBy: "Jennifer Susan Walters" } },
    { module: "objectives", code: "OBJ-0005", title: "Reach a customer satisfaction score of ≥ 90%", status: "Open", owner: "Gwendolyne Maxine Stacy", frameworks: [], data: { theme: "Customer", unit: "%", dir: "up", target: 90, baseline: 84, actualManual: 88, source: { kind: "manual" }, period: "FY 2026", due: "2026-12-31", actions: "Run the half-yearly customer satisfaction survey; act on detractor feedback via improvement opportunities.", resources: "Survey tooling; account-management time.", createdBy: "Jennifer Susan Walters" } },
    // Policies 1:1 with OD `polSeedIfNeeded` (core.js:12230): two Published
    // High-Level policies and one Draft Specific policy, effective 4 days
    // ago (`polEff`) with an annual review cycle (`polNext`).
    { module: "policies", code: "POL-QMS-0001", title: "Quality Policy", status: "Published", owner: "Scott Edward Harris Lang", frameworks: ["ISO 9001:2015"], elementId: auditEl?.id ?? null, data: {
      category: "High-Level Policy", approver: "Jennifer Susan Walters", reviewFreq: "Annually", version: "1", editingFormat: "structured",
      effectiveDate: polEff, nextReview: polNext, approvedBy: "Jennifer Susan Walters", approvedDate: polEff, publishedBy: "Jennifer Susan Walters", publishedDate: polEff, createdBy: "Scott Edward Harris Lang",
      statement: "PT Hammer Industries is committed to delivering products and services that meet customer requirements, applicable statutory and regulatory requirements, and agreed management system requirements.",
      commitments: "PT Hammer Industries commits to maintaining an effective quality management system, improving business processes, monitoring performance, addressing risks and opportunities, and continually improving the suitability and effectiveness of the quality management system.",
      scope: "This policy applies to all business processes, personnel, and externally provided services within the approved quality management system scope.",
      roles: "Top management is responsible for establishing and maintaining this policy. Process owners are responsible for implementing relevant requirements. Personnel are responsible for following applicable procedures and contributing to continual improvement.",
    } },
    { module: "policies", code: "POL-ISMS-0001", title: "Information Security Policy", status: "Published", owner: "Gwendolyne Maxine Stacy", frameworks: ["ISO/IEC 27001:2022"], elementId: auditEl?.id ?? null, data: {
      category: "High-Level Policy", approver: "Jennifer Susan Walters", reviewFreq: "Annually", version: "1", editingFormat: "structured",
      effectiveDate: polEff, nextReview: polNext, approvedBy: "Jennifer Susan Walters", approvedDate: polEff, publishedBy: "Jennifer Susan Walters", publishedDate: polEff, createdBy: "Gwendolyne Maxine Stacy",
      statement: "PT Hammer Industries is committed to protecting the confidentiality, integrity, and availability of information assets used in business operations, service delivery, and supporting systems.",
      commitments: "PT Hammer Industries commits to identifying and managing information security risks, fulfilling applicable legal, regulatory, contractual, and security requirements, maintaining appropriate controls, and continually improving the information security management system.",
      scope: "This policy applies to personnel, information assets, systems, SaaS applications, cloud infrastructure, business processes, and external dependencies within the approved information security management system scope.",
      roles: "Top management is responsible for information security governance. System owners, process owners, and personnel are responsible for applying security requirements relevant to their roles.",
    } },
    { module: "policies", code: "POL-SEC-0001", title: "Access Control Policy", status: "Draft", owner: "Gwendolyne Maxine Stacy", frameworks: ["ISO/IEC 27001:2022"], elementId: auditEl?.id ?? null, data: {
      category: "Specific Policy", approver: "Jennifer Susan Walters", reviewFreq: "Annually", version: "1", editingFormat: "structured", createdBy: "Gwendolyne Maxine Stacy",
      statement: "Access to systems, applications, information assets, and services shall be controlled based on business needs, assigned responsibilities, and approved authorization.",
      commitments: "PT Hammer Industries commits to applying least privilege, reviewing access rights periodically, removing access when no longer required, and protecting privileged access.",
      scope: "This policy applies to employees, contractors, administrators, SaaS applications, cloud infrastructure, source code repositories, and other systems within the approved management system scope.",
      roles: "System owners approve access. Administrators configure access. Users are responsible for protecting credentials and using access only for authorized purposes.",
    } },
    // OD `polSeedInflightIfNeeded` (core.js:12280) — three in-flight
    // specific policies at different approval stages, each stamped with its
    // own owner/approver/statement/commitments/scope/roles.
    { module: "policies", code: "POL-OPS-0001", title: "Change Management Policy", status: "Under Review", owner: "Scott Edward Harris Lang", frameworks: ["ISO 9001:2015"], data: {
      category: "Specific Policy", approver: "Jennifer Susan Walters", reviewFreq: "Annually", version: "1", editingFormat: "structured", createdBy: "Scott Edward Harris Lang",
      statement: "Changes to processes, systems, and documented information shall be planned, assessed for risk, approved, and verified before implementation.",
      commitments: "PT Hammer Industries commits to controlling change so that quality, information security, and operational continuity are preserved.",
      scope: "Applies to changes affecting management-system processes, infrastructure, and documented information within the approved scope.",
      roles: "Process owners raise change requests. The MS Team reviews. Top Management authorizes significant changes.",
    } },
    { module: "policies", code: "POL-OPS-0002", title: "Information Classification Policy", status: "Pending Final Approval", owner: "Gwendolyne Maxine Stacy", frameworks: ["ISO/IEC 27001:2022"], data: {
      category: "Specific Policy", approver: "Jennifer Susan Walters", reviewFreq: "Annually", version: "1", editingFormat: "structured", createdBy: "Gwendolyne Maxine Stacy",
      statement: "Information shall be classified according to its sensitivity, value, and legal or contractual requirements, and handled, labelled, and protected accordingly.",
      commitments: "PT Hammer Industries commits to consistent information classification and handling to preserve confidentiality, integrity, and availability.",
      scope: "Applies to all information assets, documents, and records created, processed, or stored within the approved management-system scope.",
      roles: "Information owners assign classifications. The MS Team reviews. Top Management gives final approval.",
    } },
    { module: "policies", code: "POL-OPS-0003", title: "Acceptable Use Policy", status: "Under Review", owner: "Scott Edward Harris Lang", frameworks: ["ISO/IEC 27001:2022"], data: {
      category: "Specific Policy", approver: "Jennifer Susan Walters", reviewFreq: "Annually", version: "1", editingFormat: "structured", createdBy: "Scott Edward Harris Lang",
      statement: "Information systems, devices, and services shall be used only for authorized purposes and in line with the organization’s security and conduct requirements.",
      commitments: "PT Hammer Industries commits to clear acceptable-use expectations so that personnel handle systems and information responsibly.",
      scope: "Applies to all personnel and contractors using the organization’s information systems, devices, accounts, and services.",
      roles: "Personnel follow acceptable-use rules. The MS Team reviews. Top Management gives final approval.",
    } },
    // NOTE: controlled documents (`documents`) and external documents
    // (`records` / `record-folders`) are seeded in section 14b2 below, after
    // the Work Units they reference exist — 1:1 with OD `cdocSeedIfNeeded`
    // (core.js:19538) and `edSeedIfNeeded` (core.js:19982).
    // NOTE: no `audits` clause-register seed row — the real Internal Audit
    // module is the dedicated `/internal-audit` surface, not this register
    // (the orphan `audits` register was removed; see registry.ts).
    // OD `impCasesSeed` NC-0002 (core.js:13343): Process NC, no CAP yet, due 14
    // days out (OD `dstr(-14)`). Timestamps stay the loop's "now" default.
    { module: "nonconformities", code: "NC-0002", title: "Change implemented without documented risk assessment", status: "Open", owner: "Daniel Rand", frameworks: ["ISO 9001:2015"], data: { category: "Process Nonconformity", process: "Change Management", site: "", workUnit: "", description: "Two production changes were implemented without a documented impact and risk assessment, contrary to the change control procedure.", evidence: "", confirmedBy: "Bobbi Morse", confirmedDate: msRelIso(11), pic: "Daniel Rand", due: msRelIso(-14).slice(0, 10), cap: null } },
    // OD `ipSeedIfNeeded` obligation-register seed (app.html:14455) —
    // the compliance-obligations link targets used by Interested Parties
    // requirements. `compliance` is the `registry.ts` module for OD's
    // `db.obligations` (`coNewId` → `COBL-`).
    { module: "compliance", code: "COBL-0001", title: "OH&S Legal Requirement Register", status: "Active", owner: "Jennifer Susan Walters", frameworks: ["ISO 45001:2018"], data: { source: "Compliance Obligations" } },
    { module: "compliance", code: "COBL-0002", title: "Information Security & Privacy Obligations", status: "Active", owner: "Jennifer Susan Walters", frameworks: ["ISO/IEC 27001:2022", "ISO/IEC 27701:2025"], data: { source: "Compliance Obligations" } },
    { module: "compliance", code: "COBL-0003", title: "Quality & Customer Obligations", status: "Active", owner: "Jennifer Susan Walters", frameworks: ["ISO 9001:2015"], data: { source: "Compliance Obligations" } },
    { module: "compliance", code: "COBL-0004", title: "Environmental Compliance Obligations", status: "Active", owner: "Jennifer Susan Walters", frameworks: ["ISO 14001:2015"], data: { source: "Compliance Obligations" } },
  ];
  for (const m of msSeed) {
    await ImplementationRecord.findOrCreate({
      where: { module: m.module, code: m.code },
      defaults: { orgId: tenant.id, module: m.module, code: m.code, title: m.title, status: m.status, owner: m.owner, data: m.data, elementId: m.elementId ?? null, frameworks: m.frameworks ?? ["ISO/IEC 27001:2022"] },
    });
  }

  // 13c. Record rails for the management-system seed (SOF: OC detail was blank).
  //      OD keeps an issue's activity log and comment thread on the record
  //      itself (`i.activity`, `i.comments`, core.js:9174/9146), but the port's
  //      detail drawers read the separate `record_events` store via
  //      `listRecordEvents`. Seeding `data.activity` alone left every
  //      Organizational Context issue with an empty Activity + Comments rail.
  //      Mirror `data.activity` for any seeded record that carries one, and
  //      port OD's two seeded comment threads (FWE-001-1, FWE-001-2).
  const OC_COMMENTS: Record<string, { h: number; by: string; text: string }[]> = {
    "FWE-001-1": [
      { h: 301, by: "Peter Benjamin Parker", text: "Can we confirm which site this primarily affects before the audit?" },
      { h: 127, by: "Wanda Maximoff", text: "Evidence folder shared — see the QMS drive." },
    ],
    "FWE-001-2": [
      { h: 220, by: "Jennifer Susan Walters", text: "Flagging this for the next management review — cloud migration is now touching customer PII, so it needs a documented risk position." },
      { h: 214, by: "Peter Parker", text: "Agreed. I raised RISK-0001 off the back of it. Residency is my biggest worry given the multi-region replication." },
      { h: 208, by: "Monica Rambeau", text: "Do we have the provider’s data-processing addendum on file? We can’t assert 27701 relevance without it." },
      { h: 205, by: "Jennifer Susan Walters", text: "DPA is signed but the sub-processor list hasn’t been reviewed since last year. Adding that as an action." },
      { h: 190, by: "Matthew Michael Murdock", text: "From a legal view: confirm the contracted regions match our approved-jurisdictions list before we sign off." },
      { h: 176, by: "Peter Parker", text: "IAM review done. Found three service accounts with standing admin — rotating to short-lived tokens this sprint." },
      { h: 150, by: "Monica Rambeau", text: "Nice. Please also enable log export to our SIEM; right now provider logs expire in 30 days." },
      { h: 120, by: "Jennifer Susan Walters", text: "Log export is on the backlog for infra. I’ll link the ticket here once it’s created." },
      { h: 96, by: "Peter Parker", text: "Ticket INFRA-482 created for SIEM export. ETA two weeks." },
      { h: 72, by: "Matthew Michael Murdock", text: "Sub-processor list reviewed — one new analytics vendor in an un-approved region. Flagging as a finding." },
      { h: 48, by: "Monica Rambeau", text: "That vendor needs either a region change or an exception with sign-off. Can’t leave it open." },
      { h: 30, by: "Jennifer Susan Walters", text: "Exception requested and pending approval. Keeping this issue Monitored until the residual risk is confirmed acceptable." },
      { h: 8, by: "Peter Parker", text: "Short-lived credentials rolled out. Residual likelihood dropped one band — will update the linked risk after verification." },
    ],  };
  for (const m of msSeed) {
    const rec = await ImplementationRecord.findOne({ where: { orgId: tenant.id, module: m.module, code: m.code } });
    if (!rec) continue;
    const existing = await RecordEvent.count({ where: { orgId: tenant.id, module: m.module, recordId: rec.id } });
    if (existing > 0) continue;
    const activity = (m.data.activity ?? []) as { ts: string; user: string; action: string; summary?: string }[];
    for (const e of activity) {
      await RecordEvent.create({
        orgId: tenant.id, module: m.module, recordId: rec.id, type: "activity", actor: e.user,
        text: e.summary ? `${e.action} — ${e.summary}` : e.action, createdAt: new Date(e.ts),
      });
    }
    for (const c of OC_COMMENTS[m.code] ?? []) {
      await RecordEvent.create({
        orgId: tenant.id, module: m.module, recordId: rec.id, type: "comment", actor: c.by,
        text: c.text, createdAt: new Date(Date.now() - c.h * 3600000),
      });
    }
  }

  // 14a. Phase 9a — Concerns → Nonconformity/Incident/Improvement routing
  //      chain (OD `concernSeedIfNeeded`, index.html:11217-11244): four
  //      concerns covering every OD routing outcome — one to a Nonconformity
  //      with a CAP, one to an Incident, one to an Improvement Opportunity,
  //      and one closed as a duplicate of the first — with the created
  //      records cross-linked both ways (`sourceConcernId` / `routedRecordId`)
  //      exactly as OD's `conRoute` stamps them, plus each record's OD
  //      `activity` timeline ported as `RecordEvent` rows.
  const concernsSeeded = await ImplementationRecord.findOne({ where: { orgId: tenant.id, module: "concerns", code: "CON-0001" } });
  if (!concernsSeeded) {
    const relDate = (n: number): Date => new Date(Date.now() - n * 86400000);
    const relIso = (n: number): string => relDate(n).toISOString();
    const jen = "Jennifer Susan Walters", tenantAdmin = "Tenant Administrator";
    // OD `concernSeedIfNeeded` reviews the chain as `adm='Bobbi Morse'`, with
    // Maria Rambeau reporting CON-0002.
    const bobbi = "Bobbi Morse", maria = "Maria Rambeau";
    const dupReporter = "Process Owner – IT Infrastructure";

    const con1 = await ImplementationRecord.create({
      orgId: tenant.id, module: "concerns", code: "CON-0001",
      title: "Document owner missing for access control procedure", status: "Routed", owner: null,
      elementId: null, frameworks: ["ISO/IEC 27001:2022"],
      data: {
        category: "Document issue", process: "Documented Information Management", site: "", workUnit: "",
        description: "The access control procedure has been uploaded, but no document owner is assigned and the review frequency is not defined.",
        reportedBy: jen, evidence: "", reviewer: bobbi, reviewDate: relIso(6),
        reviewNotes: "Confirmed missing document control attributes.",
        classification: "Nonconformity", routingDecision: "Create Nonconformity", routingNotes: "",
        routedTo: "nonconformities", routedRecordId: "", routedRecordCode: "",
      },
      createdAt: relDate(8), updatedAt: relDate(6),
    });
    const nc1 = await ImplementationRecord.create({
      orgId: tenant.id, module: "nonconformities", code: "NC-0001",
      title: "Document owner missing for access control procedure", status: "In Progress", owner: jen,
      elementId: null, frameworks: ["ISO/IEC 27001:2022"],
      data: {
        sourceConcernId: con1.id, sourceConcernCode: con1.code,
        category: "Documented Information Nonconformity", process: "Documented Information Management", site: "", workUnit: "",
        description: "The access control procedure has no assigned document owner and no defined review frequency.",
        evidence: "", confirmedBy: bobbi, confirmedDate: relIso(6), pic: jen, due: "2026-07-15",
        cap: {
          id: "CAP-0001", rcaMethod: "5 Whys",
          rca: "Document ownership was not checked during document upload because the document registration checklist does not require owner and review frequency verification.",
          correction: "Assign a document owner and review frequency to the affected access control procedure.",
          correctiveAction: "Update the document registration checklist to require owner assignment, review frequency, and approval verification before documents can be published.",
          pic: jen, due: "2026-07-15", priority: "Medium", resources: "",
          implementationStatus: "In Progress", effRequired: true, effMethod: "", effDue: "2026-07-31", effBy: "",
          effResult: "Not Checked", closureNotes: "",
        },
      },
      createdAt: relDate(6), updatedAt: relDate(5),
    });
    await con1.update({ data: { ...con1.data, routedRecordId: nc1.id, routedRecordCode: nc1.code } });

    const con2 = await ImplementationRecord.create({
      orgId: tenant.id, module: "concerns", code: "CON-0002",
      title: "Unusual login activity detected in admin portal", status: "Routed", owner: null,
      elementId: null, frameworks: [],
      data: {
        category: "Security issue", process: "", site: "", workUnit: "",
        description: "Several failed login attempts were detected for an administrator account outside normal working hours.",
        reportedBy: maria, evidence: "", reviewer: bobbi, reviewDate: relIso(6),
        reviewNotes: "Potential security event, route to incident handling.",
        classification: "Incident", routingDecision: "Create Incident", routingNotes: "",
        routedTo: "incidents", routedRecordId: "", routedRecordCode: "",
      },
      createdAt: relDate(7), updatedAt: relDate(6),
    });
    const inc1 = await ImplementationRecord.create({
      orgId: tenant.id, module: "incidents", code: "INC-0001",
      title: "Unusual login activity detected in admin portal", status: "Under Investigation", owner: tenantAdmin,
      elementId: null, frameworks: [],
      data: {
        sourceConcernId: con2.id, sourceConcernCode: con2.code,
        type: "Information Security Incident",
        description: "Several failed login attempts were detected for an administrator account outside normal working hours.",
        incidentDate: relIso(7), site: "", process: "", workUnit: "", system: "Admin Portal",
        affected: "Administrator account", immediate: "Administrator password was reset and MFA status was verified.",
        reportedBy: bobbi, handler: "Tenant Administrator", investigation: "", rootCause: "", followups: "", evidence: "",
      },
      createdAt: relDate(6), updatedAt: relDate(5),
    });
    await con2.update({ data: { ...con2.data, routedRecordId: inc1.id, routedRecordCode: inc1.code } });

    const con3 = await ImplementationRecord.create({
      orgId: tenant.id, module: "concerns", code: "CON-0003",
      title: "Improve onboarding checklist for contractors", status: "Routed", owner: null,
      elementId: null, frameworks: [],
      data: {
        category: "Process issue", process: "", site: "", workUnit: "",
        description: "Contractor onboarding currently relies on manual email confirmation and may benefit from a clearer checklist.",
        reportedBy: jen, evidence: "", reviewer: bobbi, reviewDate: relIso(5),
        reviewNotes: "Not a nonconformity; route as improvement.",
        classification: "Observation / Improvement", routingDecision: "Create Improvement Opportunity", routingNotes: "",
        routedTo: "improvements", routedRecordId: "", routedRecordCode: "",
      },
      createdAt: relDate(6), updatedAt: relDate(5),
    });
    const imp1 = await ImplementationRecord.create({
      orgId: tenant.id, module: "improvements", code: "IMP-0001",
      title: "Improve onboarding checklist for contractors", status: "Planned", owner: tenantAdmin,
      elementId: null, frameworks: [],
      data: {
        sourceConcernId: con3.id, sourceConcernCode: con3.code,
        category: "Process Improvement", process: "", site: "", workUnit: "",
        description: "Contractor onboarding currently relies on manual email confirmation and may benefit from a clearer checklist.",
        suggestedAction: "Create a standard contractor onboarding checklist covering access, confidentiality, awareness, and equipment return requirements.",
        owner: tenantAdmin, due: "2026-07-30", priority: "Medium", evidence: "",
      },
      createdAt: relDate(5), updatedAt: relDate(5),
    });
    await con3.update({ data: { ...con3.data, routedRecordId: imp1.id, routedRecordCode: imp1.code } });

    const con4 = await ImplementationRecord.create({
      orgId: tenant.id, module: "concerns", code: "CON-0004",
      title: "Duplicate report for access control document owner", status: "Closed", owner: null,
      elementId: null, frameworks: [],
      data: {
        category: "Document issue", process: "", site: "", workUnit: "",
        description: "Another user reported that the access control procedure has no assigned owner.",
        reportedBy: dupReporter, evidence: "", reviewer: bobbi, reviewDate: relIso(5),
        reviewNotes: "Same as CON-0001.", classification: "Duplicate", routingDecision: "Close as Duplicate",
        routingNotes: "", relatedExisting: con1.code, closureReason: `Duplicate of ${con1.code}.`,
      },
      createdAt: relDate(5), updatedAt: relDate(5),
    });

    const activitySeed: { module: string; recordId: string; entries: { ts: Date; user: string; text: string }[] }[] = [
      { module: "concerns", recordId: con1.id, entries: [
        { ts: relDate(8), user: jen, text: "submitted this concern — Concern submitted" },
        { ts: relDate(6), user: bobbi, text: "classified the concern — Nonconformity" },
        { ts: relDate(6), user: bobbi, text: "routed the concern — Routed to NC-0001" },
      ] },
      { module: "nonconformities", recordId: nc1.id, entries: [
        { ts: relDate(6), user: bobbi, text: "created this nonconformity — From concern CON-0001" },
        { ts: relDate(5), user: jen, text: "created CAP — CAP-0001 · 5 Whys" },
      ] },
      { module: "concerns", recordId: con2.id, entries: [
        { ts: relDate(7), user: maria, text: "submitted this concern — Concern submitted" },
        { ts: relDate(6), user: bobbi, text: "classified the concern — Incident" },
        { ts: relDate(6), user: bobbi, text: "routed the concern — Routed to INC-0001" },
      ] },
      { module: "incidents", recordId: inc1.id, entries: [
        { ts: relDate(6), user: bobbi, text: "created this incident — From concern CON-0002" },
        { ts: relDate(6), user: bobbi, text: "assigned a handler — Tenant Administrator" },
      ] },
      { module: "concerns", recordId: con3.id, entries: [
        { ts: relDate(6), user: jen, text: "submitted this concern — Concern submitted" },
        { ts: relDate(5), user: bobbi, text: "classified the concern — Observation / Improvement" },
        { ts: relDate(5), user: bobbi, text: "routed the concern — Routed to IMP-0001" },
      ] },
      { module: "improvements", recordId: imp1.id, entries: [
        { ts: relDate(5), user: bobbi, text: "created this improvement opportunity — From concern CON-0003" },
      ] },
      { module: "concerns", recordId: con4.id, entries: [
        { ts: relDate(5), user: dupReporter, text: "submitted this concern — Concern submitted" },
        { ts: relDate(5), user: bobbi, text: `closed the concern — Duplicate of ${con1.code}` },
      ] },
    ];
    for (const a of activitySeed) {
      for (const e of a.entries) {
        await RecordEvent.create({ orgId: tenant.id, module: a.module, recordId: a.recordId, type: "activity", actor: e.user, text: e.text, createdAt: e.ts });
      }
    }
  }

  // 14a2. Phase 9a2 — Internal Audit programme/plan/session/finding/report
  //      content (OD `iauditSeedIfNeeded` + `iauditSeedExtra`,
  //      index.html:11780-11860): 6 audit programs spanning Q1–Q4 2026, their
  //      8 plans, 19 sessions, 7 findings (IAF-0001/0002 plus the 5 from
  //      `iauditSeedExtra`), the IMP-0002 improvement routed from IAF-0002,
  //      and 2 generated reports (IAR-0001/0002), ported with OD's exact
  //      titles / dates-relative-to-now / statuses / criteria. Unlike the
  //      reference-db registers, the dedicated `/internal-audit` surface has
  //      no lazy first-read seed, so demo data only exists if a seeder writes
  //      it.
  const iaSeeded = await IaProgram.findOne({ where: { orgId: tenant.id, code: "IAP-0001" } });
  if (!iaSeeded) {
    const iaDate = (n: number): Date => new Date(Date.now() - n * 86400000);
    const iaIso = (n: number): string => iaDate(n).toISOString();
    const jen = "Jennifer Susan Walters", tenantAdmin = "Tenant Administrator";
    const scott = "Scott Edward Harris Lang", gwen = "Gwendolyne Maxine Stacy";
    const mon = "Monica Rambeau";
    const Q = "ISO 9001:2015", S = "ISO/IEC 27001:2022";
    const SD = "Software Development", IT = "IT Infrastructure";
    const iaMethods = ["Document review", "Interview", "Evidence review", "System walkthrough"];
    const iaScope = "This audit covers the selected processes within the approved management system scope.";
    const iaObjective = "To determine whether the selected processes conform to applicable framework criteria and are effectively implemented and maintained.";

    type ProgSeed = {
      code: string; name: string; period: string; processes: string[]; workUnits: string[]; criteria: string[];
      leadAuditor: string; auditors?: string[]; status: string; createdAgo: number; updatedAgo: number;
      scope?: string; objective?: string;
      extraActivity?: { ts: number; user: string; action: string; summary: string };
    };
    // OD department teams (`TEAM_SD`/`TEAM_IT`, `deptTeam` in `iauditSeedExtra`).
    const teamSD = [jen, scott, gwen];
    const teamIT = [tenantAdmin, mon];
    const progSeeds: ProgSeed[] = [
      { code: "IAP-0001", name: "June 2026 Integrated Internal Audit Program", period: "2026-06",
        processes: ["Front End Development", "Back End Development", "Quality Assurance", "Database Administrator"],
        workUnits: [SD, IT], criteria: [Q, S], leadAuditor: jen, auditors: [jen, scott, gwen, tenantAdmin, mon],
        // OD `iauditSeedIfNeeded` gives the June program its own longer scope/objective.
        scope: "This audit covers selected software development, quality assurance, and IT infrastructure processes within the approved management system scope.",
        objective: "To determine whether the selected processes conform to applicable framework criteria and organizational requirements, and whether they are effectively implemented and maintained.",
        status: "In Progress", createdAgo: 10, updatedAgo: 3,
        extraActivity: { ts: 9, user: tenantAdmin, action: "approved the program", summary: "Approved" } },
      { code: "IAP-0002", name: "Q1 2026 Software Development Internal Audit", period: "2026-02",
        processes: ["Front End Development", "Back End Development", "Business Process Analyst", "Quality Assurance"],
        workUnits: [SD], criteria: [Q], leadAuditor: jen, auditors: teamSD, status: "Completed", createdAgo: 150, updatedAgo: 120 },
      { code: "IAP-0003", name: "Q1 2026 IT Infrastructure & Information Security Audit", period: "2026-03",
        processes: ["Database Administrator", "Vulnerability Assessment"],
        workUnits: [IT], criteria: [S], leadAuditor: tenantAdmin, auditors: teamIT, status: "Report Generated", createdAgo: 120, updatedAgo: 95 },
      { code: "IAP-0004", name: "Q2 2026 Management & Delivery Processes Audit", period: "2026-05",
        processes: ["Product Management", "Project Management"],
        workUnits: [SD], criteria: [Q], leadAuditor: scott, auditors: teamSD, status: "Completed", createdAgo: 75, updatedAgo: 40 },
      { code: "IAP-0005", name: "Q3 2026 Software Development Surveillance Audit", period: "2026-09",
        processes: ["Front End Development", "Back End Development", "Quality Assurance"],
        workUnits: [SD], criteria: [Q], leadAuditor: jen, auditors: teamSD, status: "Approved", createdAgo: 20, updatedAgo: 10 },
      { code: "IAP-0006", name: "Q4 2026 Annual Integrated Internal Audit", period: "2026-11",
        processes: ["Front End Development", "Back End Development", "Business Process Analyst", "Database Administrator", "Quality Assurance", "Vulnerability Assessment", "Product Management", "Project Management"],
        workUnits: [SD, IT, "Quality Assurance"], criteria: [Q, S], leadAuditor: jen, auditors: teamSD, status: "Draft", createdAgo: 8, updatedAgo: 3 },
    ];
    const iaProgramIdByCode = new Map<string, string>();
    for (const p of progSeeds) {
      const activity = [{ ts: iaIso(p.createdAgo), user: p.leadAuditor, action: "created this audit program", summary: p.name }];
      if (p.extraActivity) {
        activity.push({ ts: iaIso(p.extraActivity.ts), user: p.extraActivity.user, action: p.extraActivity.action, summary: p.extraActivity.summary });
      }
      const row = await IaProgram.create({
        orgId: tenant.id, code: p.code, name: p.name, period: p.period, processes: p.processes, workUnits: p.workUnits,
        methods: iaMethods, criteria: p.criteria, scope: p.scope ?? iaScope, objective: p.objective ?? iaObjective,
        leadAuditor: p.leadAuditor, auditors: p.auditors ?? [p.leadAuditor, tenantAdmin], independence: "Checked", overrideJust: null,
        duration: "2 days", status: p.status, notes: null, createdBy: p.leadAuditor, lastUpdatedBy: p.leadAuditor,
        activity, createdAt: iaDate(p.createdAgo), updatedAt: iaDate(p.updatedAgo),
      });
      iaProgramIdByCode.set(p.code, row.id);
    }

    type PlanSeed = { code: string; programCode: string; name: string; processes: string[]; criteria: string[]; leadAuditor: string; auditors?: string[]; status: string; createdAgo: number; updatedAgo: number };
    const planSeeds: PlanSeed[] = [
      // OD `iauditSeedIfNeeded` splits June into two plans: IAPL-0001 (SD) and
      // IAPL-0007 (IT), each with its department team.
      { code: "IAPL-0001", programCode: "IAP-0001", name: "June 2026 Software Development Audit Plan", processes: ["Front End Development", "Back End Development", "Quality Assurance"], criteria: [Q], leadAuditor: jen, auditors: [jen, scott, gwen], status: "Scheduled", createdAgo: 9, updatedAgo: 4 },
      { code: "IAPL-0007", programCode: "IAP-0001", name: "June 2026 IT Infrastructure Audit Plan", processes: ["Database Administrator", "Vulnerability Assessment"], criteria: [S], leadAuditor: tenantAdmin, auditors: [tenantAdmin, mon], status: "Scheduled", createdAgo: 9, updatedAgo: 4 },
      { code: "IAPL-0002", programCode: "IAP-0002", name: "Q1 2026 Software Development Audit Plan", processes: ["Front End Development", "Back End Development", "Business Process Analyst", "Quality Assurance"], criteria: [Q], leadAuditor: jen, auditors: teamSD, status: "Completed", createdAgo: 148, updatedAgo: 118 },
      { code: "IAPL-0003", programCode: "IAP-0003", name: "Q1 2026 IT Infrastructure Audit Plan", processes: ["Database Administrator", "Vulnerability Assessment"], criteria: [S], leadAuditor: tenantAdmin, auditors: teamIT, status: "Completed", createdAgo: 118, updatedAgo: 93 },
      { code: "IAPL-0004", programCode: "IAP-0004", name: "Q2 2026 Management Processes Audit Plan", processes: ["Product Management", "Project Management"], criteria: [Q], leadAuditor: scott, auditors: teamSD, status: "Completed", createdAgo: 73, updatedAgo: 38 },
      { code: "IAPL-0005", programCode: "IAP-0005", name: "Q3 2026 Surveillance Audit Plan", processes: ["Front End Development", "Back End Development", "Quality Assurance"], criteria: [Q], leadAuditor: jen, auditors: teamSD, status: "Scheduled", createdAgo: 18, updatedAgo: 8 },
      // OD `iauditSeedExtra` splits Q4 into an SD plan (IAPL-0006) and an IT plan (IAPL-0008).
      { code: "IAPL-0006", programCode: "IAP-0006", name: "Q4 2026 Software Development Audit Plan", processes: ["Front End Development", "Project Management", "Product Management"], criteria: [Q], leadAuditor: jen, auditors: teamSD, status: "Draft", createdAgo: 6, updatedAgo: 2 },
      { code: "IAPL-0008", programCode: "IAP-0006", name: "Q4 2026 IT Infrastructure Audit Plan", processes: ["Database Administrator", "Vulnerability Assessment"], criteria: [S], leadAuditor: tenantAdmin, auditors: teamIT, status: "Draft", createdAgo: 6, updatedAgo: 2 },
    ];
    const iaPlanIdByCode = new Map<string, string>();
    const planProgramCode = new Map<string, string>();
    for (const p of planSeeds) {
      const row = await IaPlan.create({
        orgId: tenant.id, code: p.code, programId: iaProgramIdByCode.get(p.programCode)!, name: p.name,
        processes: p.processes, criteria: p.criteria, leadAuditor: p.leadAuditor, auditors: p.auditors ?? [p.leadAuditor, tenantAdmin],
        notes: null, status: p.status, createdBy: p.leadAuditor, lastUpdatedBy: p.leadAuditor,
        activity: [{ ts: iaIso(p.createdAgo), user: p.leadAuditor, action: "created this audit plan", summary: p.name }],
        createdAt: iaDate(p.createdAgo), updatedAt: iaDate(p.updatedAgo),
      });
      iaPlanIdByCode.set(p.code, row.id);
      planProgramCode.set(p.code, p.programCode);
    }

    type SessSeed = { code: string; planCode: string; title: string; date: string; start: string; end: string; auditor: string; criteria: string[]; process: string; workUnit: string; methods?: string[]; status: string; createdAgo: number; updatedAgo: number };
    const sessSeeds: SessSeed[] = [
      { code: "IAS-0001", planCode: "IAPL-0001", title: "Software Development Process Audit", date: "2026-06-18", start: "09:00", end: "11:00", auditor: jen, criteria: [Q, S], process: "Front End Development", workUnit: SD, methods: ["Interview", "Evidence review"], status: "Completed", createdAgo: 9, updatedAgo: 3 },
      { code: "IAS-0002", planCode: "IAPL-0007", title: "IT Infrastructure and Access Control Audit", date: "2026-06-21", start: "10:00", end: "12:00", auditor: tenantAdmin, criteria: [S], process: "Database Administrator", workUnit: IT, methods: ["System walkthrough", "Evidence review"], status: "Scheduled", createdAgo: 9, updatedAgo: 3 },
      // `iauditSeedExtra` sessions: OD's `mkS` defaults `updatedAt` to d(30)
      // for every extra session (none passes `u`), ported verbatim.
      { code: "IAS-0010", planCode: "IAPL-0002", title: "Front End Development Process Audit", date: "2026-02-10", start: "09:00", end: "11:00", auditor: jen, criteria: [Q], process: "Front End Development", workUnit: SD, status: "Completed", createdAgo: 148, updatedAgo: 30 },
      { code: "IAS-0011", planCode: "IAPL-0002", title: "Back End Development Process Audit", date: "2026-02-12", start: "09:00", end: "11:00", auditor: scott, criteria: [Q], process: "Back End Development", workUnit: SD, status: "Completed", createdAgo: 146, updatedAgo: 30 },
      { code: "IAS-0012", planCode: "IAPL-0002", title: "Business Process Analysis Audit", date: "2026-02-17", start: "13:00", end: "14:30", auditor: jen, criteria: [Q], process: "Business Process Analyst", workUnit: SD, status: "Completed", createdAgo: 141, updatedAgo: 30 },
      { code: "IAS-0013", planCode: "IAPL-0002", title: "Quality Assurance Process Audit", date: "2026-02-19", start: "09:00", end: "11:00", auditor: gwen, criteria: [Q], process: "Quality Assurance", workUnit: SD, status: "Completed", createdAgo: 139, updatedAgo: 30 },
      { code: "IAS-0014", planCode: "IAPL-0003", title: "Database Administration & Backup Audit", date: "2026-03-11", start: "10:00", end: "12:00", auditor: tenantAdmin, criteria: [S], process: "Database Administrator", workUnit: IT, status: "Completed", createdAgo: 118, updatedAgo: 30 },
      { code: "IAS-0015", planCode: "IAPL-0003", title: "Vulnerability Management Audit", date: "2026-03-13", start: "10:00", end: "12:30", auditor: mon, criteria: [S], process: "Vulnerability Assessment", workUnit: IT, status: "Completed", createdAgo: 116, updatedAgo: 30 },
      { code: "IAS-0016", planCode: "IAPL-0004", title: "Product Management Process Audit", date: "2026-05-13", start: "09:00", end: "11:00", auditor: scott, criteria: [Q], process: "Product Management", workUnit: SD, status: "Completed", createdAgo: 73, updatedAgo: 30 },
      { code: "IAS-0017", planCode: "IAPL-0004", title: "Project Management Process Audit", date: "2026-05-15", start: "09:00", end: "10:30", auditor: scott, criteria: [Q], process: "Project Management", workUnit: SD, status: "Completed", createdAgo: 71, updatedAgo: 30 },
      { code: "IAS-0018", planCode: "IAPL-0001", title: "Quality Assurance Follow-up Audit", date: "2026-06-24", start: "09:00", end: "11:00", auditor: gwen, criteria: [Q], process: "Quality Assurance", workUnit: SD, status: "Scheduled", createdAgo: 5, updatedAgo: 30 },
      { code: "IAS-0019", planCode: "IAPL-0001", title: "Back End Development Process Audit", date: "2026-06-26", start: "13:00", end: "15:00", auditor: jen, criteria: [Q], process: "Back End Development", workUnit: SD, status: "In Progress", createdAgo: 3, updatedAgo: 30 },
      { code: "IAS-0020", planCode: "IAPL-0005", title: "Front End Development Surveillance Audit", date: "2026-09-15", start: "09:00", end: "11:00", auditor: jen, criteria: [Q], process: "Front End Development", workUnit: SD, status: "Scheduled", createdAgo: 18, updatedAgo: 30 },
      { code: "IAS-0021", planCode: "IAPL-0005", title: "Back End Development Surveillance Audit", date: "2026-09-16", start: "09:00", end: "11:00", auditor: scott, criteria: [Q], process: "Back End Development", workUnit: SD, status: "Scheduled", createdAgo: 18, updatedAgo: 30 },
      { code: "IAS-0022", planCode: "IAPL-0005", title: "Quality Assurance Surveillance Audit", date: "2026-09-18", start: "09:00", end: "11:00", auditor: gwen, criteria: [Q], process: "Quality Assurance", workUnit: SD, status: "Scheduled", createdAgo: 18, updatedAgo: 30 },
      { code: "IAS-0023", planCode: "IAPL-0008", title: "Database Administration Audit", date: "2026-11-10", start: "10:00", end: "12:00", auditor: tenantAdmin, criteria: [S], process: "Database Administrator", workUnit: IT, status: "Scheduled", createdAgo: 6, updatedAgo: 30 },
      { code: "IAS-0024", planCode: "IAPL-0008", title: "Vulnerability Management Audit", date: "2026-11-11", start: "10:00", end: "12:00", auditor: mon, criteria: [S], process: "Vulnerability Assessment", workUnit: IT, status: "Scheduled", createdAgo: 6, updatedAgo: 30 },
      { code: "IAS-0025", planCode: "IAPL-0006", title: "Project Management Audit", date: "2026-11-12", start: "09:00", end: "10:30", auditor: scott, criteria: [Q], process: "Project Management", workUnit: SD, status: "Scheduled", createdAgo: 6, updatedAgo: 30 },
      { code: "IAS-0026", planCode: "IAPL-0006", title: "Product Management Audit", date: "2026-11-13", start: "09:00", end: "11:00", auditor: jen, criteria: [Q], process: "Product Management", workUnit: SD, status: "Scheduled", createdAgo: 6, updatedAgo: 30 },
    ];
    const iaSessionIdByCode = new Map<string, string>();
    for (const s of sessSeeds) {
      const programCode = planProgramCode.get(s.planCode)!;
      const row = await IaSession.create({
        orgId: tenant.id, code: s.code, planId: iaPlanIdByCode.get(s.planCode)!, programId: iaProgramIdByCode.get(programCode)!,
        title: s.title, date: s.date, start: s.start, end: s.end, tz: "Asia/Jakarta", auditor: s.auditor, auditee: null,
        criteria: s.criteria, process: s.process, workUnit: s.workUnit, methods: s.methods ?? ["Interview", "Evidence review"],
        location: null, link: null, notes: null, status: s.status, createdBy: s.auditor, lastUpdatedBy: s.auditor,
        activity: [], createdAt: iaDate(s.createdAgo), updatedAt: iaDate(s.updatedAgo),
      });
      iaSessionIdByCode.set(s.code, row.id);
    }

    // Audit findings — OD's exact 5 findings from `iauditSeedExtra`
    // (index.html:11841-11845). The two June-program findings from
    // `iauditSeedIfNeeded` (IAF-0001/IAF-0002) are ported separately below,
    // after this loop, since they carry OD-specific review/issue states that
    // don't fit the uniform shape here.
    type FindSeed = { code: string; programCode: string; planCode: string; sessionCode: string; title: string; type: string; description: string; frameworks: string[]; process: string; workUnit: string; auditor: string; pic: string; issueStatus: string; createdAgo: number };
    const findSeeds: FindSeed[] = [
      { code: "IAF-0010", programCode: "IAP-0002", planCode: "IAPL-0002", sessionCode: "IAS-0013", title: "QA test evidence retention period not defined", type: "Opportunity for Improvement", description: "QA testing evidence is retained, but the retention period is not formally defined.", frameworks: [Q], process: "Quality Assurance", workUnit: SD, auditor: gwen, pic: jen, issueStatus: "Closed", createdAgo: 139 },
      { code: "IAF-0013", programCode: "IAP-0002", planCode: "IAPL-0002", sessionCode: "IAS-0010", title: "Branch naming convention applied inconsistently", type: "Observation", description: "Front-end repositories follow the branch naming convention inconsistently across teams.", frameworks: [Q], process: "Front End Development", workUnit: SD, auditor: jen, pic: jen, issueStatus: "Closed", createdAgo: 148 },
      { code: "IAF-0011", programCode: "IAP-0003", planCode: "IAPL-0003", sessionCode: "IAS-0014", title: "Database backup restore test not evidenced", type: "Nonconformity", description: "Backups are performed, but periodic restore tests are not evidenced for the audited period.", frameworks: [S], process: "Database Administrator", workUnit: IT, auditor: tenantAdmin, pic: tenantAdmin, issueStatus: "Closed", createdAgo: 118 },
      { code: "IAF-0012", programCode: "IAP-0003", planCode: "IAPL-0003", sessionCode: "IAS-0015", title: "Vulnerability remediation SLA exceeded for medium findings", type: "Nonconformity", description: "Several medium-severity vulnerabilities exceeded the defined remediation SLA.", frameworks: [S], process: "Vulnerability Assessment", workUnit: IT, auditor: tenantAdmin, pic: tenantAdmin, issueStatus: "Issued", createdAgo: 116 },
      { code: "IAF-0014", programCode: "IAP-0004", planCode: "IAPL-0004", sessionCode: "IAS-0016", title: "Product backlog prioritization not documented", type: "Opportunity for Improvement", description: "Backlog prioritization decisions are made in meetings but are not documented for traceability.", frameworks: [Q], process: "Product Management", workUnit: SD, auditor: scott, pic: scott, issueStatus: "Issued", createdAgo: 73 },
    ];
    for (const f of findSeeds) {
      await IaFinding.create({
        orgId: tenant.id, code: f.code, programId: iaProgramIdByCode.get(f.programCode)!, planId: iaPlanIdByCode.get(f.planCode)!,
        sessionId: iaSessionIdByCode.get(f.sessionCode)!, title: f.title, type: f.type, description: f.description,
        evidence: "Reviewed during the audit session.", frameworks: f.frameworks, criteria: null,
        process: f.process, workUnit: f.workUnit, site: "", auditor: f.auditor, pic: f.pic, due: null,
        reviewRequired: true, reviewStatus: "Approved", reviewDecision: "Approve Finding", reviewNotes: null,
        // OD `mkF` defaults: `issuedTo` empty, `issuedDate` at creation for every
        // extra finding, `updatedAt` d(28) (no `u` passed) — ported verbatim.
        issueStatus: f.issueStatus, issuedTo: null, issuedDate: iaIso(f.createdAgo),
        linkedNC: null, linkedImp: null, createdBy: f.auditor, lastUpdatedBy: f.auditor,
        activity: [{ ts: iaIso(f.createdAgo), user: f.auditor, action: "submitted this finding", summary: f.type }],
        createdAt: iaDate(f.createdAgo), updatedAt: iaDate(28),
      });
    }

    // Audit findings — OD's original two June-program findings from
    // `iauditSeedIfNeeded` (app.html:23073), deliberately created
    // with their own fields (not the uniform `findSeeds` shape above) because
    // OD gives them distinct review/issue states: IAF-0001 is still
    // "Pending Lead Auditor Review" and IAF-0002 is issued and routed to an
    // improvement opportunity.
    const iaf1 = await IaFinding.create({
      orgId: tenant.id, code: "IAF-0001", programId: iaProgramIdByCode.get("IAP-0001")!, planId: iaPlanIdByCode.get("IAPL-0007")!,
      sessionId: iaSessionIdByCode.get("IAS-0002")!, title: "Access control procedure missing document owner", type: "Nonconformity",
      description: "The access control procedure exists, but document owner and review frequency are not defined.",
      evidence: "Access control procedure record reviewed during audit session IAS-0002.",
      frameworks: [S], criteria: "Documented information control", process: "Database Administrator", workUnit: IT, site: "",
      auditor: tenantAdmin, pic: jen, due: null,
      reviewRequired: true, reviewStatus: "Pending Lead Auditor Review", reviewDecision: null, reviewNotes: null,
      issueStatus: "Pending Lead Auditor Review", issuedTo: null, issuedDate: null, linkedNC: null, linkedImp: null,
      createdBy: tenantAdmin, lastUpdatedBy: tenantAdmin,
      activity: [{ ts: iaIso(3), user: tenantAdmin, action: "submitted this finding", summary: "Pending lead auditor review" }],
      createdAt: iaDate(3), updatedAt: iaDate(3),
    });
    const iaf2 = await IaFinding.create({
      orgId: tenant.id, code: "IAF-0002", programId: iaProgramIdByCode.get("IAP-0001")!, planId: iaPlanIdByCode.get("IAPL-0001")!,
      sessionId: iaSessionIdByCode.get("IAS-0001")!, title: "Improve QA evidence traceability", type: "Opportunity for Improvement",
      description: "QA testing evidence exists, but test result traceability to release approval can be improved.",
      evidence: "Sampled QA records from June release cycle.",
      frameworks: [Q], criteria: "", process: "Quality Assurance", workUnit: SD, site: "",
      auditor: jen, pic: jen, due: null,
      reviewRequired: true, reviewStatus: "Approved", reviewDecision: "Approve Finding", reviewNotes: "Valid improvement opportunity.",
      issueStatus: "Issued", issuedTo: jen, issuedDate: iaIso(3), linkedNC: null, linkedImp: "IMP-0002",
      createdBy: jen, lastUpdatedBy: jen,
      activity: [
        { ts: iaIso(4), user: jen, action: "submitted this finding", summary: "OFI" },
        { ts: iaIso(3), user: jen, action: "approved the finding", summary: "Approved" },
        { ts: iaIso(3), user: jen, action: "issued the finding", summary: `Issued to ${jen}` },
      ],
      createdAt: iaDate(4), updatedAt: iaDate(3),
    });

    // Ensure IMP-0002 exists for the linked improvement (OD's
    // `iauditSeedIfNeeded`, app.html:23073: "ensure IMP-0002 exists for
    // the linked improvement"). Represented the same way seed.ts already
    // represents IMP-0001's concern origin (`sourceConcernId`/
    // `sourceConcernCode`, see the Phase 9a concern chain above) but for a
    // finding origin instead, so both improvements carry their source via
    // the same `sourceXId` + `sourceXCode` (UUID + code) shape.
    const imp2Seeded = await ImplementationRecord.findOne({ where: { module: "improvements", code: "IMP-0002" } });
    if (!imp2Seeded) {
      const imp2 = await ImplementationRecord.create({
        orgId: tenant.id, module: "improvements", code: "IMP-0002",
        title: "Improve QA evidence traceability", status: "Open", owner: jen,
        elementId: null, frameworks: [Q],
        data: {
          // `routeFinding` (internalAudit.service.ts:603/619) stores the finding's CODE in
          // `sourceFindingId`, and the frontend's crossLinks.ts renders that value directly as
          // the link label. Seeding a UUID here would show a raw UUID in the Links column, so the
          // seed matches what the live service actually writes rather than the tidier shape used
          // for concern links. (The service-level inconsistency with `sourceConcernId` is a
          // separate pre-existing issue.)
          sourceFindingId: iaf2.code,
          category: "Process Improvement", process: "Quality Assurance", site: "", workUnit: SD,
          description: "QA testing evidence exists, but test result traceability to release approval can be improved.",
          suggestedAction: "Link QA test results to release approval records.",
          owner: jen, due: "", priority: "Medium", evidence: "",
        },
        createdAt: iaDate(3), updatedAt: iaDate(3),
      });
      await RecordEvent.create({
        orgId: tenant.id, module: "improvements", recordId: imp2.id, type: "activity", actor: jen,
        text: "created this improvement opportunity — From audit finding IAF-0002", createdAt: iaDate(3),
      });
    }

    // Audit reports — OD's `iauditSeedIfNeeded` (app.html:23073) and
    // `iauditSeedExtra` (index.html:11852) reports. `IaReport.plans` /
    // `.sessions` / `.findings` are arrays of CODE strings, matching how
    // `generateReport` (internalAudit.service.ts) populates them from
    // `IaPlan`/`IaSession`/`IaFinding` `.code` columns — not UUIDs.
    await IaReport.create({
      orgId: tenant.id, code: "IAR-0001", programId: iaProgramIdByCode.get("IAP-0001")!, period: "2026-06",
      plans: ["IAPL-0001", "IAPL-0007"], sessions: ["IAS-0001", "IAS-0002"], findings: [iaf1.code, iaf2.code],
      evidenceSummary: true, followupIncluded: true, summary: null,
      conclusion: "The internal audit determined that the audited processes are generally implemented and maintained. Several findings were identified requiring correction, corrective action, or improvement follow-up.",
      preparedBy: jen, approvedBy: null, reportDate: iaIso(2), status: "Draft",
      createdBy: jen, lastUpdatedBy: jen,
      activity: [{ ts: iaIso(2), user: jen, action: "generated the report", summary: "Draft report" }],
      createdAt: iaDate(2), updatedAt: iaDate(2),
    });
    await IaReport.create({
      orgId: tenant.id, code: "IAR-0002", programId: iaProgramIdByCode.get("IAP-0003")!, period: "2026-03",
      plans: ["IAPL-0003"], sessions: ["IAS-0014", "IAS-0015"], findings: ["IAF-0011", "IAF-0012"],
      evidenceSummary: true, followupIncluded: true, summary: null,
      conclusion: "The IT infrastructure and information security processes are generally implemented. One nonconformity was corrected and one remains under follow-up.",
      preparedBy: tenantAdmin, approvedBy: jen, reportDate: iaIso(110), status: "Issued",
      createdBy: tenantAdmin, lastUpdatedBy: tenantAdmin,
      activity: [
        { ts: iaIso(112), user: tenantAdmin, action: "generated the report", summary: "Q1 IT audit report" },
        { ts: iaIso(108), user: jen, action: "issued the report", summary: "Issued" },
      ],
      createdAt: iaDate(112), updatedAt: iaDate(108),
    });
  }

  // 14b. Phase 9b — Work Units & Business Processes (ISO 5.3, OD
  //      `wuEnsureBps`/`wuSeedIfNeeded`, index.html:9077-9181): the 32
  //      globally seeded Business Processes as `processes` register entries
  //      (global to the platform in OD; scoped to the demo tenant here since
  //      BE's `processes` module is org-scoped, not platform-shared) and PT
  //      Hammer Industries' 12 seeded Work Units, wired to their process
  //      links, sites, and — where OD's names match BE's already-ported
  //      Scope Dataset catalog (scopeDatasets.data.ts) — virtual environments
  //      and external dependencies.
  const BP_NAMES: string[] = [
    "Front End Development", "Back End Development", "Business Process Analyst", "Database Administrator",
    "Quality Assurance", "Vulnerability Assessment", "Product Management", "Project Management",
    "Mobile Development", "Solution Architecture", "Systems Administration", "Network Administration",
    "Software Testing", "Release Management", "Security Operations", "Incident Response",
    "Access Management", "Requirements Management", "Change Management", "Configuration Management",
    "Technical Support", "Customer Support", "Service Desk", "Procurement",
    "Vendor Management", "Human Resources", "Recruitment", "Training & Competence",
    "Finance & Accounting", "Internal Audit", "Document Control", "Management Review",
  ];
  const bpIdByName = new Map<string, string>();
  for (let i = 0; i < BP_NAMES.length; i++) {
    const name = BP_NAMES[i];
    const [rec] = await ImplementationRecord.findOrCreate({
      where: { orgId: tenant.id, module: "processes", title: name },
      defaults: {
        orgId: tenant.id, module: "processes", code: `PRC-${String(i + 1).padStart(4, "0")}`,
        title: name, status: "Active", owner: null,
        // `sourceType` mirrors OD's seeded-record marker (`bizProcesses[].sourceType`,
        // index.html:9081) so a future edit-protection feature has something to
        // key off; the `processes` module itself has no BE edit/archive
        // protection for seeded rows yet (OD 12998/13000 has no BE equivalent).
        data: { sourceType: "Seeded" },
      },
    });
    bpIdByName.set(name, rec.id);
  }

  await ensureScopeDatasetSeed();
  const envIdByName = new Map((await ScopeDataset.findAll({ where: { kind: "env", orgId: null } })).map((d) => [d.name, d.id]));
  const depIdByName = new Map((await ScopeDataset.findAll({ where: { kind: "dep", orgId: null } })).map((d) => [d.name, d.id]));
  const wuSiteIds = [siteHq.id, siteFactory.id, siteWarehouse.id];
  const daysAgo = (n: number): Date => new Date(Date.now() - n * 86400000);
  const wuSeed: { name: string; site: number; desc: string; bps: string[]; envs: string[]; deps: string[]; status: string; by: string; ago: number }[] = [
    { name: "Software Development", site: 0, desc: "Responsible for software product development, application features, technical implementation, and development delivery.", bps: ["Front End Development","Back End Development","Business Process Analyst","Quality Assurance","Product Management","Project Management"], envs: ["Production Environment","Development Environment","Source Code Repository","CI/CD Pipeline"], deps: ["SaaS Application Provider","Source Code Repository Provider","CI/CD Platform Provider"], status: "Applicable", by: "Jennifer Susan Walters", ago: 4 },
    { name: "IT Infrastructure", site: 0, desc: "Responsible for infrastructure, systems availability, database administration, security support, and technical operations.", bps: ["Database Administrator","Systems Administration","Network Administration","Vulnerability Assessment","Project Management"], envs: ["Production Environment","Cloud Infrastructure","Backup Environment","Monitoring Platform"], deps: ["Cloud Hosting Provider","Data Center Provider","Backup Service Provider"], status: "Applicable", by: "Peter Benjamin Parker", ago: 8 },
    { name: "Quality Assurance", site: 1, desc: "Responsible for testing, verification, quality control, and release support.", bps: ["Quality Assurance","Software Testing","Project Management"], envs: ["Testing / Staging Environment","User Acceptance Testing Environment"], deps: ["Penetration Testing Provider"], status: "Applicable", by: "Wanda Maximoff", ago: 12 },
    { name: "Production Operations", site: 1, desc: "Runs the assembly and finishing lines, production scheduling, and output quality at the factory.", bps: ["Configuration Management","Change Management","Quality Assurance"], envs: ["Production Environment"], deps: ["Equipment Supplier","Maintenance Service Provider"], status: "Applicable", by: "Scott Edward Harris Lang", ago: 10 },
    { name: "Maintenance & Engineering", site: 1, desc: "Preventive and corrective maintenance of production equipment and facilities.", bps: ["Configuration Management","Incident Response"], envs: ["Production Environment"], deps: ["Maintenance Service Provider","Calibration Service Provider"], status: "Applicable", by: "Scott Edward Harris Lang", ago: 9 },
    { name: "Warehouse Operations", site: 2, desc: "Receiving, storage, inventory control, and dispatch of finished goods.", bps: ["Configuration Management","Vendor Management"], envs: ["Production Environment"], deps: ["Courier / Logistics Provider"], status: "Applicable", by: "Gwendolyne Maxine Stacy", ago: 7 },
    { name: "Logistics & Distribution", site: 2, desc: "Outbound logistics, carrier coordination, and distribution to customers.", bps: ["Vendor Management","Customer Support"], envs: [], deps: ["Courier / Logistics Provider","Transportation Provider"], status: "Applicable", by: "Gwendolyne Maxine Stacy", ago: 6 },
    { name: "Procurement", site: 0, desc: "Sourcing, supplier evaluation, purchasing, and contract management.", bps: ["Procurement","Vendor Management"], envs: ["SaaS Applications"], deps: ["Office Supplier","Equipment Supplier"], status: "Applicable", by: "Jennifer Susan Walters", ago: 11 },
    { name: "Human Resources", site: 0, desc: "Recruitment, onboarding, competence development, and personnel administration.", bps: ["Human Resources","Recruitment","Training & Competence"], envs: ["SaaS Applications","Identity Provider"], deps: ["Recruitment Provider","Training Provider"], status: "Applicable", by: "Jennifer Susan Walters", ago: 13 },
    { name: "Finance & Administration", site: 0, desc: "Financial management, accounting, and administrative support.", bps: ["Finance & Accounting","Internal Audit"], envs: ["SaaS Applications"], deps: ["Banking Provider","External Auditor"], status: "Applicable", by: "Jennifer Susan Walters", ago: 14 },
    { name: "Customer Service", site: 0, desc: "Customer support, complaint handling, and service-delivery coordination.", bps: ["Customer Support","Service Desk","Technical Support"], envs: ["Customer Portal","Ticketing System"], deps: ["CRM Provider","Call Center Provider"], status: "Applicable", by: "Jennifer Susan Walters", ago: 5 },
    { name: "Information Security", site: 0, desc: "Security operations, access management, incident response, and risk monitoring.", bps: ["Security Operations","Access Management","Incident Response","Vulnerability Assessment"], envs: ["Identity Provider","Monitoring Platform","Logging Platform"], deps: ["Security Monitoring Provider","SOC Provider","IAM / SSO Provider"], status: "Applicable", by: "Peter Benjamin Parker", ago: 3 },
  ];
  for (let i = 0; i < wuSeed.length; i++) {
    const w = wuSeed[i];
    const createdAt = daysAgo(w.ago);
    await WorkUnit.findOrCreate({
      where: { orgId: tenant.id, name: w.name },
      defaults: {
        orgId: tenant.id, code: `WU-${String(i + 1).padStart(4, "0")}`, name: w.name,
        siteId: wuSiteIds[w.site] ?? wuSiteIds[0], status: w.status, description: w.desc,
        processIds: w.bps.map((n) => bpIdByName.get(n)).filter((x): x is string => Boolean(x)),
        envIds: w.envs.map((n) => envIdByName.get(n)).filter((x): x is string => Boolean(x)),
        depIds: w.deps.map((n) => depIdByName.get(n)).filter((x): x is string => Boolean(x)),
        createdBy: w.by, createdAt, updatedAt: createdAt,
      },
    });
  }

  // 14b1b. Business Process step flows — OD `bpSeedStepsIfNeeded` (core.js:9408,
  //        the five governance flows with decision branches + Yes/No edge
  //        labels), `bpControlSeedIfNeeded` (core.js:9794, pinned
  //        responsible/resources/targets on four control steps) and
  //        `bpSeedSteps44` (core.js:9468, a 4-step §4.4 flow for every other
  //        process, responsible cycled from OD's 10-name pool in build order).
  //        Steps live in each record's `data.steps[]` (the shape
  //        process.service.ts reads); ids are deterministic `<code>-s<n>`,
  //        `col` mirrors OD's grid column (order index) and `next`/`edgeLabels`
  //        mirror the seeded connectors exactly. Idempotent: only fills a
  //        record whose data has no steps (OD's `if(bp.steps.length)return`).
  //        OD's step `roleId` is left "" here — the BE seeds no RoleTemplate
  //        rows yet for it to reference. Mirrored in the FE mockClient seed.
  const wuIdByName = new Map((await WorkUnit.findAll({ where: { orgId: tenant.id } })).map((w) => [w.name, w.id]));
  const bpPool = ["Jennifer Susan Walters", "Bobbi Morse", "Scott Edward Harris Lang", "Daniel Rand", "Maria Rambeau", "Gwendolyne Maxine Stacy", "Peter Benjamin Parker", "Luke Cage", "Wanda Maximoff", "Matthew Michael Murdock"];
  let bpPoolIdx = 0;
  const bpNp = (): string => bpPool[bpPoolIdx++ % bpPool.length];
  type BpStepSeed = { n: string; w?: string; t?: "decision"; nexts?: number[]; resp?: string; res?: string; tgt?: string };
  const bpStepFlows: Record<string, Record<string, unknown>[]> = {};
  const bpBuild = (name: string, wu: string, defs: BpStepSeed[]): void => {
    const code = `PRC-${String(BP_NAMES.indexOf(name) + 1).padStart(4, "0")}`;
    const ids = defs.map((_, i) => `${code}-s${i + 1}`);
    bpStepFlows[name] = defs.map((d, i) => {
      const next = d.nexts ? d.nexts.map((k) => ids[k]) : i < defs.length - 1 ? [ids[i + 1]] : [];
      const step: Record<string, unknown> = {
        id: ids[i], order: i + 1, col: i, name: d.n, description: "",
        roleId: "", workUnitId: wuIdByName.get(d.w ?? wu) ?? "",
        responsible: d.resp ?? bpNp(), resources: d.res ?? "", targets: d.tgt ?? "",
        type: d.t ?? "task", next,
      };
      if (d.t === "decision" && next.length) step.edgeLabels = Object.fromEntries(next.map((tid, k) => [tid, k === 0 ? "Yes" : k === 1 ? "No" : `Path ${k + 1}`]));
      return step;
    });
  };
  // bpSeedSteps44's 27 builds, in OD call order (the pool depends on it).
  bpBuild("Front End Development", "Software Development", [
    { n: "Refine UI requirements", tgt: "100% of stories have approved designs before build", res: "Figma; design system; product-owner time" },
    { n: "Implement components", tgt: "≥ 90% component test coverage; 0 critical accessibility defects", res: "React toolchain; shared component library; 2 FE engineers" },
    { n: "Code review & merge", tgt: "100% of PRs peer-reviewed; review turnaround ≤ 1 day", res: "Git PR workflow; CI pipeline" },
    { n: "Release to staging", tgt: "0 build-breaking merges; staging deploy ≤ 15 min", res: "CI/CD; staging environment" },
  ]);
  bpBuild("Back End Development", "Software Development", [
    { n: "Design API contract", tgt: "100% of endpoints documented before implementation", res: "OpenAPI spec; architecture review" },
    { n: "Implement services", tgt: "≥ 85% unit-test coverage; p95 latency ≤ 300 ms", res: "Service framework; 2 BE engineers; test data" },
    { n: "Integration testing", tgt: "0 critical defects escaping to staging", res: "Integration test suite; CI runners" },
    { n: "Deploy & monitor", tgt: "≥ 99.5% service availability; error rate ≤ 1%", res: "Observability stack; on-call rota" },
  ]);
  bpBuild("Business Process Analyst", "Software Development", [
    { n: "Elicit process requirements", tgt: "100% of requirements traceable to a stakeholder need", res: "Interview guide; stakeholder time" },
    { n: "Model as-is / to-be", tgt: "Every in-scope process modelled and validated", res: "BPMN tooling; process owners" },
    { n: "Validate with stakeholders", tgt: "≥ 95% sign-off on documented processes", res: "Workshop facilitation; review sessions" },
    { n: "Hand off to delivery", tgt: "0 requirements reopened after hand-off", res: "Backlog tooling; delivery lead" },
  ]);
  bpBuild("Database Administrator", "IT Infrastructure", [
    { n: "Provision & configure database", tgt: "100% of instances configured to hardening baseline", res: "DB platform; configuration baseline" },
    { n: "Backup & recovery", tgt: "100% of backups verified; RPO ≤ 1 h, RTO ≤ 4 h", res: "Backup tooling; off-site storage" },
    { n: "Performance tuning", tgt: "p95 query time ≤ 200 ms; 0 unindexed hot queries", res: "Monitoring; query analyzer" },
    { n: "Access & audit review", tgt: "100% of privileged access reviewed quarterly", res: "Access review workflow; audit log" },
  ]);
  bpBuild("Quality Assurance", "Quality Assurance", [
    { n: "Define quality criteria", tgt: "Acceptance criteria defined for 100% of features", res: "Quality plan; test strategy" },
    { n: "Prepare & run test cases", tgt: "≥ 95% planned test cases executed per release", res: "Test management tool; QA engineers" },
    { n: "Log & triage defects", tgt: "100% of defects triaged within 1 business day", res: "Defect tracker; triage board" },
    { n: "Release quality sign-off", tgt: "0 known critical defects released", res: "Release checklist; QM approval" },
  ]);
  bpBuild("Vulnerability Assessment", "Information Security", [
    { n: "Scope & schedule scan", tgt: "100% of production assets in scope each quarter", res: "Asset inventory; scan schedule" },
    { n: "Run vulnerability scan", tgt: "Authenticated scans on ≥ 95% of assets", res: "Vulnerability scanner; scan credentials" },
    { n: "Triage & prioritize findings", tgt: "Critical findings triaged ≤ 24 h", res: "CVSS scoring; risk register" },
    { n: "Remediate & verify", tgt: "≥ 90% of critical findings closed within SLA", res: "Patch management; re-scan" },
  ]);
  bpBuild("Product Management", "Software Development", [
    { n: "Capture & prioritize backlog", tgt: "Backlog prioritized against value every sprint", res: "Product backlog; stakeholder input" },
    { n: "Define release scope", tgt: "100% of release items have acceptance criteria", res: "Roadmap; product-owner time" },
    { n: "Coordinate delivery", tgt: "≥ 85% sprint commitment met", res: "Delivery team; sprint cadence" },
    { n: "Review outcomes & feedback", tgt: "Feature adoption reviewed within 30 days of launch", res: "Analytics; customer feedback" },
  ]);
  bpBuild("Project Management", "Software Development", [
    { n: "Initiate & plan project", tgt: "Approved plan & baseline before execution", res: "Project charter; schedule tooling" },
    { n: "Execute & coordinate", tgt: "≥ 90% of milestones met on schedule", res: "Team; RAID log" },
    { n: "Monitor & control", tgt: "Schedule/cost variance within ±10%", res: "Status reporting; steering reviews" },
    { n: "Close & capture lessons", tgt: "Lessons learned recorded for 100% of projects", res: "Closure report; knowledge base" },
  ]);
  bpBuild("Mobile Development", "Software Development", [
    { n: "Refine mobile requirements", tgt: "Designs approved for 100% of stories before build", res: "Design system; product owner" },
    { n: "Build & test on devices", tgt: "Verified on top 90% device/OS coverage", res: "Device lab; CI; 2 mobile engineers" },
    { n: "Code review & merge", tgt: "100% of PRs reviewed; ≤ 1 day turnaround", res: "Git workflow; CI" },
    { n: "Store release", tgt: "0 rejected store submissions; crash-free ≥ 99.5%", res: "Store accounts; release checklist" },
  ]);
  bpBuild("Solution Architecture", "Software Development", [
    { n: "Assess requirements & constraints", tgt: "Non-functional requirements defined for 100% of solutions", res: "Architecture intake; stakeholder time" },
    { n: "Design target architecture", tgt: "Every design passes architecture review", res: "Reference architecture; modelling tools" },
    { n: "Review & approve design", tgt: "100% of designs approved before build", res: "Architecture review board" },
    { n: "Support implementation", tgt: "≤ 5% of build effort lost to design rework", res: "Delivery teams; design guidance" },
  ]);
  bpBuild("Systems Administration", "IT Infrastructure", [
    { n: "Provision & harden systems", tgt: "100% of servers built to hardening baseline", res: "Config baseline; provisioning tooling" },
    { n: "Patch & maintain", tgt: "≥ 95% of systems patched within SLA", res: "Patch management; maintenance windows" },
    { n: "Monitor & respond", tgt: "≥ 99.5% infrastructure availability", res: "Monitoring; alerting; on-call" },
    { n: "Capacity & housekeeping", tgt: "0 outages caused by capacity exhaustion", res: "Capacity dashboard; housekeeping jobs" },
  ]);
  bpBuild("Network Administration", "IT Infrastructure", [
    { n: "Plan network changes", tgt: "100% of changes assessed before implementation", res: "Network design; change process" },
    { n: "Configure & segment", tgt: "Segmentation baseline applied to 100% of zones", res: "Firewalls; switches; config templates" },
    { n: "Monitor performance & security", tgt: "≥ 99.5% link availability; 0 undetected outages", res: "NMS; flow monitoring" },
    { n: "Review & optimize", tgt: "Configuration reviewed against baseline quarterly", res: "Config audit; review checklist" },
  ]);
  bpBuild("Software Testing", "Quality Assurance", [
    { n: "Plan test approach", tgt: "Test plan approved for 100% of releases", res: "Test strategy; risk-based plan" },
    { n: "Author test cases", tgt: "≥ 95% requirement coverage by test cases", res: "Test management tool" },
    { n: "Execute & record results", tgt: "≥ 95% planned cases executed; results logged", res: "Test environments; QA engineers" },
    { n: "Report & regression", tgt: "Full regression before every production release", res: "Automation suite; CI" },
  ]);
  bpBuild("Release Management", "IT Infrastructure", [
    { n: "Plan release", tgt: "Every release has an approved plan & rollback", res: "Release calendar; change board" },
    { n: "Build & package", tgt: "100% of artifacts built from source control", res: "CI pipeline; artifact registry" },
    { n: "Deploy to production", tgt: "≥ 98% of releases without rollback", res: "CD pipeline; maintenance window" },
    { n: "Verify & close", tgt: "Post-release checks pass within 30 min", res: "Smoke tests; monitoring" },
  ]);
  bpBuild("Security Operations", "Information Security", [
    { n: "Monitor security events", tgt: "≥ 95% of critical alerts triaged ≤ 30 min", res: "SIEM; 24×7 monitoring" },
    { n: "Investigate alerts", tgt: "0 confirmed incidents undetected > 24 h", res: "Analyst playbooks; threat intel" },
    { n: "Contain & escalate", tgt: "Containment of confirmed incidents ≤ 1 h", res: "Response runbooks; escalation matrix" },
    { n: "Review & tune controls", tgt: "Detection rules reviewed monthly", res: "Rule tuning; lessons learned" },
  ]);
  bpBuild("Access Management", "Information Security", [
    { n: "Receive access request", tgt: "100% of access requests logged & authorized", res: "Access request workflow; approver" },
    { n: "Verify & approve", tgt: "Access granted on least-privilege basis", res: "Role matrix; approval workflow" },
    { n: "Provision access", tgt: "Access provisioned ≤ 1 business day", res: "IAM tooling; directory services" },
    { n: "Periodic access review", tgt: "100% of privileged access recertified quarterly", res: "Access recertification campaign" },
  ]);
  bpBuild("Requirements Management", "Software Development", [
    { n: "Capture requirements", tgt: "100% of requirements uniquely identified", res: "Requirements repository; stakeholders" },
    { n: "Analyze & baseline", tgt: "Baseline approved before development starts", res: "Analysis workshops; product owner" },
    { n: "Trace & manage changes", tgt: "100% of requirements traceable to delivery", res: "Traceability matrix; change control" },
    { n: "Validate delivery", tgt: "0 requirements reopened post-acceptance", res: "Acceptance testing; sign-off" },
  ]);
  bpBuild("Configuration Management", "Production Operations", [
    { n: "Identify configuration items", tgt: "100% of production CIs recorded in the CMDB", res: "CMDB; discovery tooling" },
    { n: "Control changes to CIs", tgt: "0 unauthorized changes to baselined CIs", res: "Change control; version control" },
    { n: "Verify configuration", tgt: "≥ 98% CMDB accuracy on audit", res: "Configuration audit; reconciliation" },
    { n: "Report & improve", tgt: "Configuration status reported monthly", res: "Reporting; review meeting" },
  ]);
  bpBuild("Technical Support", "Customer Service", [
    { n: "Receive & log ticket", tgt: "100% of contacts logged as tickets", res: "Ticketing system; support desk" },
    { n: "Diagnose issue", tgt: "≥ 80% resolved at first line", res: "Knowledge base; diagnostics" },
    { n: "Resolve or escalate", tgt: "Priority-1 resolution ≤ 4 h", res: "Escalation path; specialist teams" },
    { n: "Confirm & close", tgt: "≥ 90% customer satisfaction on closed tickets", res: "Satisfaction survey" },
  ]);
  bpBuild("Customer Support", "Customer Service", [
    { n: "Receive customer enquiry", tgt: "100% of enquiries acknowledged ≤ 1 h", res: "Omni-channel desk; CRM" },
    { n: "Assess & respond", tgt: "≥ 85% first-contact resolution", res: "Knowledge base; support agents" },
    { n: "Escalate complex cases", tgt: "Escalations handled within SLA", res: "Escalation matrix; back office" },
    { n: "Follow up & close", tgt: "≥ 90% CSAT; 0 cases closed without confirmation", res: "CSAT survey; CRM" },
  ]);
  bpBuild("Service Desk", "Customer Service", [
    { n: "Log service request", tgt: "100% of requests logged & categorized", res: "ITSM tool; service catalogue" },
    { n: "Classify & prioritize", tgt: "Correct priority set on ≥ 95% of tickets", res: "Priority matrix" },
    { n: "Fulfil or route", tgt: "Standard requests fulfilled ≤ 2 business days", res: "Fulfilment teams; automation" },
    { n: "Review & report", tgt: "SLA attainment ≥ 95% monthly", res: "SLA dashboard; reporting" },
  ]);
  bpBuild("Procurement", "Finance & Administration", [
    { n: "Raise purchase requisition", tgt: "100% of purchases raised against a requisition", res: "Procurement system; budget owner" },
    { n: "Source & evaluate suppliers", tgt: "≥ 2 quotes for purchases above threshold", res: "Approved supplier list; evaluation criteria" },
    { n: "Approve & issue PO", tgt: "100% of POs approved per authority matrix", res: "Approval workflow; authority matrix" },
    { n: "Receive & verify goods", tgt: "0 payments without verified receipt", res: "Goods receipt; three-way match" },
  ]);
  bpBuild("Vendor Management", "Finance & Administration", [
    { n: "Onboard & qualify vendor", tgt: "100% of vendors qualified before first order", res: "Due-diligence checklist; contracts" },
    { n: "Define SLAs & contracts", tgt: "Signed SLA in place for 100% of active vendors", res: "Contract templates; legal review" },
    { n: "Monitor performance", tgt: "≥ 90% of vendors meeting SLA", res: "Vendor scorecard; review meetings" },
    { n: "Review & renew", tgt: "Performance reviewed before every renewal", res: "Renewal calendar; evaluation" },
  ]);
  bpBuild("Human Resources", "Human Resources", [
    { n: "Manage employee records", tgt: "100% of records complete & current", res: "HRIS; personnel files" },
    { n: "Administer onboarding/offboarding", tgt: "Onboarding completed ≤ 5 days of start", res: "Onboarding checklist; IT & facilities" },
    { n: "Handle HR requests", tgt: "≥ 95% of requests resolved within SLA", res: "HR service desk; policies" },
    { n: "Compliance & reporting", tgt: "0 lapses in mandatory HR compliance", res: "Compliance calendar; audits" },
  ]);
  bpBuild("Recruitment", "Human Resources", [
    { n: "Define role & approve vacancy", tgt: "Approved job description before sourcing", res: "Hiring manager; authority matrix" },
    { n: "Source & screen candidates", tgt: "Shortlist delivered ≤ 10 business days", res: "ATS; sourcing channels" },
    { n: "Interview & select", tgt: "Structured scorecard used for 100% of interviews", res: "Interview panel; scorecards" },
    { n: "Offer & onboard", tgt: "≥ 90% offer acceptance; onboarding scheduled", res: "Offer workflow; HR onboarding" },
  ]);
  bpBuild("Training & Competence", "Human Resources", [
    { n: "Identify competence needs", tgt: "Training needs identified for 100% of roles", res: "Competence matrix; gap analysis" },
    { n: "Plan & schedule training", tgt: "Annual plan approved & communicated", res: "Training calendar; budget" },
    { n: "Deliver & record training", tgt: "≥ 90% training completion on plan", res: "LMS; trainers; records" },
    { n: "Evaluate effectiveness", tgt: "Effectiveness assessed for 100% of key training", res: "Post-training assessment; reassessment" },
  ]);
  bpBuild("Finance & Accounting", "Finance & Administration", [
    { n: "Record transactions", tgt: "100% of transactions posted within period", res: "Accounting system; source documents" },
    { n: "Approve payments", tgt: "100% of payments approved per authority matrix", res: "Approval workflow; segregation of duties" },
    { n: "Reconcile accounts", tgt: "All key accounts reconciled monthly", res: "Reconciliation tooling; bank feeds" },
    { n: "Report & close period", tgt: "Month-end close ≤ 5 business days", res: "Reporting pack; review" },
  ]);
  // The five governance flows (bpSeedStepsIfNeeded branches + bpSeedSteps44
  // `back()` targets/resources + bpControlSeedIfNeeded pins), built after the
  // 27 above so the responsible pool cycles like OD's backfill.
  bpBuild("Internal Audit", "Quality Assurance", [
    { n: "Plan audit programme", tgt: "Annual audit programme approved & communicated", res: "Audit programme; management input" },
    { n: "Prepare audit plan & checklist", tgt: "Audit plan & checklist for 100% of audits", res: "Audit checklist; sampling plan" },
    { n: "Conduct opening meeting", tgt: "Opening meeting held for every audit", res: "Opening meeting; attendance record" },
    { n: "Gather audit evidence", resp: "Jennifer Susan Walters", tgt: "100% of planned audit scope covered; evidence logged for every finding.", res: "Audit checklist; sampling plan; auditor time." },
    { n: "Findings raised?", t: "decision", nexts: [5, 6], tgt: "Findings graded consistently", res: "Grading criteria" },
    { n: "Write nonconformities", tgt: "Nonconformities written with objective evidence", res: "NC template" },
    { n: "Issue audit report", tgt: "Audit report issued ≤ 5 business days", res: "Report template" },
    { n: "Review & approve report", tgt: "100% of reports reviewed & approved", res: "Quality Manager review" },
  ]);
  bpBuild("Document Control", "Quality Assurance", [
    { n: "Draft document", tgt: "Drafts follow the controlled template", res: "Document template; authoring tool" },
    { n: "Technical review", w: "IT Infrastructure", tgt: "100% of documents technically reviewed", res: "Reviewer time; review record" },
    { n: "Approve for release", tgt: "0 documents released without approval", res: "Approval workflow" },
    { n: "Publish & distribute", tgt: "Current version available to 100% of users", res: "Document register; distribution list" },
    { n: "Periodic review", tgt: "≥ 95% of documents within review date", res: "Review schedule; reminders" },
  ]);
  bpBuild("Management Review", "Quality Assurance", [
    { n: "Collect review inputs", tgt: "All required §9.3 inputs collected", res: "Review input pack" },
    { n: "Compile performance data", tgt: "Performance data compiled for 100% of KPIs", res: "Performance dashboard" },
    { n: "Conduct management review meeting", tgt: "Review held at planned interval", res: "Meeting; top management" },
    { n: "Record decisions & outputs", tgt: "Decisions & outputs recorded for every review", res: "Minutes; action log" },
    { n: "Assign improvement actions", tgt: "Improvement actions assigned with owners", res: "Action register" },
    { n: "Track actions to closure", tgt: "≥ 90% of review actions closed on time", res: "Action tracking" },
  ]);
  bpBuild("Change Management", "IT Infrastructure", [
    { n: "Raise change request", nexts: [1], tgt: "100% of changes raised as change requests", res: "Change request form" },
    { n: "Assess impact & risk", nexts: [2], resp: "Bobbi Morse", tgt: "100% of changes risk-assessed before approval; assessment completed ≤ 2 business days.", res: "Change assessment template; security & impact checklist; ~0.5 day analyst time." },
    { n: "Approve change?", t: "decision", nexts: [3, 5], resp: "Scott Edward Harris Lang", tgt: "0 unassessed changes approved; approval decision ≤ 1 business day.", res: "CAB approval record; change calendar." },
    { n: "Implement change", nexts: [4], resp: "Luke Cage", tgt: "≥ 98% of changes implemented without rollback; 0 change-related incidents.", res: "Deployment runbook; rollback plan; maintenance window." },
    { n: "Verify & close", nexts: [], tgt: "Post-implementation review on all changes", res: "Verification checklist" },
    { n: "Reject & document", nexts: [], tgt: "Rejected changes documented with rationale", res: "Change record" },
  ]);
  bpBuild("Incident Response", "IT Infrastructure", [
    { n: "Detect / report incident", tgt: "100% of incidents logged on detection", res: "Incident register; monitoring" },
    { n: "Triage & classify", tgt: "Incidents triaged & classified ≤ 30 min", res: "Triage playbook" },
    { n: "Contain", tgt: "Containment of confirmed incidents ≤ 1 h", res: "Containment runbook" },
    { n: "Investigate root cause", tgt: "Root cause identified for 100% of major incidents", res: "RCA method" },
    { n: "Eradicate & recover", tgt: "Recovery verified before closure", res: "Recovery checklist" },
    { n: "Post-incident review", tgt: "Post-incident review within 5 business days", res: "Lessons-learned template" },
  ]);
  for (const [name, steps] of Object.entries(bpStepFlows)) {
    const rec = await ImplementationRecord.findOne({ where: { orgId: tenant.id, module: "processes", title: name } });
    if (!rec) continue;
    const data = (rec.data ?? {}) as Record<string, unknown>;
    if (!Array.isArray(data.steps) || data.steps.length === 0) {
      await rec.update({ data: { ...data, steps } });
    }
  }

  // 14b2. Controlled documents (OD `cdocSeedIfNeeded`, core.js:19538–19563) and
  //       external-document folders + documents (OD `edSeedIfNeeded`,
  //       core.js:19982–20021), 1:1 with the OD baseline: same codes, titles,
  //       types, versions, statuses, view scoping, approvers, and relative day
  //       offsets. Seeded after the Work Units above so `workUnit`/`viewUnits`
  //       can hold real work-unit ids, the way OD's `wu()` lookup does.
  //       OD's seed removes its own earlier seed ids before reseeding (SIDS
  //       filter); the pre-parity PROC-ISMS-0001 row is removed the same way.
  await ImplementationRecord.destroy({ where: { orgId: tenant.id, module: "documents", code: "PROC-ISMS-0001" } });
  const cdAgo = (n: number): string => new Date(Date.now() - n * 86400000).toISOString();
  const cdFut = (n: number): string => new Date(Date.now() + n * 86400000).toISOString();
  const cdTm = "Jennifer Susan Walters", cdMst = "Monica Rambeau", cdMgr = "Scott Edward Harris Lang", cdMgr2 = "Gwendolyne Maxine Stacy";
  const wuRows = await WorkUnit.findAll({ where: { orgId: tenant.id } });
  const wuIdOf = (name: string): string => wuRows.find((w) => w.name === name)?.id ?? "";
  const cdSeed: { code: string; title: string; status: string; frameworks: string[]; created: number; updated: number; data: Record<string, unknown> }[] = [
    { code: "POL-QMS-0001", title: "Quality Policy", status: "Published", frameworks: ["ISO 9001:2015"], created: 140, updated: 5, data: { type: "Policy", version: "1.0", workUnit: wuIdOf("Quality Assurance"), finalReviewerMode: "tm", reviewFreq: "Annually", viewScope: "Everyone", publicLink: true, ackRequired: true, ackAudience: ["All Users"], effectiveDate: cdAgo(120), nextReview: cdFut(240), approvedBy: cdTm, approvedDate: cdAgo(122), publishedBy: cdTm, publishedDate: cdAgo(120), createdBy: cdMst, content: "PT Hammer Industries is committed to delivering products and services that consistently meet customer, statutory, and regulatory requirements.\n\nWe maintain a quality management system built on risk-based thinking, process ownership, and continual improvement. Top management demonstrates leadership by setting quality objectives, providing resources, and reviewing performance at planned intervals.\n\nEvery employee is responsible for the quality of their work and for raising opportunities for improvement." } },
    { code: "POL-ISMS-0001", title: "Information Security Policy", status: "Published", frameworks: ["ISO/IEC 27001:2022"], created: 110, updated: 5, data: { type: "Policy", version: "1.0", workUnit: wuIdOf("Information Security"), finalReviewerMode: "tm", reviewFreq: "Annually", viewScope: "Everyone", ackRequired: true, ackAudience: ["All Users"], effectiveDate: cdAgo(90), nextReview: cdFut(275), approvedBy: cdTm, approvedDate: cdAgo(92), publishedBy: cdTm, publishedDate: cdAgo(90), createdBy: cdMst, content: "PT Hammer Industries protects the confidentiality, integrity, and availability of information assets across its business operations, products, and supporting systems.\n\nInformation security risks are identified, assessed, and treated in line with the approved risk methodology. Access to information is granted on a least-privilege, need-to-know basis.\n\nAll personnel and relevant external parties must comply with this policy and its supporting procedures." } },
    { code: "MAN-QMS-0002", title: "Quality Manual", status: "Published", frameworks: ["ISO 9001:2015"], created: 75, updated: 5, data: { type: "Manual", version: "2.0", workUnit: wuIdOf("Quality Assurance"), lineageId: "MAN-QMS", prevVersionId: "MAN-QMS-0001", finalReviewerMode: "tm", reviewFreq: "Annually", viewScope: "Everyone", publicLink: true, ackRequired: true, ackAudience: ["All Users"], effectiveDate: cdAgo(60), nextReview: cdFut(300), changeSummary: "Updated scope to include the manufacturing sites and revised the process interaction map.", reasonForChange: "Annual review and organizational expansion.", approvedBy: cdTm, approvedDate: cdAgo(62), publishedBy: cdTm, publishedDate: cdAgo(60), createdBy: cdMst, content: "The Quality Manual defines the scope of the PT Hammer Industries quality management system, the sequence and interaction of its processes, and the responsibilities of process owners.\n\nThis version extends the scope to the Cikarang manufacturing and warehouse sites and aligns the process map with the current organizational structure." } },
    { code: "MAN-QMS-0001", title: "Quality Manual", status: "Superseded", frameworks: ["ISO 9001:2015"], created: 420, updated: 60, data: { type: "Manual", version: "1.0", workUnit: wuIdOf("Quality Assurance"), lineageId: "MAN-QMS", supersededBy: "MAN-QMS-0002", finalReviewerMode: "tm", reviewFreq: "Annually", viewScope: "Everyone", effectiveDate: cdAgo(400), nextReview: cdAgo(35), approvedBy: cdTm, approvedDate: cdAgo(402), publishedBy: cdTm, publishedDate: cdAgo(400), createdBy: cdMst, content: "Version 1.0 of the Quality Manual describing the scope of the management system, process interactions, and governance. Superseded by version 2.0." } },
    { code: "PROC-DOC-0001", title: "Documented Information Control Procedure", status: "Under Review", frameworks: ["ISO 9001:2015", "ISO/IEC 27001:2022"], created: 8, updated: 2, data: { type: "Procedure", version: "0.2", workUnit: wuIdOf("Quality Assurance"), finalReviewerMode: "tm", reviewFreq: "Annually", viewScope: "Everyone", submittedBy: cdMst, submittedDate: cdAgo(5), createdBy: cdMst, content: "This procedure defines how documented information is created, reviewed, approved, published, revised, distributed, retained, and archived within PT Hammer Industries.\n\nInitial review is performed by the assigned reviewers (PICs). Once all reviewers sign off, the document is escalated to Final Review by Top Management or an authorized user." } },
    { code: "PROC-CHG-0001", title: "Change Management Procedure", status: "Under Review", frameworks: ["ISO 9001:2015", "ISO/IEC 27001:2022"], created: 4, updated: 1, data: { type: "Procedure", version: "0.1", workUnit: wuIdOf("Software Development"), finalReviewerMode: "user", approver: cdTm, reviewFreq: "Annually", viewScope: "Work Units", viewUnits: [wuIdOf("Software Development"), wuIdOf("IT Infrastructure")].filter(Boolean), submittedBy: cdMgr, submittedDate: cdAgo(2), createdBy: cdMgr, content: "This procedure governs how changes to systems, infrastructure, and documented information are requested, assessed, approved, implemented, and reviewed.\n\nChanges are classified by risk and routed for the appropriate level of approval before deployment." } },
    { code: "PROC-AC-0001", title: "Access Control Procedure", status: "Approved", frameworks: ["ISO/IEC 27001:2022"], created: 14, updated: 4, data: { type: "Procedure", version: "1.0", workUnit: wuIdOf("Information Security"), finalReviewerMode: "tm", reviewFreq: "Annually", viewScope: "Work Units", viewUnits: [wuIdOf("Information Security"), wuIdOf("IT Infrastructure")].filter(Boolean), reviewDecision: "Approve", reviewComments: "Approved for publication.", submittedBy: cdMst, submittedDate: cdAgo(9), approvedBy: cdTm, approvedDate: cdAgo(4), createdBy: cdMst, content: "This procedure defines how logical access to information systems is requested, approved, provisioned, reviewed, and revoked following the least-privilege principle.\n\nAccess rights are reviewed at planned intervals and upon any change of role or employment status." } },
    { code: "PROC-SUP-0001", title: "Supplier Management Procedure", status: "Published", frameworks: ["ISO 9001:2015"], created: 420, updated: 390, data: { type: "Procedure", version: "1.0", workUnit: wuIdOf("Procurement"), finalReviewerMode: "user", approver: cdTm, reviewFreq: "Annually", viewScope: "Work Units", viewUnits: [wuIdOf("Procurement")].filter(Boolean), effectiveDate: cdAgo(400), nextReview: cdAgo(12), approvedBy: cdTm, approvedDate: cdAgo(402), publishedBy: cdTm, publishedDate: cdAgo(400), createdBy: cdMst, content: "This procedure defines how external providers are selected, evaluated, approved, and monitored to ensure purchased products and services meet requirements.\n\nSuppliers are re-evaluated periodically based on performance scorecards and nonconformity history." } },
    { code: "WI-HR-0001", title: "Employee Onboarding Work Instruction", status: "Draft", frameworks: ["ISO 9001:2015"], created: 3, updated: 1, data: { type: "Work Instruction", version: "0.1", workUnit: wuIdOf("Human Resources"), finalReviewerMode: "user", approver: cdMst, reviewFreq: "Annually", viewScope: "Specific Users", viewUsers: [cdMst, cdMgr], createdBy: cdMgr2, content: "Step-by-step instructions for onboarding a new employee: account creation, asset issuance, orientation, and competence baseline.\n\nThis draft is being prepared for review." } },
    { code: "GDL-IR-0001", title: "Incident Response Guideline", status: "Revision Requested", frameworks: ["ISO/IEC 27001:2022"], created: 16, updated: 6, data: { type: "Guideline", version: "0.2", workUnit: wuIdOf("Information Security"), finalReviewerMode: "tm", reviewFreq: "Annually", viewScope: "Work Units", viewUnits: [wuIdOf("Information Security")].filter(Boolean), reviewDecision: "Request Revision", reviewComments: "Add escalation timelines and align severity levels with the risk matrix.", submittedBy: cdMgr, submittedDate: cdAgo(10), createdBy: cdMgr, content: "Guidance for detecting, reporting, containing, and recovering from information security incidents.\n\nReturned for revision to add escalation timelines and severity alignment." } },
  ];
  for (const c of cdSeed) {
    await ImplementationRecord.findOrCreate({
      where: { orgId: tenant.id, module: "documents", code: c.code },
      defaults: { orgId: tenant.id, module: "documents", code: c.code, title: c.title, status: c.status, owner: null, data: c.data, elementId: null, frameworks: c.frameworks, createdAt: new Date(cdAgo(c.created)), updatedAt: new Date(cdAgo(c.updated)) },
    });
  }

  // External-document folders (OD `edSeedIfNeeded` folder list, core.js:19988–20001).
  const edAdm = "Tenant Administrator";
  const edFolderSeed: [string, string][] = [
    ["Standards", "International, national, or industry standards used as management system criteria or reference documents."],
    ["Regulations", "Regulatory documents issued by authorities that may apply to the organization."],
    ["Laws", "Legal instruments, acts, and statutory documents applicable to the organization."],
    ["Government Guidelines", "Guidelines, circulars, and official guidance issued by government bodies."],
    ["Official Letters", "Formal external correspondence, letters, notices, or decisions received from customers, regulators, authorities, or other external parties."],
    ["Customer Requirements", "Customer-issued requirements, specifications, manuals, or contractual expectations."],
    ["Supplier Documents", "Supplier-issued manuals, specifications, certifications, notices, or service documents."],
    ["Accreditation Rules", "Accreditation body requirements, regulations, rules, or guidance documents."],
    ["Certification Scheme Documents", "Certification scheme rules, scheme owner documents, certification requirements, and related guidance."],
    ["Technical Manuals", "Externally issued manuals, equipment manuals, technical references, or operating instructions."],
    ["Contracts", "External agreements, contracts, memoranda, or formal commitments relevant to the management system."],
    ["Other References", "Other externally issued reference documents used by the organization."],
  ];
  const edFolderIds: Record<string, string> = {};
  for (let i = 0; i < edFolderSeed.length; i++) {
    const [name, description] = edFolderSeed[i];
    const [folderRow] = await ImplementationRecord.findOrCreate({
      where: { orgId: tenant.id, module: "record-folders", code: `EDF-${String(i + 1).padStart(4, "0")}` },
      defaults: { orgId: tenant.id, module: "record-folders", code: `EDF-${String(i + 1).padStart(4, "0")}`, title: name, status: "Active", owner: null, data: { description, createdBy: edAdm }, elementId: null, frameworks: [], createdAt: new Date(cdAgo(30)), updatedAt: new Date(cdAgo(30)) },
    });
    edFolderIds[name] = folderRow.id;
  }

  // The 6 seeded external documents (OD `edSeedIfNeeded` mk() rows, core.js:20006–20015).
  const edEff = "2026-06-17T00:00:00.000Z";
  const edNext = "2027-06-17T00:00:00.000Z";
  const edSeed: { code: string; folder: string; category: string; title: string; owner?: string; frameworks?: string[]; over?: Record<string, unknown> }[] = [
    { code: "EXT-STD-0001", folder: "Standards", category: "Standard", title: "ISO 9001:2015 Quality Management Systems — Requirements", frameworks: ["ISO 9001:2015"], over: { issuer: "ISO", publisher: "International Organization for Standardization", number: "ISO 9001:2015", version: "2015", file: { name: "ISO-9001-2015.pdf", size: 1180000 } } },
    { code: "EXT-STD-0002", folder: "Standards", category: "Standard", title: "ISO/IEC 27001:2022 Information Security Management Systems — Requirements", frameworks: ["ISO/IEC 27001:2022"], over: { issuer: "ISO / IEC", publisher: "International Organization for Standardization / International Electrotechnical Commission", number: "ISO/IEC 27001:2022", version: "2022", file: { name: "ISO-IEC-27001-2022.pdf", size: 1420000 } } },
    { code: "EXT-LAW-0001", folder: "Laws", category: "Law", title: "Law No. 27 of 2022 on Personal Data Protection", frameworks: ["ISO/IEC 27001:2022"], over: { issuer: "Government of Indonesia", publisher: "Government of Indonesia", number: "UU 27/2022", version: "2022", file: { name: "UU-27-2022-PDP.pdf", size: 960000 }, obligations: ["Personal Data Protection Compliance"] } },
    { code: "EXT-REG-0001", folder: "Regulations", category: "Regulation", title: "Government Regulation No. 71 of 2019 on Electronic Systems and Transactions", frameworks: [], over: { issuer: "Government of Indonesia", number: "PP 71/2019", version: "2019", file: { name: "PP-71-2019.pdf", size: 870000 } } },
    { code: "EXT-LET-0001", folder: "Official Letters", category: "Official Letter", title: "Customer Information Security Requirement Letter", owner: cdTm, frameworks: ["ISO/IEC 27001:2022"], over: { issuer: "Key Customer", number: "CUS-SEC-REQ-2026-001", receivedDate: "2026-06-10T00:00:00.000Z", workUnits: ["Software Development"], file: { name: "customer-infosec-requirement.pdf", size: 240000 } } },
    { code: "EXT-SUP-0001", folder: "Supplier Documents", category: "Supplier Document", title: "Cloud Hosting Service Security Whitepaper", frameworks: ["ISO/IEC 27001:2022"], over: { issuer: "Cloud Hosting Provider", version: "2026", workUnits: ["IT Infrastructure"], link: "https://cloud.example.com/security-whitepaper" } },
  ];
  for (const e of edSeed) {
    await ImplementationRecord.findOrCreate({
      where: { orgId: tenant.id, module: "records", code: e.code },
      defaults: {
        orgId: tenant.id, module: "records", code: e.code, title: e.title, status: "Active", owner: e.owner ?? edAdm, elementId: null, frameworks: e.frameworks ?? [],
        data: {
          folderId: edFolderIds[e.folder] ?? "", folder: e.folder, category: e.category,
          issuer: "", publisher: "", number: "", version: "", effectiveDate: "", publishedDate: "", receivedDate: "", link: "", file: null,
          reviewFreq: "Annually", lastChecked: edEff, nextReview: edNext, reviewStatus: "Current", monitorNotes: "",
          clauses: [], obligations: [], processes: [], workUnits: [], notes: "", versionHistory: [], createdBy: edAdm,
          ...(e.over ?? {}),
        },
        createdAt: new Date(cdAgo(20)), updatedAt: new Date(cdAgo(10)),
      },
    });
  }

  // Performance Evaluation baseline snapshot — OD `perfSeedBaseline`
  // (core.js:7942): one PEV-0001 record ~a quarter old, owner Jennifer Susan
  // Walters, indicators frozen slightly below current values so the dashboard
  // shows improvement trends. Mirrored in the FE mockClient's PERF_EVALS seed.
  const pevSeeded = await PerfEval.findOne({ where: { orgId: tenant.id, code: "PEV-0001" } });
  if (!pevSeeded) {
    const pevDate = new Date(Date.now() - 92 * 86400000);
    await PerfEval.create({
      orgId: tenant.id, code: "PEV-0001", period: "Q1 2026",
      date: pevDate.toISOString().slice(0, 10), owner: "Jennifer Susan Walters",
      summary: "Baseline performance evaluation for Q1 2026. Several process KPIs and awareness metrics below target — improvement actions raised and tracked.",
      indicators: [
        { name: "Process steps with defined KPIs / targets", cat: "Process control (§4.4)", src: "Business Processes", unit: "%", dir: "up", target: "80", val: "72", status: "amber" },
        { name: "Risks under active control", cat: "Risk management (§6.1)", src: "Risk Register", unit: "%", dir: "up", target: "75", val: "67", status: "amber" },
        { name: "Open High / Critical risks", cat: "Risk management (§6.1)", src: "Risk Register", unit: "#", dir: "down", target: "0", val: "1", status: "amber" },
        { name: "Audit finding closure rate", cat: "Internal audit (§9.2)", src: "Internal Audit", unit: "%", dir: "up", target: "85", val: "70", status: "red" },
        { name: "Open audit findings", cat: "Internal audit (§9.2)", src: "Internal Audit", unit: "#", dir: "down", target: "3", val: "5", status: "red" },
        { name: "Nonconformity closure rate", cat: "Improvement (§10)", src: "Nonconformities", unit: "%", dir: "up", target: "90", val: "80", status: "amber" },
        { name: "Concerns pending review", cat: "Improvement (§10)", src: "Concerns", unit: "#", dir: "down", target: "0", val: "2", status: "red" },
        { name: "Training completion rate", cat: "Competence & awareness (§7.2 / 7.3)", src: "Training Plan", unit: "%", dir: "up", target: "90", val: "82", status: "amber" },
        { name: "Overdue training actions", cat: "Competence & awareness (§7.2 / 7.3)", src: "Training Plan", unit: "#", dir: "down", target: "0", val: "1", status: "amber" },
        { name: "Awareness acknowledgment rate", cat: "Competence & awareness (§7.2 / 7.3)", src: "Awareness", unit: "%", dir: "up", target: "95", val: "78", status: "red" },
        { name: "Awareness evaluation pass rate", cat: "Competence & awareness (§7.2 / 7.3)", src: "Awareness", unit: "%", dir: "up", target: "80", val: "75", status: "amber" },
        { name: "Internal documents within review date", cat: "Documented information (§7.5)", src: "Internal Documents", unit: "%", dir: "up", target: "95", val: "88", status: "amber" },
        { name: "External documents current", cat: "Documented information (§7.5)", src: "External Documents", unit: "%", dir: "up", target: "90", val: "84", status: "amber" },
        { name: "Approved suppliers", cat: "External providers (§8.4)", src: "Suppliers", unit: "%", dir: "up", target: "80", val: "75", status: "amber" },
      ],
      createdBy: "Jennifer Susan Walters", lastUpdatedBy: "Jennifer Susan Walters",
    });
  }

  // 14c. Phase 9c — Approval pools (OD's team-seed + `apMigrateFlags`
  //      invariant, app.html:5739, 7207-7210, 10144-10160): guarantee
  //      the demo tenant ships with a non-empty approval pool instead of
  //      relying solely on the runtime auto-derive fallback in
  //      approval.service.ts. Two more tenant users (mirroring OD's Monica
  //      Rambeau / Maria Rambeau) plus the existing Tenant Admin (mirroring
  //      Jennifer Susan Walters) give ≥1 MS Team member and exactly one
  //      final-say Top Management member.
  await ensureUser("siti.rahayu", "Siti Rahayu", "siti@garuda.id", tenant.id, tenantAdminRole, tenant.id);
  await ensureUser("dewi.anggraini", "Dewi Anggraini", "dewi@garuda.id", tenant.id, tenantAdminRole, tenant.id);
  const tenantAdminUser = await User.findOne({ where: { username: "tenant" } });
  const sitiUser = await User.findOne({ where: { username: "siti.rahayu" } });
  const dewiUser = await User.findOne({ where: { username: "dewi.anggraini" } });
  const poolSeed: { user: typeof tenantAdminUser; isTM: boolean; tmFinal: boolean; isMST: boolean; mstPriority: string }[] = [
    // Tenant Admin — sole final-say Top Management (mirrors Jennifer Susan
    // Walters `isTM:true, tmFinal:true`, index.html:7207).
    { user: tenantAdminUser, isTM: true, tmFinal: true, isMST: false, mstPriority: "required" },
    // Siti Rahayu — required MS Team reviewer (mirrors Monica Rambeau, 7210).
    { user: sitiUser, isTM: false, tmFinal: false, isMST: true, mstPriority: "required" },
    // Dewi Anggraini — optional MS Team reviewer (mirrors Maria Rambeau, 10158).
    { user: dewiUser, isTM: false, tmFinal: false, isMST: true, mstPriority: "optional" },
  ];
  for (const p of poolSeed) {
    if (!p.user) continue;
    await ApprovalPoolMember.findOrCreate({
      where: { orgId: tenant.id, userId: p.user.id },
      defaults: { orgId: tenant.id, userId: p.user.id, isTM: p.isTM, tmFinal: p.tmFinal, isMST: p.isMST, mstPriority: p.mstPriority },
    });
  }

  // 15. Phase 10 — LIMS: the 9 seeded testing services with their exact stage
  //     configs (order: planning, sampling, cert, retention, disposal).
  type Lss = "Mandatory" | "Optional" | "Not Applicable";
  const st = (planning: Lss, sampling: Lss, cert: Lss, retention: Lss, disposal: Lss): Record<string, Lss> => ({ planning, sampling, cert, retention, disposal });
  const M: Lss = "Mandatory", O: Lss = "Optional", N: Lss = "Not Applicable";
  // OD `seedTestingServices` per-service descriptions (app.html:27122)
  // — replaces the generic "<name> service line." placeholder.
  const LIMS_DESC: Record<string, string> = {
    "Environmental Testing": "Air, water, soil and emissions testing for environmental compliance.",
    "Material Testing": "Mechanical and structural testing of materials and components.",
    "Food Testing": "Nutritional, contaminant and quality testing of food products.",
    "Microbiology Testing": "Microbial identification and contamination analysis.",
    "Electronic Product Testing": "Safety, EMC and performance testing of electronic products.",
    "Chemical Testing": "Composition and chemical property analysis.",
    "Water Testing": "Potable, waste and process water quality testing.",
    "Air Testing": "Ambient, indoor and stack air quality testing.",
    "Soil Testing": "Soil composition, contamination and geotechnical testing.",
  };
  const limsServices: { code: string; name: string; stages: Record<string, Lss> }[] = [
    { code: "TS-1001", name: "Environmental Testing", stages: st(M, M, N, M, M) },
    { code: "TS-1002", name: "Material Testing", stages: st(O, O, O, M, M) },
    { code: "TS-1003", name: "Food Testing", stages: st(O, O, N, M, M) },
    { code: "TS-1004", name: "Microbiology Testing", stages: st(O, O, N, M, M) },
    { code: "TS-1005", name: "Electronic Product Testing", stages: st(N, N, O, O, O) },
    { code: "TS-1006", name: "Chemical Testing", stages: st(O, O, N, M, M) },
    { code: "TS-1007", name: "Water Testing", stages: st(M, M, N, M, M) },
    { code: "TS-1008", name: "Air Testing", stages: st(M, M, N, M, M) },
    { code: "TS-1009", name: "Soil Testing", stages: st(M, M, N, M, M) },
  ];
  for (const svc of limsServices) {
    await TestingService.findOrCreate({
      where: { orgId: tenant.id, code: svc.code },
      defaults: { orgId: tenant.id, code: svc.code, name: svc.name, description: LIMS_DESC[svc.name] ?? `${svc.name} service line.`, status: "Active", stages: svc.stages },
    });
  }

  // 16. Phase 11 — knowledge base: OD's 18 seeded articles (`seedKB`,
  //     index.html:15698-15723) verbatim (title/category/summary/keywords/
  //     content/featured/status/views/helpful), plus a couple of demo
  //     notifications for the tenant org bell.
  const kb: {
    code: string; title: string; category: string; status: "Draft" | "Published" | "Archived";
    summary: string; content: string; keywords: string[]; featured: boolean;
    views: number; uniqueViews: number; helpful: number; notHelpful: number; publishedAt: string | null;
  }[] = [
    { code: "KB-2026-0001", title: "How to Create a Tenant", category: "platform", status: "Published", summary: "Provision a new customer organization and its primary site.", content: "# Creating a Tenant\nTenants are created by the Service Provider from **Tenant Management**.\n\n1. Open Tenant Management and click New Tenant.\n2. Choose the Acquisition Source (Direct or Partner).\n3. Enter the organization details and the Primary Site.\n4. Create the initial Tenant Administrator.\n5. Send the activation email.\n\n> Every tenant must have exactly one Primary Site, created during onboarding.", keywords: ["tenant","create tenant","onboarding","provisioning"], featured: true, views: 842, uniqueViews: 606, helpful: 96, notHelpful: 6, publishedAt: "2026-05-12T10:00:00.000Z" },
    { code: "KB-2026-0002", title: "How to Create a Site", category: "platform", status: "Published", summary: "Add implementation scopes (sites) to a tenant.", content: "# Creating a Site\nSites are managed inside a tenant’s **Sites** tab.\n\n1. Open the tenant and go to the Sites tab.\n2. Click Add Site and choose a Site Type.\n3. Set whether it is the Primary Site.\n4. Save.\n\n> Frameworks are assigned to sites, not directly to the tenant.", keywords: ["site","primary site","head office","factory"], featured: false, views: 531, uniqueViews: 382, helpful: 60, notHelpful: 4, publishedAt: "2026-05-13T10:00:00.000Z" },
    { code: "KB-2026-0003", title: "How to Add Team Members", category: "platform", status: "Published", summary: "Invite internal Service Provider users and assign role groups.", content: "# Adding Team Members\nUse **Team Management** to add internal users.\n\n1. Click Add User and choose a Role Group.\n2. For Administrators, set Full or Custom access.\n3. Submit — an activation email is sent automatically.\n\nRole groups: Administrator, Billing Manager, Technical Support.", keywords: ["team","users","roles","invite","activation"], featured: false, views: 418, uniqueViews: 301, helpful: 44, notHelpful: 3, publishedAt: "2026-05-10T10:00:00.000Z" },
    { code: "KB-2026-0004", title: "How to Assign Frameworks", category: "framework", status: "Published", summary: "Understand how frameworks map to sites and requirements.", content: "# Assigning Frameworks\nFrameworks belong to **sites**. A framework contains requirements; framework elements map many-to-many to those requirements.\n\n- Head Office → ISO 9001\n- Factory → ISO 45001\n- Data Center → ISO/IEC 27001\n\n> Framework assignment to sites is rolling out progressively.", keywords: ["framework","assignment","requirements","iso"], featured: true, views: 766, uniqueViews: 552, helpful: 80, notHelpful: 9, publishedAt: "2026-05-14T10:00:00.000Z" },
    { code: "KB-2026-0005", title: "Understanding Framework Elements", category: "framework", status: "Published", summary: "Framework elements are the primary cross-reference object.", content: "# Framework Elements\nA framework element (e.g. Internal Audit) can satisfy requirements across multiple frameworks.\n\n> One element ↔ many requirements, and one requirement ↔ many elements.", keywords: ["framework element","cross-reference","mapping","requirement"], featured: false, views: 389, uniqueViews: 280, helpful: 41, notHelpful: 5, publishedAt: "2026-05-09T10:00:00.000Z" },
    { code: "KB-2026-0006", title: "How Subscription Billing Works", category: "billing", status: "Published", summary: "How AXIA bills tenants and issues invoices.", content: "# Subscription Billing\nAll revenue is collected by **AXIA**. Tenants always pay AXIA directly — partners never invoice tenants.\n\n| Frequency | Notes |\n| --- | --- |\n| Monthly | Billed each period |\n| Annual | May include a discount |\n\n> Receipts are issued only after a payment is verified.", keywords: ["billing","subscription","invoice","currency"], featured: true, views: 611, uniqueViews: 440, helpful: 70, notHelpful: 8, publishedAt: "2026-05-15T10:00:00.000Z" },
    { code: "KB-2026-0007", title: "How to View Invoices", category: "billing", status: "Published", summary: "Find invoices, payments, and receipts for a tenant.", content: "# Viewing Invoices\nOpen a tenant and go to the **Billing** tab to see the subscription, invoices, payments, and receipts. Service Providers can also see all invoices under Billing Management → Invoices.", keywords: ["invoice","payment","receipt","view"], featured: false, views: 298, uniqueViews: 215, helpful: 30, notHelpful: 2, publishedAt: "2026-05-11T10:00:00.000Z" },
    { code: "KB-2026-0008", title: "How Receipts Work", category: "billing", status: "Published", summary: "When and how receipts are generated.", content: "# Receipts\nA receipt is issued automatically once a payment is **verified**. Receipts reference the invoice and payment, and remain available for history.", keywords: ["receipt","payment verification"], featured: false, views: 176, uniqueViews: 127, helpful: 18, notHelpful: 1, publishedAt: "2026-05-08T10:00:00.000Z" },
    { code: "KB-2026-0009", title: "How Partner Revenue Share Works", category: "partner", status: "Published", summary: "How partners earn revenue share on tenant invoices.", content: "# Partner Revenue Share\nOnly **partner-acquired** tenants generate revenue share. AXIA pays the partner a percentage of each tenant invoice based on the Partner Agreement.\n\n> Direct-acquired tenants do not generate partner revenue share.", keywords: ["partner","revenue share","payout","commission"], featured: true, views: 524, uniqueViews: 377, helpful: 58, notHelpful: 7, publishedAt: "2026-05-14T10:00:00.000Z" },
    { code: "KB-2026-0010", title: "How Partner Tiers Work", category: "partner", status: "Published", summary: "Bronze, Silver, and Gold tiers and their share ranges.", content: "# Partner Tiers\n| Tier | Base | Maximum |\n| --- | --- | --- |\n| Bronze | 15% | 20% |\n| Silver | 20% | 30% |\n| Gold | 30% | 35% |\n\nCurrent share may vary within the approved tier range.", keywords: ["partner tier","bronze","silver","gold"], featured: false, views: 347, uniqueViews: 250, helpful: 38, notHelpful: 4, publishedAt: "2026-05-07T10:00:00.000Z" },
    { code: "KB-2026-0011", title: "Cannot Activate Account", category: "troubleshooting", status: "Published", summary: "Steps to resolve activation link issues.", content: "# Cannot Activate Account\nActivation links expire for security.\n\n1. Check the email address the link was sent to.\n2. Use the Resend Activation option.\n3. Open the new link within the validity window.\n\n> If it still fails, create a ticket from Ticket Management.", keywords: ["activation","cannot activate","link expired","password"], featured: false, views: 903, uniqueViews: 650, helpful: 88, notHelpful: 21, publishedAt: "2026-05-16T10:00:00.000Z" },
    { code: "KB-2026-0012", title: "Cannot Upload Files", category: "troubleshooting", status: "Published", summary: "Fixes for failed file uploads.", content: "# Cannot Upload Files\nSupported formats: PDF, DOCX, XLSX, PNG, JPG.\n\n- Confirm the file type is supported.\n- Large files may take longer — wait for the upload to finish.\n- Retry after refreshing if the upload stalls.", keywords: ["upload","file","attachment","error"], featured: false, views: 472, uniqueViews: 340, helpful: 40, notHelpful: 12, publishedAt: "2026-05-06T10:00:00.000Z" },
    { code: "KB-2026-0013", title: "Cannot Access Framework", category: "troubleshooting", status: "Published", summary: "Why a framework may not be visible.", content: "# Cannot Access Framework\nFrameworks are assigned per site. Confirm the framework is assigned to the relevant site and that your account has access to that site.", keywords: ["framework access","permission","visibility"], featured: false, views: 213, uniqueViews: 153, helpful: 19, notHelpful: 6, publishedAt: "2026-05-05T10:00:00.000Z" },
    { code: "KB-2026-0014", title: "Can One Tenant Have Multiple Sites?", category: "faq", status: "Published", summary: "Yes — tenants can have many sites.", content: "# Multiple Sites\nYes. A tenant can have many sites (Head Office, Factory, Warehouse, …) but exactly **one Primary Site**.", keywords: ["tenant","sites","multiple"], featured: false, views: 355, uniqueViews: 256, helpful: 48, notHelpful: 1, publishedAt: "2026-05-04T10:00:00.000Z" },
    { code: "KB-2026-0015", title: "Can One Site Have Multiple Frameworks?", category: "faq", status: "Published", summary: "Yes — sites can carry several frameworks.", content: "# Multiple Frameworks per Site\nYes. A single site can implement several frameworks (e.g. a Factory running ISO 9001 and ISO 45001).", keywords: ["site","frameworks","multiple"], featured: false, views: 281, uniqueViews: 202, helpful: 34, notHelpful: 2, publishedAt: "2026-05-04T10:00:00.000Z" },
    { code: "KB-2026-0016", title: "How Do I Reset My Password?", category: "faq", status: "Published", summary: "Reset your password from the Security tab.", content: "# Resetting Your Password\nOpen the account menu → **Security** → Change Password. New passwords must be at least 8 characters with an uppercase letter, a lowercase letter, and a number.", keywords: ["password","reset","security"], featured: false, views: 688, uniqueViews: 495, helpful: 74, notHelpful: 5, publishedAt: "2026-05-10T10:00:00.000Z" },
    { code: "KB-2026-0017", title: "Version 1.0.0 Release Notes", category: "release", status: "Published", summary: "Initial VIBES platform release.", content: "# Version 1.0.0\nThe first VIBES release.\n\n- Organization, Team, Partner, Tenant, and Framework management\n- Partnership Agreements with a block editor\n- Billing Management with revenue share\n- Ticket Management with SLA tracking\n- Knowledge Base", keywords: ["release","changelog","1.0.0"], featured: false, views: 402, uniqueViews: 289, helpful: 36, notHelpful: 2, publishedAt: "2026-05-02T10:00:00.000Z" },
    { code: "KB-2026-0018", title: "Tenant Onboarding Checklist (Draft)", category: "platform", status: "Draft", summary: "Internal draft checklist for tenant onboarding.", content: "# Onboarding Checklist (Draft)\n- Create tenant\n- Create primary site\n- Create administrator\n- Confirm activation\n\n> Draft — pending review before publishing.", keywords: ["onboarding","checklist","internal"], featured: false, views: 0, uniqueViews: 0, helpful: 0, notHelpful: 0, publishedAt: null },
  ];
  for (const a of kb) {
    await KbArticle.findOrCreate({
      where: { code: a.code },
      defaults: {
        orgId: null, code: a.code, title: a.title, category: a.category, status: a.status, author: "AXIA Support",
        summary: a.summary, content: a.content, keywords: a.keywords, featured: a.featured,
        views: a.views, uniqueViews: a.uniqueViews, helpful: a.helpful, notHelpful: a.notHelpful,
        publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
      },
    });
  }
  // SOF-38 — 39 OD business collections (Enterprise/Datana/Motoran/Exelera business units) into
  // the generic `business_records` register. Runs after the tenant org (`tenant.id`) it seeds
  // into already exists.
  await seedBusinessRecords(tenant.id);

  // SOF-322 audit gap: OD's `db.suppliers` (21 rows) had no home in either seeder — the
  // Tenant Quality register at `/implementation/suppliers` rendered empty in both offline demo
  // mode and against this backend. Reuses the same `data/businessRecords/suppliers.json` dump
  // convention as `seedBusinessRecords` above, but writes `ImplementationRecord` rows (module
  // `suppliers`) since that register isn't a `business_records` module.
  await seedTenantSuppliers(tenant.id);

  // OD's `tnPOs` (ISO §8.4.2/§8.4.3) nest inside a supplier's own `data.pos`
  // (`SupplierWorkspace.tsx`), not a separate module — must run after
  // `seedTenantSuppliers` so the supplier rows it matches against already
  // exist. See `seedTenantSupplierPOs`'s header note in `businessRecordsSeed.ts`.
  await seedTenantSupplierPOs(tenant.id);

  // Same SOF-322 gap, Enterprise side: `EnterpriseSuppliersPage.tsx` (`ent-suppliers` business
  // records) had a single non-OD stub row, not OD's 21. `SupplierData` (`lib/procurement/
  // suppliers.ts`) is the closer match to OD's row shape than the Tenant `ImplementationRecord`
  // payload above — see `seedEnterpriseSuppliers`'s header note for the field-by-field case.
  await seedEnterpriseSuppliers(tenant.id);

  // Same SOF-322 gap, the four Tenant Quality-extension (ISO 9001) registers: OD's
  // `db.custSat`/`db.designItems`/`db.psrCatalog`+`db.psrRecords`+`db.psrSpecTemplates`/
  // `db.controlPlans` had no seed at all, so `/implementation/customer-satisfaction`,
  // `/implementation/design`, `/implementation/psr`, and `/implementation/provision`
  // rendered empty in every mode. See each seeder's own header note in
  // `businessRecordsSeed.ts` for the field-by-field mapping against that register's
  // bespoke workspace component.
  await seedCustomerSatisfaction(tenant.id);
  await seedDesignItems(tenant.id);
  await seedPsr(tenant.id);
  await seedControlPlans(tenant.id);

  // Organization/edition-specific registers with no seed at all: Interested
  // Parties (`IpParty`/`IpRequirement`, ISO 4.2), Management Review
  // (`MReview`, ISO 9.3), Management System Scope (`MsScope`, the dedicated
  // `/scope` document), and the three edition-specific `cab-clients`/
  // `pcb-persons`/`lab-scope` registers. See each seeder's header note in
  // `businessRecordsSeed.ts` for the field-by-field mapping.
  await seedInterestedParties(tenant.id);
  await seedManagementReviews(tenant.id);
  await seedMsScope(tenant.id);
  await seedCabClients(tenant.id);
  await seedPcbPersons(tenant.id);
  await seedLabScope(tenant.id);

  const notifCount = await Notification.count({ where: { orgId: tenant.id } });
  if (notifCount === 0) {
    await Notification.bulkCreate([
      { orgId: tenant.id, userId: null, type: "ticket", text: "Ticket TKT-2026-0001 needs attention", link: "/tickets", read: false },
      { orgId: tenant.id, userId: null, type: "assessment", text: "Assessment ASM-1001 finalized with 1 gap", link: "/gap-assessment", read: false },
      { orgId: tenant.id, userId: null, type: "info", text: "Framework ISO/IEC 27001 assigned to Garuda HQ", link: "/my-frameworks", read: true },
    ]);
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      "Seed complete.",
      "  Org: AXIA (ServiceOwner)",
      "  Orgs: AXIA (ServiceOwner) → Nusantara Partners (Distributor) → Garuda Manufacturing (Tenant)",
      "  Orgs: AXIA (ServiceOwner) → PT Stark Industries (Distributor) → PT Damage Control (Tenant) [ticket cross-partner isolation pair]",
      "  Roles: Super Admin (bypass), Administrator (full CRUD grants), User (read-only), Billing Manager, Technical Support",
      `  Logins (password ${DEFAULT_PASSWORD}): soadmin / admin / user / partner / tenant`,
      "  AXIA staff roster: 14 (OD seedUsers) — 6 with access, 8 no-access; no passwords",
      "  Partners: PRT-1001..1005 (Active / Pending Approval / Draft / Suspended)",
    ].join("\n"),
  );
}

if (require.main === module) {
  seed()
    .then(() => sequelize.close())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
