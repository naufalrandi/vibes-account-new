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
} from "../models";
import { ACTIONS, MENU_SEED, type SeedMenu } from "../../modules/iam/actions.catalog";
import type { AgreementBlock, AgreementTemplateStatus } from "../models/agreementTemplate.model";
import { generateStatementForPartner } from "../../modules/billing/billing.service";
import { hashPassword } from "../../lib/password";

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

/** Grant a role every menu + every action (full access, explicit grants). */
async function grantEverything(roleId: string): Promise<void> {
  for (const menu of await Menu.findAll()) {
    await RoleMenuGrant.findOrCreate({ where: { roleId, menuId: menu.id }, defaults: { roleId, menuId: menu.id, granted: true } });
  }
  for (const action of await Action.findAll()) {
    await RoleActionGrant.findOrCreate({ where: { roleId, actionId: action.id }, defaults: { roleId, actionId: action.id, granted: true } });
  }
}

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
      "Tenants", "Sites", "Site Requests", "Tickets",
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
  await grantEverything(distAdminRole.id);
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
  await grantEverything(tenantAdminRole.id);
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
  await TenantProfile.findOrCreate({
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
  await Site.findOrCreate({
    where: { code: "STE-1001" },
    defaults: {
      orgId: tenant.id, code: "STE-1001", name: "Garuda HQ", type: "Head Office",
      country: "ID", address: "Jl. Industri Raya No. 1, Bekasi", status: "Active", isPrimary: true,
      description: null, contactPerson: "Tenant Admin", contactEmail: "admin@garuda.id", contactPhone: null,
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

  // 11. Phase 6 — a demo support ticket raised by the tenant and answered by the
  //     SP support desk (so the SLA panel shows a real first-response/Met state).
  const created = "2026-03-01T09:00:00.000Z";
  const answered = "2026-03-01T12:30:00.000Z"; // 3.5h later → within the High 8h SLA → Met
  await Ticket.findOrCreate({
    where: { code: "TKT-2026-0001" },
    defaults: {
      code: "TKT-2026-0001",
      subject: "Cannot activate a new site",
      description: "Our site activation link appears to have expired before we could use it.",
      category: "Technical Support", priority: "High", status: "In Progress",
      scope: "tenant", orgId: tenant.id, managedBy: "Nusantara Partners",
      createdBy: { name: "Tenant Admin", email: "admin@garuda.id" }, assignedTo: "Support Desk",
      messages: [
        { author: { name: "Tenant Admin", kind: "user" }, text: "The activation link says expired.", ts: created },
        { author: { name: "Support Desk", kind: "support" }, text: "We've reissued the activation — please retry.", ts: answered },
      ],
      activity: [
        { event: "Ticket created", ts: created },
        { event: "Assigned to Support Desk", ts: answered },
        { event: "Status changed to In Progress", ts: answered },
      ],
      attachments: [],
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    [
      "Seed complete.",
      "  Org: AXIA (ServiceOwner)",
      "  Orgs: AXIA (ServiceOwner) → Nusantara Partners (Distributor) → Garuda Manufacturing (Tenant)",
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
