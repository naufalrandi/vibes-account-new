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
  OrgSignatory,
  Plan,
  Invoice,
  Site,
  Framework,
  FrameworkAssignment,
  KbArticle,
  Ticket,
  Notification,
  ImplementationRecord,
  BusinessRecord,
} from "../models";
import type { FrameworkAssignmentStatus } from "../models/frameworkAssignment.model";
import { ACTIONS, MENU_SEED, type SeedMenu } from "../../modules/iam/actions.catalog";
import { MODULES } from "../../modules/iam/modules.catalog";
import { ROLES_BY_ORG_TYPE } from "../../modules/iam/role.catalog";
import type { OrgType, OrgStatus } from "../models/organization.model";
import type { SiteType } from "../models/site.model";
import type { PermissionMode } from "../models/user.model";
import { hashPassword } from "../../lib/password";

const DEFAULT_PASSWORD = "ChangeMe123";
const ALL_MODULE_KEYS = MODULES.map((m) => m.key);

/** Extra Team Management metadata applied to a seeded user (idempotently). */
interface UserExtras {
  system?: boolean;
  permissionMode?: PermissionMode | null;
  permissions?: string[];
}

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

/**
 * Create (idempotently) an organization's canonical role set per role.catalog,
 * scoped to that org and tier. Returns the roles keyed by name so callers can
 * grant access and attach demo users.
 */
async function ensureRoleSet(orgId: string, orgType: OrgType): Promise<Map<string, Role>> {
  const byName = new Map<string, Role>();
  for (const name of ROLES_BY_ORG_TYPE[orgType]) {
    const [role] = await Role.findOrCreate({
      where: { name, orgId },
      defaults: { name, tierScope: orgType, orgId, isSuperAdmin: false, status: true },
    });
    byName.set(name, role);
  }
  return byName;
}

/**
 * Apply grants to an org's role set: every Administrator gets full access;
 * specialist roles (Billing Manager / Technical Support / Team Member) get a
 * minimal read grant for now. Finer per-role grants are a follow-up.
 */
async function grantRoleSet(roles: Map<string, Role>): Promise<void> {
  for (const [name, role] of roles) {
    if (name === "Administrator") {
      await grantEverything(role.id);
    } else {
      await grantAccess(role.id, [], [ACTIONS.MENU_READ]);
    }
  }
}

