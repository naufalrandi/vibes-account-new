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
  ImplementationRecord,
  TestingService,
  KbArticle,
  Notification,
  WorkUnit,
  ApprovalPoolMember,
  ScopeDataset,
} from "../models";
import { ACTIONS, MENU_SEED, type SeedMenu } from "../../modules/iam/actions.catalog";
import { grantEverythingExceptSpOnly } from "../../modules/iam/tenantGrants";
import { seedComplianceEngine } from "./complianceEngine";
import type { AgreementBlock, AgreementTemplateStatus } from "../models/agreementTemplate.model";
import { generateStatementForPartner } from "../../modules/billing/billing.service";
import { hashPassword } from "../../lib/password";
import { ensureGlobalSeed as ensureScopeDatasetSeed } from "../../modules/scope/scopeDataset.service";

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

  // 4. Grants. Super Admin bypasses checks (and also gets explicit grants so the
  //    grant matrix UI shows it fully enabled). Administrator = full CRUD.
  await grantEverything(superAdminRole.id);
  await grantEverything(adminRole.id);
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
      ACTIONS.LIMS_READ,
      ACTIONS.KB_READ,
    ],
  );

  // 5. One demo user per role (all under the SO org → Service-Owner scope).
  await ensureUser("soadmin", "Super Admin", "soadmin@axia.io", so.id, superAdminRole);
  await ensureUser("admin", "Administrator", "admin@axia.io", so.id, adminRole);
  await ensureUser("user", "Standard User", "user@axia.io", so.id, userRole);

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
  // index.html:7201-7204) so the Work Units seed below (`wuSeedIfNeeded`,
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
    { code: "PLN-0001", name: "Starter", description: "Entry plan for small organizations and single-site tenants.", billingFrequency: "Monthly" as const, status: "Active" as const },
    { code: "PLN-0002", name: "Professional", description: "Multi-site implementation with standard framework support.", billingFrequency: "Monthly" as const, status: "Active" as const },
    { code: "PLN-0003", name: "Enterprise", description: "Unlimited sites, priority support, and advanced frameworks.", billingFrequency: "Annual" as const, status: "Active" as const },
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

  // 11. Phase 6 — OD's 8 seeded support tickets (`seedTickets`, index.html:15477-
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
  const msSeed: { module: string; code: string; title: string; status: string; owner: string | null; data: Record<string, unknown>; elementId?: string | null }[] = [
    { module: "context", code: "OCX-0001", title: "New data-protection regulation in target market", status: "Monitored", owner: "MS Team", data: { domain: "Regulatory", type: "External", impact: "May require additional privacy controls." } },
    { module: "risks", code: "RSK-0001", title: "Phishing attack on staff", status: "Under Review", owner: "Security Lead", data: { category: "Operational", likelihood: 4, impact: 4, treatment: "Mitigate", riskScore: 16, riskLevel: "Major" }, elementId: riskEl.id },
    { module: "policies", code: "POL-0001", title: "Information Security Policy", status: "Published", owner: "CISO", data: { category: "High-Level", statement: "Protect the confidentiality, integrity and availability of information.", reviewFreq: "Annually" }, elementId: auditEl?.id ?? null },
    // Controlled document in the OD `cdocs` shape (type/category/access/reviewFreq + derived nextReview).
    { module: "documents", code: "PROC-ISMS-0001", title: "Access Control Procedure", status: "Published", owner: "IT Lead", data: { type: "Procedure", category: "Information Security", version: "1.2", access: "Public within tenant", approver: "Tenant Administrator", reviewFreq: "Annually", effectiveDate: "2026-06-17T00:00:00.000Z", nextReview: "2027-06-17T00:00:00.000Z", changeSummary: "Initial issue", content: "This procedure defines how access to information systems is requested, approved, provisioned, reviewed, and revoked.", publishedBy: "Tenant Administrator", publishedDate: "2026-06-17T00:00:00.000Z", approvedBy: "Tenant Administrator", approvedDate: "2026-06-17T00:00:00.000Z" } },
    // NOTE: no `audits` clause-register seed row — the real Internal Audit
    // module is the dedicated `/internal-audit` surface, not this register
    // (the orphan `audits` register was removed; see registry.ts).
    { module: "nonconformities", code: "NCR-0001", title: "Backup restore test not performed", status: "Corrective Action", owner: "IT Lead", data: { source: "Internal Audit", severity: "Medium", rootCause: "No scheduled restore test.", correctiveAction: "Add quarterly restore test to the calendar." } },
  ];
  for (const m of msSeed) {
    await ImplementationRecord.findOrCreate({
      where: { module: m.module, code: m.code },
      defaults: { orgId: tenant.id, module: m.module, code: m.code, title: m.title, status: m.status, owner: m.owner, data: m.data, elementId: m.elementId ?? null, frameworks: ["ISO/IEC 27001:2022"] },
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

  // 14c. Phase 9c — Approval pools (OD's team-seed + `apMigrateFlags`
  //      invariant, index.html:4530-4536, 7207-7210, 10144-10160): guarantee
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
  // OD `seedTestingServices` per-service descriptions (index.html:16046-16054)
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
      "  Roles: Super Admin (bypass), Administrator (full CRUD grants), User (read-only)",
      `  Users (password ${DEFAULT_PASSWORD}): soadmin / admin / user / partner / tenant`,
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