async function ensureUser(
  username: string,
  fullName: string,
  email: string,
  orgId: string,
  role: Role,
  tenantId: string | null = null,
  extras: UserExtras = {},
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
      system: extras.system ?? false,
      permissionMode: extras.permissionMode ?? null,
      permissions: extras.permissions ?? [],
    },
  });
  // Apply Team Management metadata idempotently so re-seeding an existing DB
  // backfills the system flag and permission grid state.
  user.system = extras.system ?? false;
  user.permissionMode = extras.permissionMode ?? null;
  user.permissions = extras.permissions ?? [];
  await user.save();
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
  // AXIA Org Profile defaults (idempotent backfill — applied on every seed run).
  so.legalName = so.legalName ?? "PT AXIA Teknologi Nusantara";
  so.taxId = "01.234.567.8-901.000";
  so.website = so.website ?? "axia.io";
  so.email = so.email ?? "hello@axia.io";
  so.phone = so.phone ?? "+62 21 5000 1000";
  so.country = so.country ?? "ID";
  so.address = so.address ?? "Jl. Jenderal Sudirman Kav. 1, Jakarta 10220";
  so.branding = so.branding ?? { logo: "", favicon: "", primary: "#2f6bff", secondary: "#7c5cff" };
  so.defaults = so.defaults ?? { currency: "IDR", timezone: "Asia/Jakarta", country: "ID", language: "English" };
  await so.save();

  // 3. ServiceOwner roles. The hidden "Super Admin" (bypass) is ServiceOwner-only
  //    and is NOT part of the assignable catalog; the catalog roles are added via
  //    ensureRoleSet (Administrator, Billing Manager, Technical Support).
  const [superAdminRole] = await Role.findOrCreate({
    where: { name: "Super Admin", orgId: so.id },
    defaults: { name: "Super Admin", tierScope: "ServiceOwner", orgId: so.id, isSuperAdmin: true, status: true },
  });
  const soRoles = await ensureRoleSet(so.id, "ServiceOwner");

  // 4. Grants. Super Admin bypasses checks (and also gets explicit grants so the
  //    grant matrix UI shows it fully enabled). Administrator = full CRUD;
  //    specialist roles get minimal read for now.
  await grantEverything(superAdminRole.id);
  await grantRoleSet(soRoles);

  // 5. Demo users for the SO org: super admin, administrator, and one per
  //    specialist role (Technical Support / Billing Manager) so every seeded
  //    user references a role that exists.
  await ensureUser("soadmin", "Super Admin", "soadmin@axia.io", so.id, superAdminRole, null, {
    system: true, permissionMode: "Full Access", permissions: ALL_MODULE_KEYS,
  });
  await ensureUser("admin", "Administrator", "admin@axia.io", so.id, soRoles.get("Administrator")!, null, {
    system: true, permissionMode: "Full Access", permissions: ALL_MODULE_KEYS,
  });
  await ensureUser("support", "Technical Support", "support@axia.io", so.id, soRoles.get("Technical Support")!, null, {
    system: true, permissionMode: null, permissions: ["ticket"],
  });
  await ensureUser("billing", "Billing Manager", "billing@axia.io", so.id, soRoles.get("Billing Manager")!, null, {
    system: true, permissionMode: null, permissions: ["billing"],
  });

  // 5b. Authorized signatories for the SO org (mirrors the AXIA seed sig1/sig2/sig3).
  const SO_SIGNATORIES = [
    { fullName: "AXIA Platform Owner", title: "Chief Executive Officer", email: "ceo@axia.io", status: "Active" as const },
    { fullName: "Sari Wibowo", title: "Head of Legal", email: "legal@axia.io", status: "Active" as const },
    { fullName: "Hendra Gunawan", title: "Finance Director", email: "finance@axia.io", status: "Inactive" as const },
  ];
  for (const s of SO_SIGNATORIES) {
    await OrgSignatory.findOrCreate({
      where: { orgId: so.id, email: s.email },
      defaults: { orgId: so.id, fullName: s.fullName, title: s.title, email: s.email, signatureImage: null, status: s.status },
    });
  }

  // 6. Platform subscription for the SO org.
  await Subscription.findOrCreate({
    where: { orgId: so.id },
    defaults: { orgId: so.id, plan: "platform", entitlements: { all: true }, status: "Active", startDate: new Date(), endDate: null },
  });

  // 7. Demo Distributor org with its canonical role set + one user per role.
  const [dist] = await Organization.findOrCreate({
    where: { code: "NWP" },
    defaults: {
      name: "Northwind Partners", code: "NWP", type: "Distributor", status: "Active",
      parentOrgId: so.id, tenantId: null, email: "ops@northwind.io", phone: null, website: null, country: "SG", address: null,
    },
  });
  // AXIA Commercial (Phase 3): the distributor is a partner — set its lifecycle
  // metadata idempotently so the Partner Management list has real data.
  dist.partnerStatus = dist.partnerStatus ?? "Active";
  dist.partnerTier = dist.partnerTier ?? "Gold";
  dist.partnerCode = dist.partnerCode ?? "PRT-1001";
  dist.partnerAudit = dist.partnerAudit?.length
    ? dist.partnerAudit
    : [{ ts: new Date().toISOString(), msg: "Partner organization created" }];
  await dist.save();
  const distRoles = await ensureRoleSet(dist.id, "Distributor");
  await grantRoleSet(distRoles);
  await ensureUser("distadmin", "Distributor Admin", "admin@northwind.io", dist.id, distRoles.get("Administrator")!);
  await ensureUser("distsupport", "Distributor Support", "support@northwind.io", dist.id, distRoles.get("Technical Support")!);
  await ensureUser("distbilling", "Distributor Billing", "billing@northwind.io", dist.id, distRoles.get("Billing Manager")!);

  // 8. Demo Tenant org with its canonical role set + one user per role.
  const [tenant] = await Organization.findOrCreate({
    where: { code: "ACME" },
    defaults: {
      name: "Acme Corp", code: "ACME", type: "Tenant", status: "Active",
      parentOrgId: dist.id, tenantId: null, email: "it@acme.com", phone: null, website: null, country: "SG", address: null,
    },
  });
  if (!tenant.tenantId) {
    tenant.tenantId = tenant.id;
    await tenant.save();
  }
  const tenantRoles = await ensureRoleSet(tenant.id, "Tenant");
  await grantRoleSet(tenantRoles);
  await ensureUser("tenantadmin", "Tenant Admin", "admin@acme.com", tenant.id, tenantRoles.get("Administrator")!, tenant.id);
  await ensureUser("tenantbilling", "Tenant Billing", "billing@acme.com", tenant.id, tenantRoles.get("Billing Manager")!, tenant.id);
  await ensureUser("tenantmember", "Tenant Member", "member@acme.com", tenant.id, tenantRoles.get("Team Member")!, tenant.id);

  // 9. Billing — subscription plans + monthly invoices for the demo tenant (Jan–Jun 2026).
  const PLANS: { code: string; name: string; description: string; billingFrequency: "Monthly" | "Annual"; status: "Active" }[] = [
    { code: "PLN-0001", name: "Starter", description: "Entry plan for small organizations and single-site tenants.", billingFrequency: "Monthly", status: "Active" },
    { code: "PLN-0002", name: "Professional", description: "Multi-site implementation with standard framework support.", billingFrequency: "Monthly", status: "Active" },
    { code: "PLN-0003", name: "Enterprise", description: "Unlimited sites, priority support, and advanced frameworks.", billingFrequency: "Annual", status: "Active" },
  ];
  for (const p of PLANS) {
    await Plan.findOrCreate({ where: { code: p.code }, defaults: p });
  }

  const MONTHS: [string, string, string][] = [
    ["January", "2026-01-01", "2026-01-31"], ["February", "2026-02-01", "2026-02-28"], ["March", "2026-03-01", "2026-03-31"],
    ["April", "2026-04-01", "2026-04-30"], ["May", "2026-05-01", "2026-05-31"], ["June", "2026-06-01", "2026-06-30"],
  ];
  const INV_STATUS: ("Paid" | "Unpaid" | "Draft")[] = ["Paid", "Paid", "Paid", "Paid", "Unpaid", "Draft"];
  for (let m = 0; m < MONTHS.length; m++) {
    const [period, start, end] = MONTHS[m];
    const number = `INV-2026-${String(m + 1).padStart(4, "0")}`;
    const status = INV_STATUS[m];
    const mm = String(m + 1).padStart(2, "0");
    await Invoice.findOrCreate({
      where: { number },
      defaults: {
        number, orgId: tenant.id, period: `${period} 2026`, start, end, amount: 12000000, currency: "IDR", status,
        paidDate: status === "Paid" ? `2026-${mm}-05` : null,
        dueDate: status === "Unpaid" ? `2026-${mm}-14` : null,
      },
    });
  }

  // 10. AXIA demo tenants (TEN-1001…) for the Tenant Operations views. Each gets
  // a canonical role set, a Tenant Administrator, a primary site, a subscription,
  // and (where applicable) framework assignments. Idempotent via findOrCreate.
  const someFrameworks = await Framework.findAll({ order: [["name", "ASC"]], limit: 3 });
  interface TenantSpec {
    code: string;
    name: string;
    status: OrgStatus;
    industry: string;
    country: string;
    source: "Direct" | "Partner";
    adminUser: string;
    adminName: string;
    adminEmail: string;
    siteName: string;
    siteType: SiteType;
    frameworks: FrameworkAssignmentStatus[];
  }
  const TENANT_SPECS: TenantSpec[] = [
    { code: "TEN-1001", name: "PT Maju Bersama", status: "Active", industry: "Technology", country: "ID", source: "Partner", adminUser: "majuadmin", adminName: "Budi Santoso", adminEmail: "admin@majubersama.id", siteName: "Jakarta HQ", siteType: "Head Office", frameworks: ["Active", "Planned"] },
    { code: "TEN-1002", name: "Sentosa Logistics", status: "Active", industry: "Logistics", country: "ID", source: "Direct", adminUser: "sentosaadmin", adminName: "Dewi Lestari", adminEmail: "admin@sentosa.id", siteName: "Surabaya Hub", siteType: "Head Office", frameworks: ["Active"] },
    { code: "TEN-1003", name: "Andalan Pharma", status: "Suspended", industry: "Pharmaceutical", country: "ID", source: "Direct", adminUser: "andalanadmin", adminName: "Rizki Pratama", adminEmail: "admin@andalan.id", siteName: "Bandung Plant", siteType: "Factory", frameworks: ["Suspended"] },
    { code: "TEN-1004", name: "Global Tekstil", status: "PendingApproval", industry: "Manufacturing", country: "ID", source: "Partner", adminUser: "tekstiladmin", adminName: "Sri Wahyuni", adminEmail: "admin@globaltekstil.id", siteName: "Semarang Mill", siteType: "Factory", frameworks: [] },
    { code: "TEN-1005", name: "ABC Manufacturing", status: "Draft", industry: "Manufacturing", country: "ID", source: "Direct", adminUser: "abcadmin", adminName: "Agus Wibowo", adminEmail: "admin@abcmfg.id", siteName: "Bekasi Factory", siteType: "Factory", frameworks: [] },
  ];
  let siteSeq = 2000;
  let faSeq = 1000;
  for (const spec of TENANT_SPECS) {
    siteSeq += 1;
    const [t] = await Organization.findOrCreate({
      where: { code: spec.code },
      defaults: {
        name: spec.name, code: spec.code, type: "Tenant", status: spec.status,
        parentOrgId: spec.source === "Partner" ? dist.id : so.id, tenantId: null,
        email: spec.adminEmail, phone: null, website: null, country: spec.country, address: null,
        legalName: `${spec.name} Pte Ltd`, industry: spec.industry,
      },
    });
    if (!t.tenantId) {
      t.tenantId = t.id;
      await t.save();
    }
    const tRoles = await ensureRoleSet(t.id, "Tenant");
    await grantRoleSet(tRoles);
    await ensureUser(spec.adminUser, spec.adminName, spec.adminEmail, t.id, tRoles.get("Administrator")!, t.id);
    const [site] = await Site.findOrCreate({
      where: { orgId: t.id, isPrimary: true },
      defaults: {
        orgId: t.id, code: `STE-${siteSeq}`, name: spec.siteName, type: spec.siteType,
        country: spec.country, address: null, status: "Active", isPrimary: true,
        description: null, contactPerson: null, contactEmail: null, contactPhone: null,
      },
    });
    await Subscription.findOrCreate({
      where: { orgId: t.id },
      defaults: { orgId: t.id, plan: "standard", entitlements: { userManagement: true }, status: "Active", startDate: new Date(), endDate: null },
    });
    for (let i = 0; i < spec.frameworks.length && i < someFrameworks.length; i++) {
      faSeq += 1;
      await FrameworkAssignment.findOrCreate({
        where: { siteId: site.id, frameworkId: someFrameworks[i].id },
        defaults: {
          code: `FA-${faSeq}`, orgId: t.id, siteId: site.id, frameworkId: someFrameworks[i].id,
          status: spec.frameworks[i], assignedDate: "2026-01-15", notes: null,
        },
      });
    }
  }

  // 11. Knowledge Base — platform-global help articles (idempotent via code).
  interface KbSpec {
    title: string; category: string; status: "Draft" | "Published"; featured?: boolean;
    summary: string; keywords: string[]; views: number; helpful: number; notHelpful: number; content: string;
  }
  const KB_SPECS: KbSpec[] = [
    { title: "How to Create a Tenant", category: "platform", status: "Published", featured: true, summary: "Provision a new customer organization and its primary site.", keywords: ["tenant", "onboarding", "provisioning"], views: 842, helpful: 96, notHelpful: 6, content: "# Creating a Tenant\nTenants are created by the Service Provider from **Tenant Management**.\n\n1. Open Tenant Management and click New Tenant.\n2. Choose the Acquisition Source (Direct or Partner).\n3. Enter the organization details and the Primary Site.\n4. Create the initial Tenant Administrator.\n5. Send the activation email.\n\n> Every tenant must have exactly one Primary Site." },
    { title: "How to Create a Site", category: "platform", status: "Published", summary: "Add implementation scopes (sites) to a tenant.", keywords: ["site", "primary site", "factory"], views: 531, helpful: 60, notHelpful: 4, content: "# Creating a Site\nSites are managed inside a tenant's **Sites** tab.\n\n1. Open the tenant and go to the Sites tab.\n2. Click Add Site and choose a Site Type.\n3. Set whether it is the Primary Site.\n4. Save.\n\n> Frameworks are assigned to sites, not directly to the tenant." },
    { title: "How to Assign Frameworks", category: "framework", status: "Published", featured: true, summary: "Understand how frameworks map to sites and requirements.", keywords: ["framework", "assignment", "iso"], views: 766, helpful: 80, notHelpful: 9, content: "# Assigning Frameworks\nFrameworks belong to **sites**. A framework contains requirements; framework elements map many-to-many to those requirements.\n\n- Head Office → ISO 9001\n- Factory → ISO 45001\n- Data Center → ISO/IEC 27001" },
    { title: "How Subscription Billing Works", category: "billing", status: "Published", featured: true, summary: "How AXIA bills tenants and issues invoices.", keywords: ["billing", "subscription", "invoice"], views: 611, helpful: 70, notHelpful: 8, content: "# Subscription Billing\nAll revenue is collected by **AXIA**. Tenants always pay AXIA directly — partners never invoice tenants.\n\n> Receipts are issued only after a payment is verified." },
    { title: "How Partner Revenue Share Works", category: "partner", status: "Published", featured: true, summary: "How partners earn revenue share on tenant invoices.", keywords: ["partner", "revenue share", "payout"], views: 524, helpful: 58, notHelpful: 7, content: "# Partner Revenue Share\nOnly **partner-acquired** tenants generate revenue share. AXIA pays the partner a percentage of each tenant invoice based on the Partner Agreement.\n\n> Direct-acquired tenants do not generate partner revenue share." },
    { title: "Cannot Activate Account", category: "troubleshooting", status: "Published", summary: "Steps to resolve activation link issues.", keywords: ["activation", "link expired", "password"], views: 903, helpful: 88, notHelpful: 21, content: "# Cannot Activate Account\nActivation links expire for security.\n\n1. Check the email address the link was sent to.\n2. Use the Resend Activation option.\n3. Open the new link within the validity window." },
    { title: "Can One Tenant Have Multiple Sites?", category: "faq", status: "Published", summary: "Yes — tenants can have many sites.", keywords: ["tenant", "sites", "multiple"], views: 355, helpful: 48, notHelpful: 1, content: "# Multiple Sites\nYes. A tenant can have many sites (Head Office, Factory, Warehouse, …) but exactly **one Primary Site**." },
    { title: "Version 1.0.0 Release Notes", category: "release", status: "Published", summary: "Initial AXIA platform release.", keywords: ["release", "changelog", "1.0.0"], views: 402, helpful: 36, notHelpful: 2, content: "# Version 1.0.0\nThe first AXIA release.\n\n- Organization, Team, Partner, Tenant, and Framework management\n- Partnership Agreements with a block editor\n- Billing Management with revenue share\n- Ticket Management with SLA tracking\n- Knowledge Base" },
    { title: "Tenant Onboarding Checklist (Draft)", category: "platform", status: "Draft", summary: "Internal draft checklist for tenant onboarding.", keywords: ["onboarding", "checklist", "internal"], views: 0, helpful: 0, notHelpful: 0, content: "# Onboarding Checklist (Draft)\n- Create tenant\n- Create primary site\n- Create administrator\n- Confirm activation\n\n> Draft — pending review before publishing." },
  ];
  for (let i = 0; i < KB_SPECS.length; i++) {
    const s = KB_SPECS[i];
    const code = `KB-2026-${String(i + 1).padStart(4, "0")}`;
    await KbArticle.findOrCreate({
      where: { code },
      defaults: {
        code, title: s.title, category: s.category, status: s.status, author: "AXIA Support",
        summary: s.summary, content: s.content, keywords: s.keywords, featured: s.featured ?? false,
        views: s.views, uniqueViews: Math.round(s.views * 0.72), helpful: s.helpful, notHelpful: s.notHelpful,
        publishedAt: s.status === "Published" ? new Date() : null,
      },
    });
  }

  // 12. Support tickets across personas (idempotent via code).
  const tIso = (d: number) => new Date(2026, 5, d, 12, 0, 0).toISOString();
  interface TicketSpec {
    subject: string; description: string; category: string; priority: string; status: string;
    scope: "sp" | "partner" | "tenant"; orgId: string; orgName: string; managedBy: string | null;
    by: { name: string; email: string }; assignedTo: string | null;
    messages: { author: { name: string; kind: "user" | "support" }; text: string; ts: string }[];
    activity: { event: string; ts: string }[];
  }
  const TICKET_SPECS: TicketSpec[] = [
    { subject: "Cannot Activate Tenant Account", description: "Our tenant admin cannot complete activation — the link appears expired.", category: "Technical Support", priority: "High", status: "In Progress", scope: "tenant", orgId: tenant.id, orgName: tenant.name, managedBy: dist.name, by: { name: "Tenant Admin", email: "admin@acme.com" }, assignedTo: "Raka Pratama", messages: [{ author: { name: "Tenant Admin", kind: "user" }, text: "The activation link says expired.", ts: tIso(2) }, { author: { name: "Raka Pratama", kind: "support" }, text: "We've resent the activation — please retry.", ts: tIso(3) }], activity: [{ event: "Ticket created", ts: tIso(2) }, { event: "Assigned to Raka Pratama", ts: tIso(3) }, { event: "Status changed to In Progress", ts: tIso(3) }] },
    { subject: "Invoice Status Incorrect", description: "An invoice shows unpaid but we completed the transfer.", category: "Billing", priority: "Medium", status: "Waiting for Customer", scope: "tenant", orgId: tenant.id, orgName: tenant.name, managedBy: dist.name, by: { name: "Tenant Billing", email: "billing@acme.com" }, assignedTo: "Dewi Lestari", messages: [{ author: { name: "Tenant Billing", kind: "user" }, text: "Our invoice still shows unpaid after payment.", ts: tIso(5) }, { author: { name: "Dewi Lestari", kind: "support" }, text: "Could you share the transfer reference?", ts: tIso(6) }], activity: [{ event: "Ticket created", ts: tIso(5) }, { event: "Status changed to Waiting for Customer", ts: tIso(6) }] },
    { subject: "Need Assistance with Partner Onboarding", description: "We would like guidance on onboarding our first batch of tenants.", category: "Commercial", priority: "Medium", status: "Open", scope: "partner", orgId: dist.id, orgName: dist.name, managedBy: null, by: { name: "Distributor Admin", email: "admin@northwind.io" }, assignedTo: null, messages: [{ author: { name: "Distributor Admin", kind: "user" }, text: "Can someone walk us through onboarding tenants?", ts: tIso(7) }], activity: [{ event: "Ticket created", ts: tIso(7) }] },
    { subject: "Document Upload Error", description: "Uploading a PDF over 5MB fails silently.", category: "Bug Report", priority: "High", status: "Resolved", scope: "tenant", orgId: tenant.id, orgName: tenant.name, managedBy: dist.name, by: { name: "Tenant Member", email: "member@acme.com" }, assignedTo: "Raka Pratama", messages: [{ author: { name: "Tenant Member", kind: "user" }, text: "Large PDF uploads fail with no message.", ts: tIso(1) }, { author: { name: "Raka Pratama", kind: "support" }, text: "Fixed in the latest release — please retry.", ts: tIso(2) }], activity: [{ event: "Ticket created", ts: tIso(1) }, { event: "Ticket resolved", ts: tIso(2) }] },
    { subject: "Feature Request: Bulk Site Import", description: "Could we import sites via CSV for large tenants?", category: "Feature Request", priority: "Low", status: "Open", scope: "partner", orgId: dist.id, orgName: dist.name, managedBy: null, by: { name: "Distributor Admin", email: "admin@northwind.io" }, assignedTo: null, messages: [{ author: { name: "Distributor Admin", kind: "user" }, text: "A CSV bulk site import would save us time.", ts: tIso(8) }], activity: [{ event: "Ticket created", ts: tIso(8) }] },
  ];
  for (let i = 0; i < TICKET_SPECS.length; i++) {
    const s = TICKET_SPECS[i];
    const code = `TKT-2026-${String(i + 1).padStart(4, "0")}`;
    await Ticket.findOrCreate({
      where: { code },
      defaults: {
        code, subject: s.subject, description: s.description, category: s.category, priority: s.priority as never,
        status: s.status as never, scope: s.scope, orgId: s.orgId, orgName: s.orgName, managedBy: s.managedBy,
        createdBy: s.by, assignedTo: s.assignedTo, messages: s.messages, activity: s.activity, attachments: [],
      },
    });
  }

  // 13. In-app notifications (bell). SO-scoped (orgId null) + per-org examples.
  const nIso = (d: number) => new Date(2026, 5, d, 12, 0, 0).toISOString();
  const NOTIF_SPECS: { orgId: string | null; text: string; read: boolean; at: string }[] = [
    { orgId: null, text: "Critical ticket TKT-2026-0001 needs attention", read: false, at: nIso(9) },
    { orgId: dist.id, text: "New ticket: Need Assistance with Partner Onboarding", read: false, at: nIso(7) },
    { orgId: tenant.id, text: "Reply on TKT-2026-0002 — Invoice Status", read: true, at: nIso(6) },
    { orgId: tenant.id, text: "Ticket TKT-2026-0004 was resolved", read: true, at: nIso(4) },
  ];
  for (const n of NOTIF_SPECS) {
    const [, created] = await Notification.findOrCreate({
      where: { text: n.text, orgId: n.orgId },
      defaults: { orgId: n.orgId, text: n.text, link: null, read: n.read },
    });
    if (created) {
      // Backdate so the bell shows a realistic order (createdAt is set-on-create).
      await Notification.update({ createdAt: new Date(n.at) }, { where: { text: n.text, orgId: n.orgId }, silent: true });
    }
  }

  // 14. Tenant Implementation registers — a few records per module for the demo tenant.
  interface ImplSpec { module: string; prefix: string; title: string; status: string; owner: string | null; data: Record<string, unknown>; }
  const IMPL_SPECS: ImplSpec[] = [
    { module: "documents", prefix: "DOC", title: "Information Security Policy", status: "Active", owner: "Tenant Admin", data: { type: "Policy", version: "v1.2", confidentiality: "Internal", reviewDate: "2026-12-31" } },
    { module: "documents", prefix: "DOC", title: "Access Control Procedure", status: "Draft", owner: "Tenant Admin", data: { type: "Procedure", version: "v0.9", confidentiality: "Internal", reviewDate: "2026-09-30" } },
    { module: "compliance", prefix: "COM", title: "Maintain documented ISMS scope", status: "Active", owner: "Tenant Admin", data: { type: "Regulatory", priority: "Critical", framework: "ISO/IEC 27001", dueDate: "2026-12-31" } },
    { module: "risks", prefix: "RSK", title: "Phishing attack on staff", status: "Under Review", owner: "Security Lead", data: { category: "Operational", likelihood: 4, impact: 4, treatment: "Mitigate" } },
    { module: "risks", prefix: "RSK", title: "Single cloud region outage", status: "Identified", owner: "IT Lead", data: { category: "Technical", likelihood: 2, impact: 5, treatment: "Transfer" } },
    { module: "competence", prefix: "CMP", title: "ISO 27001 Lead Implementer", status: "Competent", owner: "Tenant Admin", data: { person: "Budi Santoso", role: "Security Lead", training: "ISO 27001 LI", assessedDate: "2026-03-01", expiresDate: "2029-03-01" } },
    { module: "objectives", prefix: "OBJ", title: "Reduce security incidents 20%", status: "Active", owner: "Security Lead", data: { type: "Operational", target: "20", unit: "% reduction", progress: 35, targetDate: "2026-12-31" } },
    { module: "audits", prefix: "AUD", title: "ISMS Internal Audit Q2", status: "Planned", owner: "Internal Auditor", data: { scope: "Head Office ISMS", auditor: "Jane Auditor", plannedDate: "2026-07-15", findings: 0 } },
    { module: "reviews", prefix: "MRV", title: "Annual Management Review 2026", status: "Planned", owner: "Tenant Admin", data: { reviewType: "Annual", reviewDate: "2026-08-01", attendees: "Exec team" } },
    { module: "incidents", prefix: "INC", title: "Lost company laptop", status: "In Progress", owner: "Security Lead", data: { type: "Incident", severity: "High", discoveredDate: "2026-05-20", rootCause: "Unattended device", correctiveAction: "Remote wipe + policy reminder" } },
  ];
  const implSeqByPrefix: Record<string, number> = {};
  for (const s of IMPL_SPECS) {
    implSeqByPrefix[s.prefix] = (implSeqByPrefix[s.prefix] ?? 0) + 1;
    const code = `${s.prefix}-${String(implSeqByPrefix[s.prefix]).padStart(4, "0")}`;
    await ImplementationRecord.findOrCreate({
      where: { orgId: tenant.id, module: s.module, code },
      defaults: { orgId: tenant.id, module: s.module as never, code, title: s.title, status: s.status, owner: s.owner, data: s.data },
    });
  }

  // 15. Business Unit records (Enterprise / Datana / Motoran) for the SO org.
  interface BizSpec { area: string; module: string; prefix: string; title: string; status: string; owner: string | null; data: Record<string, unknown>; }
  const BIZ_SPECS: BizSpec[] = [
    { area: "enterprise", module: "ent-personnel", prefix: "PER", title: "Budi Santoso", status: "Active", owner: "HR", data: { department: "Engineering", position: "Senior Engineer", joinDate: "2024-02-01" } },
    { area: "enterprise", module: "ent-suppliers", prefix: "SUP", title: "Cloud Infra Co", status: "Active", owner: "Procurement", data: { category: "Hosting", contact: "sales@cloudinfra.io", country: "SG" } },
    { area: "enterprise", module: "ent-leads", prefix: "LEA", title: "PT Sukses Makmur", status: "Qualified", owner: "Sales", data: { source: "Referral", value: "120000000", stage: "Proposal" } },
    { area: "datana", module: "dn-pentest", prefix: "PEN", title: "PT Maju Bersama Web App Pentest", status: "In Progress", owner: "Raka Pratama", data: { client: "PT Maju Bersama", scope: "Web + API", severityHigh: 2, startDate: "2026-05-10" } },
    { area: "datana", module: "dn-vuln", prefix: "VUL", title: "Q2 External Scan", status: "Open", owner: "Security Team", data: { asset: "External perimeter", critical: 1, high: 4, medium: 12 } },
    { area: "motoran", module: "mb-fleet", prefix: "FLE", title: "Honda Vario 160 (DK 1234 AB)", status: "Available", owner: "Fleet Ops", data: { type: "Scooter", plate: "DK 1234 AB", location: "Kuta", odometer: 8200 } },
    { area: "motoran", module: "mb-booking", prefix: "BOO", title: "Booking — John Tourist", status: "Confirmed", owner: "Front Desk", data: { customer: "John Tourist", vehicle: "Honda Vario 160", from: "2026-06-10", to: "2026-06-15" } },
  ];
  const bizSeqByKey: Record<string, number> = {};
  for (const s of BIZ_SPECS) {
    const key = `${s.area}/${s.module}`;
    bizSeqByKey[key] = (bizSeqByKey[key] ?? 0) + 1;
    const code = `${s.prefix}-${String(bizSeqByKey[key]).padStart(4, "0")}`;
    await BusinessRecord.findOrCreate({
      where: { orgId: so.id, area: s.area, module: s.module, code },
      defaults: { orgId: so.id, area: s.area as never, module: s.module, code, title: s.title, status: s.status, owner: s.owner, data: s.data },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      "Seed complete.",
      "  Orgs: AXIA (ServiceOwner), Northwind Partners (Distributor), Acme Corp (Tenant)",
      "  Roles per org: Super Admin (SO only, bypass) + Administrator (full CRUD) + specialists (read-only)",
      `  Users (password ${DEFAULT_PASSWORD}): soadmin / admin / support / billing / distadmin / distsupport / distbilling / tenantadmin / tenantbilling / tenantmember`,
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
