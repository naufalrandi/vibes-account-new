import "dotenv/config";
import { Op } from "sequelize";
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
  FrameworkGroup,
  Requirement,
  Element,
  ElementRequirementMap,
  Criterion,
  Question,
  AssessmentResponse,
  ResponseCriterion,
  FrameworkAssignment,
  KbArticle,
  Ticket,
  Notification,
  ImplementationRecord,
  BusinessRecord,
  AgreementTemplate,
  RegistrationRequest,
  SiteRequest,
} from "../models";
import type { FrameworkAssignmentStatus } from "../models/frameworkAssignment.model";
import { ACTIONS, MENU_SEED, type SeedMenu } from "../../modules/iam/actions.catalog";
import { MODULES } from "../../modules/iam/modules.catalog";
import { ROLES_BY_ORG_TYPE } from "../../modules/iam/role.catalog";
import type { OrgType, OrgStatus, PartnerStatus, PartnerTier, PartnerAuditEntry } from "../models/organization.model";
import type { SiteType } from "../models/site.model";
import type { PermissionMode, UserStatus } from "../models/user.model";
import type { AgreementBlock } from "../models/agreementTemplate.model";
import type { SiteRequestType, SiteRequestStatus, SiteRequestProposed } from "../models/siteRequest.model";
import { hashPassword } from "../../lib/password";

// Demo password for every seeded account, matching the AXIA mockup's Demo
// sign-in ("Demo password for all accounts: vibes2026"). Login does not enforce
// the activation/reset password policy, so this is accepted for the pre-seeded
// Active demo users.
const DEFAULT_PASSWORD = "vibes2026";
const ALL_MODULE_KEYS = MODULES.map((m) => m.key);

/** Extra Team Management metadata applied to a seeded user (idempotently). */
interface UserExtras {
  system?: boolean;
  permissionMode?: PermissionMode | null;
  permissions?: string[];
  status?: UserStatus;
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
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const [user] = await User.findOrCreate({
    where: { username },
    defaults: {
      orgId,
      tenantId,
      fullName,
      username,
      email,
      passwordHash,
      status: extras.status ?? "Active",
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
  // backfills the system flag, permission grid state, and the demo password
  // (so existing rows adopt the canonical demo credential on every reseed).
  user.passwordHash = passwordHash;
  user.system = extras.system ?? false;
  user.permissionMode = extras.permissionMode ?? null;
  user.permissions = extras.permissions ?? [];
  user.status = extras.status ?? "Active";
  await user.save();
  await (user as unknown as WithSetRoles).setRoles([role]);
}

/**
 * One-time, idempotent cleanup of the pre-mockup demo orgs ("Northwind Partners"
 * / NWP and "Acme Corp" / ACME). They predate the AXIA mockup alignment and are
 * replaced by the canonical partners + tenants below. Org FKs are not ON DELETE
 * CASCADE, so dependent rows are removed in FK-safe order before the org itself.
 */
async function cleanupLegacyDemoOrgs(): Promise<void> {
  const legacy = await Organization.findAll({ where: { code: { [Op.in]: ["NWP", "ACME"] } } });
  for (const org of legacy) {
    const roles = await Role.findAll({ where: { orgId: org.id } });
    // user_roles / role_*_grants are ON DELETE CASCADE — deleting users & roles clears them.
    await User.destroy({ where: { orgId: org.id } });
    for (const r of roles) await r.destroy();
    await Site.destroy({ where: { orgId: org.id } });
    await Subscription.destroy({ where: { orgId: org.id } });
    await Invoice.destroy({ where: { orgId: org.id } });
    await Ticket.destroy({ where: { orgId: org.id } });
    await Notification.destroy({ where: { orgId: org.id } });
    await ImplementationRecord.destroy({ where: { orgId: org.id } });
    await FrameworkAssignment.destroy({ where: { orgId: org.id } });
    await OrgSignatory.destroy({ where: { orgId: org.id } });
    await org.destroy();
  }
  // Obsolete pre-mockup demo users (old SP roster + old tenant admins) — their
  // emails are reused by the canonical users below, so they must go first.
  // user_roles is ON DELETE CASCADE, so deleting the users is FK-safe.
  const OBSOLETE_USERNAMES = [
    "soadmin", "admin", "support", "billing",
    "distadmin", "distsupport", "distbilling",
    "tenantadmin", "tenantbilling", "tenantmember",
    "majuadmin", "sentosaadmin", "andalanadmin", "tekstiladmin", "abcadmin",
  ];
  await User.destroy({ where: { username: { [Op.in]: OBSOLETE_USERNAMES } } });
  // Clear stale tenant framework assignments + invoices so block 10 re-seeds them
  // with the exact mockup distribution (the prior seed used a different split, so
  // the sequential FA-/INV- codes would otherwise collide on re-seed).
  const tenantOrgs = await Organization.findAll({ where: { type: "Tenant" }, attributes: ["id"] });
  const tenantIds = tenantOrgs.map((o) => o.id);
  if (tenantIds.length) {
    await FrameworkAssignment.destroy({ where: { orgId: { [Op.in]: tenantIds } } });
    await Invoice.destroy({ where: { orgId: { [Op.in]: tenantIds } } });
  }
}

export async function seed(): Promise<void> {
  initModels();
  await sequelize.authenticate();

  // 0. Remove pre-mockup demo orgs so the AXIA-aligned partners/tenants are the
  //    only commercial records (idempotent — no-op once they're gone).
  await cleanupLegacyDemoOrgs();

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

  // 5. Service-Provider team — the exact AXIA mockup roster (Team Management).
  //    idsp1 Giandy Gumilang is the locked super administrator; the rest mirror
  //    the mockup's role groups, permission modes, and lifecycle statuses.
  await ensureUser("superadmin", "Giandy Gumilang", "admin@axia.io", so.id, superAdminRole, null, {
    system: true, permissionMode: "Full Access", permissions: ALL_MODULE_KEYS, status: "Active",
  });
  await ensureUser("billing.lead", "Dewi Lestari", "billing@axia.io", so.id, soRoles.get("Billing Manager")!, null, {
    system: true, permissionMode: null, permissions: ["billing"], status: "Active",
  });
  await ensureUser("support.lead", "Raka Pratama", "support@axia.io", so.id, soRoles.get("Technical Support")!, null, {
    system: true, permissionMode: null, permissions: ["ticket"], status: "Active",
  });
  await ensureUser("sara.admin", "Sara Tan", "sara@axia.io", so.id, soRoles.get("Administrator")!, null, {
    permissionMode: "Custom Access", permissions: ["team", "tenant", "framework"], status: "Active",
  });
  await ensureUser("budi.support", "Budi Santoso", "budi@axia.io", so.id, soRoles.get("Technical Support")!, null, {
    permissionMode: null, permissions: ["ticket"], status: "PendingActivation",
  });
  await ensureUser("maya.billing", "Maya Putri", "maya@axia.io", so.id, soRoles.get("Billing Manager")!, null, {
    permissionMode: null, permissions: ["billing"], status: "Suspended",
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

  // 7. AXIA Partner organizations (Commercial) — the exact mockup roster. Each
  //    partner is a Distributor org with lifecycle metadata + an admin (and a
  //    billing-manager teammate where the mockup has one). Idempotent by code.
  interface PartnerTeammate { username: string; fullName: string; email: string; role: string; status: UserStatus; }
  interface PartnerSpec {
    code: string; name: string; email: string; phone: string; website: string; country: string; address: string;
    orgStatus: OrgStatus; partnerStatus: PartnerStatus; tier: PartnerTier; audit: string[];
    admin: { username: string; fullName: string; email: string; status: UserStatus };
    team?: PartnerTeammate[];
  }
  const PARTNER_SPECS: PartnerSpec[] = [
    { code: "PRT-1001", name: "Nusantara Cloud", email: "partners@nusantara.cloud", phone: "+62 21 5555 1200", website: "nusantara.cloud", country: "ID", address: "Jl. Sudirman Kav. 52, Jakarta",
      orgStatus: "Active", partnerStatus: "Active", tier: "Gold",
      admin: { username: "andi.admin", fullName: "Andi Wijaya", email: "andi@nusantara.cloud", status: "Active" },
      team: [{ username: "sri.billing", fullName: "Sri Handayani", email: "sri@nusantara.cloud", role: "Billing Manager", status: "Active" }],
      audit: ["Partner Administrator activated account", "Activation email sent to andi@nusantara.cloud", "Partnership agreement approved", "Partnership agreement AGR-2026-0001 generated & sent", "Partner organization created"] },
    { code: "PRT-1002", name: "SecureEdge Pte Ltd", email: "hello@secureedge.sg", phone: "+65 6555 8800", website: "secureedge.sg", country: "SG", address: "10 Anson Road, #20-01, Singapore",
      orgStatus: "PendingApproval", partnerStatus: "Pending Approval", tier: "Silver",
      admin: { username: "weilin.admin", fullName: "Wei Lin Goh", email: "weilin@secureedge.sg", status: "PendingActivation" },
      audit: ["Partnership agreement AGR-2026-0002 generated & sent", "Partner organization created"] },
    { code: "PRT-1003", name: "Andes Compliance SpA", email: "contacto@andescompliance.cl", phone: "+56 2 2555 4400", website: "andescompliance.cl", country: "CL", address: "Av. Apoquindo 4500, Las Condes, Santiago",
      orgStatus: "Draft", partnerStatus: "Draft", tier: "Bronze",
      admin: { username: "camila.admin", fullName: "Camila Rojas", email: "camila@andescompliance.cl", status: "PendingActivation" },
      audit: ["Partner organization created"] },
    { code: "PRT-1004", name: "Rhein Governance GmbH", email: "kontakt@rheingov.de", phone: "+49 30 5555 7700", website: "rheingov.de", country: "DE", address: "Friedrichstraße 88, Berlin",
      orgStatus: "Suspended", partnerStatus: "Suspended", tier: "Silver",
      admin: { username: "lukas.admin", fullName: "Lukas Brandt", email: "lukas@rheingov.de", status: "Suspended" },
      audit: ["Partner suspended — payment overdue", "Partner Administrator activated account", "Partner organization created"] },
    { code: "PRT-1005", name: "ABC Consulting", email: "partners@abcconsulting.co.id", phone: "+62 21 5555 9000", website: "abcconsulting.co.id", country: "ID", address: "Jl. Thamrin 5, Jakarta",
      orgStatus: "Active", partnerStatus: "Active", tier: "Gold",
      admin: { username: "hendra.admin", fullName: "Hendra Kusuma", email: "hendra@abcconsulting.co.id", status: "Active" },
      team: [{ username: "lia.billing", fullName: "Lia Permata", email: "lia@abcconsulting.co.id", role: "Billing Manager", status: "Active" }],
      audit: ['Tenant "ABC Manufacturing" provisioned', "Partner Administrator activated account", "Partner organization created"] },
  ];
  const auditTrail = (msgs: string[]): PartnerAuditEntry[] =>
    msgs.map((msg, i) => ({ ts: new Date(2026, 4, 20 - i, 9, 0, 0).toISOString(), msg }));
  const partnersByCode = new Map<string, Organization>();
  for (const p of PARTNER_SPECS) {
    const [org] = await Organization.findOrCreate({
      where: { code: p.code },
      defaults: {
        name: p.name, code: p.code, type: "Distributor", status: p.orgStatus,
        parentOrgId: so.id, tenantId: null, email: p.email, phone: p.phone, website: p.website, country: p.country, address: p.address,
      },
    });
    // Idempotent backfill of profile + partner lifecycle metadata.
    org.name = p.name; org.status = p.orgStatus; org.email = p.email; org.phone = p.phone;
    org.website = p.website; org.country = p.country; org.address = p.address;
    org.partnerStatus = p.partnerStatus; org.partnerTier = p.tier; org.partnerCode = p.code;
    org.partnerAudit = org.partnerAudit?.length ? org.partnerAudit : auditTrail(p.audit);
    await org.save();
    const roles = await ensureRoleSet(org.id, "Distributor");
    await grantRoleSet(roles);
    await ensureUser(p.admin.username, p.admin.fullName, p.admin.email, org.id, roles.get("Administrator")!, null, { status: p.admin.status });
    for (const t of p.team ?? []) {
      await ensureUser(t.username, t.fullName, t.email, org.id, roles.get(t.role)!, null, { status: t.status });
    }
    partnersByCode.set(p.code, org);
  }

  // 9. Billing plan catalog. Per-tenant invoices are seeded with their tenant in block 10.
  const PLANS: { code: string; name: string; description: string; billingFrequency: "Monthly" | "Annual"; status: "Active" }[] = [
    { code: "PLN-0001", name: "Starter", description: "Entry plan for small organizations and single-site tenants.", billingFrequency: "Monthly", status: "Active" },
    { code: "PLN-0002", name: "Professional", description: "Multi-site implementation with standard framework support.", billingFrequency: "Monthly", status: "Active" },
    { code: "PLN-0003", name: "Enterprise", description: "Unlimited sites, priority support, and advanced frameworks.", billingFrequency: "Annual", status: "Active" },
  ];
  for (const p of PLANS) {
    await Plan.findOrCreate({ where: { code: p.code }, defaults: p });
  }

  // 9c. Framework & Assessment master data — mirrors the AXIA mockup seed()
  // exactly (6 frameworks incl. the full ISO/IEC 27001:2022 clause set, 7
  // elements, element↔requirement mappings, conformance criteria, and the
  // assessment question/response/criteria chain). Idempotent via natural keys.
  const groupId = async (name: string): Promise<string> => {
    const g = await FrameworkGroup.findOne({ where: { name } });
    return g!.id;
  };
  const gStandards = await groupId("Standards");
  const gRegulations = await groupId("Regulations");

  interface FwSpec { name: string; group: string; description: string; jurisdictions?: string[]; }
  const FW_SPECS: FwSpec[] = [
    { name: "ISO 9001:2015", group: gStandards, description: "Quality management systems — requirements." },
    { name: "ISO 14001:2015", group: gStandards, description: "Environmental management systems." },
    { name: "ISO 45001:2018", group: gStandards, description: "Occupational health & safety management systems." },
    { name: "ISO/IEC 27001:2022", group: gStandards, description: "Information security management systems." },
    { name: "GDPR", group: gRegulations, description: "EU General Data Protection Regulation.", jurisdictions: ["EU"] },
    { name: "DORA", group: gRegulations, description: "Digital Operational Resilience Act.", jurisdictions: ["EU"] },
  ];
  const fwId: Record<string, string> = {};
  for (const f of FW_SPECS) {
    const [row] = await Framework.findOrCreate({
      where: { name: f.name },
      defaults: { name: f.name, groupId: f.group, description: f.description, jurisdictions: f.jurisdictions ?? [], status: "Active" },
    });
    fwId[f.name] = row.id;
  }

  // [framework, code, subject, description]
  const REQ_SPECS: [string, string, string, string][] = [
    ["ISO 9001:2015", "Clause 9.2.1", "Internal Audit", "The organization shall conduct internal audits at planned intervals to provide information on whether the quality management system conforms to requirements and is effectively implemented and maintained."],
    ["ISO 9001:2015", "Clause 9.3", "Management Review", "Top management shall review the organization’s quality management system at planned intervals to ensure its continuing suitability, adequacy, effectiveness and alignment with strategic direction."],
    ["ISO 9001:2015", "Clause 7.2", "Competence", "The organization shall determine the necessary competence of persons doing work under its control that affects the performance and effectiveness of the quality management system."],
    ["ISO 14001:2015", "Clause 9.2.2", "Internal Audit Programme", "The organization shall establish, implement and maintain an internal audit programme for the environmental management system, including frequency, methods, responsibilities and reporting."],
    ["ISO 45001:2018", "Clause 9.2.2", "Internal Audit Programme", "The organization shall establish, implement and maintain an internal audit programme for the OH&S management system, taking into account the importance of the processes concerned."],
    ["ISO/IEC 27001:2022", "Clause 4.1", "Understanding the Organization and its Context", "The organization shall determine external and internal issues that are relevant to its purpose and that affect its ability to achieve the intended outcome(s) of its information security management system."],
    ["ISO/IEC 27001:2022", "Clause 4.2", "Needs and Expectations of Interested Parties", "The organization shall determine interested parties relevant to the ISMS, their relevant requirements, and which of those requirements will be addressed through the information security management system."],
    ["ISO/IEC 27001:2022", "Clause 4.3", "Determining the Scope of the ISMS", "The organization shall determine the boundaries and applicability of the ISMS to establish its scope, considering external and internal issues, interested-party requirements, and interfaces and dependencies. The scope shall be available as documented information."],
    ["ISO/IEC 27001:2022", "Clause 4.4", "Information Security Management System", "The organization shall establish, implement, maintain and continually improve an information security management system, including the processes needed and their interactions, in accordance with the requirements of this document."],
    ["ISO/IEC 27001:2022", "Clause 5.1", "Leadership and Commitment", "Top management shall demonstrate leadership and commitment with respect to the ISMS, including ensuring the policy and objectives are established, integrating ISMS requirements into the organization’s processes, providing resources, communicating the importance of information security, and promoting continual improvement."],
    ["ISO/IEC 27001:2022", "Clause 5.2", "Policy", "Top management shall establish an information security policy that is appropriate to the organization, includes or frames information security objectives, commits to satisfying applicable requirements and to continual improvement, and is documented, communicated within the organization, and available to interested parties as appropriate."],
    ["ISO/IEC 27001:2022", "Clause 5.3", "Organizational Roles, Responsibilities and Authorities", "Top management shall ensure that responsibilities and authorities for information-security-relevant roles are assigned and communicated, including for ensuring the ISMS conforms to this document and for reporting on ISMS performance to top management."],
    ["ISO/IEC 27001:2022", "Clause 6.1.1", "Actions to Address Risks and Opportunities — General", "When planning for the ISMS, the organization shall consider the issues (4.1) and requirements (4.2) and determine the risks and opportunities that need to be addressed, then plan actions to address them and how to integrate, implement and evaluate the effectiveness of those actions."],
    ["ISO/IEC 27001:2022", "Clause 6.1.2", "Information Security Risk Assessment", "The organization shall define and apply an information security risk assessment process that establishes and maintains risk criteria, ensures consistent, valid and comparable results, and identifies, analyses and evaluates information security risks. Documented information about the process shall be retained."],
    ["ISO/IEC 27001:2022", "Clause 6.1.3", "Information Security Risk Treatment", "The organization shall define and apply a risk treatment process to select treatment options, determine necessary controls, compare them against Annex A, produce a Statement of Applicability, formulate a risk treatment plan, and obtain risk owners’ approval and acceptance of residual risks. Documented information shall be retained."],
    ["ISO/IEC 27001:2022", "Clause 6.2", "Information Security Objectives and Planning", "The organization shall establish information security objectives at relevant functions and levels that are consistent with the policy, measurable where practicable, monitored, communicated and updated, and shall plan what will be done, with what resources, by whom, when, and how results will be evaluated."],
    ["ISO/IEC 27001:2022", "Clause 6.3", "Planning of Changes", "When the organization determines the need for changes to the information security management system, the changes shall be carried out in a planned manner."],
    ["ISO/IEC 27001:2022", "Clause 7.1", "Resources", "The organization shall determine and provide the resources needed for the establishment, implementation, maintenance and continual improvement of the information security management system."],
    ["ISO/IEC 27001:2022", "Clause 7.2", "Competence", "The organization shall determine the necessary competence of persons whose work affects information security performance, ensure they are competent, take actions to acquire competence where applicable, and retain documented information as evidence of competence."],
    ["ISO/IEC 27001:2022", "Clause 7.3", "Awareness", "Persons doing work under the organization’s control shall be aware of the information security policy, their contribution to the effectiveness of the ISMS, and the implications of not conforming with ISMS requirements."],
    ["ISO/IEC 27001:2022", "Clause 7.4", "Communication", "The organization shall determine the need for internal and external communications relevant to the ISMS, including on what to communicate, when, with whom, and how to communicate."],
    ["ISO/IEC 27001:2022", "Clause 7.5.1", "Documented Information — General", "The information security management system shall include documented information required by this document and documented information determined by the organization as being necessary for the effectiveness of the ISMS."],
    ["ISO/IEC 27001:2022", "Clause 7.5.2", "Creating and Updating Documented Information", "When creating and updating documented information the organization shall ensure appropriate identification and description, format and media, and review and approval for suitability and adequacy."],
    ["ISO/IEC 27001:2022", "Clause 7.5.3", "Control of Documented Information", "Documented information required by the ISMS and by this document shall be controlled to ensure it is available and suitable for use and adequately protected, addressing distribution, access, storage and preservation, control of changes, and retention and disposition."],
    ["ISO/IEC 27001:2022", "Clause 8.1", "Operational Planning and Control", "The organization shall plan, implement and control the processes needed to meet requirements and implement the Clause 6 actions by establishing process criteria and controlling the processes accordingly, control planned changes, review consequences of unintended changes, and ensure externally provided processes, products or services relevant to the ISMS are controlled."],
    ["ISO/IEC 27001:2022", "Clause 8.2", "Information Security Risk Assessment (Operational)", "The organization shall perform information security risk assessments at planned intervals or when significant changes are proposed or occur, taking account of the established criteria, and retain documented information of the results."],
    ["ISO/IEC 27001:2022", "Clause 8.3", "Information Security Risk Treatment (Operational)", "The organization shall implement the information security risk treatment plan and retain documented information of the results of the risk treatment."],
    ["ISO/IEC 27001:2022", "Clause 9.1", "Monitoring, Measurement, Analysis and Evaluation", "The organization shall determine what needs to be monitored and measured, the methods, when monitoring is performed and by whom, and when results are analysed and evaluated, evaluate the information security performance and ISMS effectiveness, and retain documented information as evidence of the results."],
    ["ISO/IEC 27001:2022", "Clause 9.2.1", "Internal Audit — General", "The organization shall conduct internal audits at planned intervals to provide information on whether the ISMS conforms to the organization’s own requirements and to the requirements of this document, and is effectively implemented and maintained."],
    ["ISO/IEC 27001:2022", "Clause 9.2.2", "Internal Audit Programme", "The organization shall plan, establish, implement and maintain audit programme(s) including frequency, methods, responsibilities, planning requirements and reporting; define the audit criteria and scope for each audit; select auditors ensuring objectivity and impartiality; report results to relevant management; and retain documented evidence of the programme and its results."],
    ["ISO/IEC 27001:2022", "Clause 9.3.1", "Management Review — General", "Top management shall review the organization’s information security management system at planned intervals to ensure its continuing suitability, adequacy and effectiveness."],
    ["ISO/IEC 27001:2022", "Clause 9.3.2", "Management Review Inputs", "The management review shall consider the status of previous review actions, changes in external and internal issues and in interested-party needs, feedback on information security performance (nonconformities and corrective actions, monitoring and measurement results, audit results, objective fulfilment), feedback from interested parties, results of risk assessment and status of the risk treatment plan, and opportunities for continual improvement."],
    ["ISO/IEC 27001:2022", "Clause 9.3.3", "Management Review Results", "The results of the management review shall include decisions related to continual improvement opportunities and any needs for changes to the ISMS, and documented information shall be available as evidence of the results."],
    ["ISO/IEC 27001:2022", "Clause 10.1", "Continual Improvement", "The organization shall continually improve the suitability, adequacy and effectiveness of the information security management system."],
    ["ISO/IEC 27001:2022", "Clause 10.2", "Nonconformity and Corrective Action", "When a nonconformity occurs, the organization shall react to it and deal with its consequences, evaluate the need to eliminate its causes, implement any corrective action needed, review the effectiveness of corrective actions, and make changes to the ISMS if necessary. Corrective actions shall be appropriate to the effects of the nonconformities, and documented information shall be retained as evidence."],
    ["GDPR", "Article 32", "Security of Processing", "The controller and processor shall implement appropriate technical and organisational measures to ensure a level of security appropriate to the risk."],
    ["GDPR", "Article 30", "Records of Processing", "Each controller shall maintain a record of processing activities carried out under its responsibility."],
    ["DORA", "Article 6", "ICT Risk Management Framework", "Financial entities shall have a sound, comprehensive and well-documented ICT risk management framework as part of their overall risk management system."],
    ["DORA", "Article 5", "ICT Governance", "The management body shall define, approve, oversee and be responsible for the implementation of the ICT risk management framework."],
  ];
  const reqId: Record<string, string> = {}; // key: `${fwName}|${code}`
  for (const [fwName, code, subject, description] of REQ_SPECS) {
    const [row, created] = await Requirement.findOrCreate({
      where: { frameworkId: fwId[fwName], code },
      defaults: { frameworkId: fwId[fwName], code, subject, description, status: "Active" },
    });
    // Keep the canonical text in sync with the source on re-seed (subject/description
    // are the only mutable fields here; the natural key frameworkId+code is immutable).
    if (!created && (row.subject !== subject || row.description !== description)) {
      await row.update({ subject, description });
    }
    reqId[`${fwName}|${code}`] = row.id;
  }

  const EL_SPECS: [string, string][] = [
    ["Internal Audit", "Independent, periodic evaluation of conformity and effectiveness."],
    ["Management Review", "Top-management review of the system at planned intervals."],
    ["Quality Policy", "Documented intentions and direction related to quality."],
    ["Risk Assessment", "Identification, analysis and evaluation of risk."],
    ["Competence Management", "Ensuring people are competent for their assigned work."],
    ["Supplier Evaluation", "Assessment and monitoring of external providers."],
    ["Document Control", "Control of documented information across the system."],
  ];
  const elId: Record<string, string> = {};
  for (const [name, description] of EL_SPECS) {
    const [row] = await Element.findOrCreate({ where: { name }, defaults: { name, description, status: "Active" } });
    elId[name] = row.id;
  }

  const MAP_SPECS: [string, string, string][] = [ // [elementName, fwName, code]
    ["Internal Audit", "ISO 9001:2015", "Clause 9.2.1"],
    ["Internal Audit", "ISO/IEC 27001:2022", "Clause 9.2.1"],
    ["Internal Audit", "ISO 14001:2015", "Clause 9.2.2"],
    ["Internal Audit", "ISO 45001:2018", "Clause 9.2.2"],
    ["Management Review", "ISO 9001:2015", "Clause 9.3"],
    ["Competence Management", "ISO 9001:2015", "Clause 7.2"],
    ["Risk Assessment", "ISO/IEC 27001:2022", "Clause 6.1.2"],
    ["Risk Assessment", "GDPR", "Article 32"],
    ["Risk Assessment", "DORA", "Article 6"],
  ];
  for (const [elName, fwName, code] of MAP_SPECS) {
    const rid = reqId[`${fwName}|${code}`];
    if (rid) await ElementRequirementMap.findOrCreate({ where: { elementId: elId[elName], requirementId: rid }, defaults: { elementId: elId[elName], requirementId: rid } });
  }

  const CRIT_SPECS: [string, string, number, string][] = [ // [fwName, code, score, description]
    ["ISO 9001:2015", "Clause 9.2.1", 0, "No internal audits are performed."],
    ["ISO 9001:2015", "Clause 9.2.1", 1, "Audits are occasional and informal."],
    ["ISO 9001:2015", "Clause 9.2.1", 2, "Audits are planned, documented, and recurring."],
    ["ISO/IEC 27001:2022", "Clause 6.1.2", 0, "No activities have been carried out."],
    ["ISO/IEC 27001:2022", "Clause 6.1.2", 1, "Activities are ad-hoc and not standardized."],
    ["ISO/IEC 27001:2022", "Clause 6.1.2", 2, "Activities are standardized and regularly performed."],
  ];
  const critId: Record<string, string> = {}; // key `${fwName}|${code}|${score}`
  for (const [fwName, code, score, description] of CRIT_SPECS) {
    const rid = reqId[`${fwName}|${code}`];
    if (!rid) continue;
    const [row] = await Criterion.findOrCreate({ where: { requirementId: rid, score }, defaults: { requirementId: rid, score, description } });
    critId[`${fwName}|${code}|${score}`] = row.id;
  }

  const Q_SPECS: [string, string, number][] = [ // [elementName, text, sortOrder]
    ["Internal Audit", "How is the internal audit process defined?", 1],
    ["Internal Audit", "How frequently are internal audits performed?", 2],
    ["Risk Assessment", "How is risk assessment carried out?", 1],
  ];
  const qId: Record<string, string> = {};
  for (const [elName, text, sortOrder] of Q_SPECS) {
    const [row] = await Question.findOrCreate({ where: { elementId: elId[elName], text }, defaults: { elementId: elId[elName], text, sortOrder, status: "Active" } });
    qId[text] = row.id;
  }

  const R_SPECS: [string, string, number][] = [ // [questionText, text, sortOrder]
    ["How is the internal audit process defined?", "No formal or standardized process exists.", 1],
    ["How is the internal audit process defined?", "A process exists but is not standardized.", 2],
    ["How is the internal audit process defined?", "A standardized and formally defined process exists.", 3],
    ["How frequently are internal audits performed?", "Audits are not scheduled.", 1],
    ["How frequently are internal audits performed?", "Audits occur irregularly.", 2],
    ["How frequently are internal audits performed?", "Audits follow a planned annual programme.", 3],
  ];
  const rId: Record<string, string> = {};
  for (const [qText, text, sortOrder] of R_SPECS) {
    const [row] = await AssessmentResponse.findOrCreate({ where: { questionId: qId[qText], text }, defaults: { questionId: qId[qText], text, sortOrder, status: "Active" } });
    rId[text] = row.id;
  }

  const RC_SPECS: [string, string][] = [ // [responseText, criterionKey]
    ["No formal or standardized process exists.", "ISO 9001:2015|Clause 9.2.1|0"],
    ["A process exists but is not standardized.", "ISO 9001:2015|Clause 9.2.1|1"],
    ["A standardized and formally defined process exists.", "ISO 9001:2015|Clause 9.2.1|2"],
  ];
  for (const [rText, cKey] of RC_SPECS) {
    const respId = rId[rText], cId = critId[cKey];
    if (respId && cId) await ResponseCriterion.findOrCreate({ where: { responseId: respId, criterionId: cId }, defaults: { responseId: respId, criterionId: cId } });
  }

  // 10. AXIA tenants (TEN-1001…) — the exact mockup roster. Each gets a canonical
  // role set, its Tenant Administrator (with the mockup's lifecycle status), a
  // primary site, a subscription, framework assignments, and (where the mockup
  // bills it) six monthly invoices. Partner-acquired tenants parent to their
  // partner org; direct tenants parent to AXIA. Idempotent via findOrCreate.
  const someFrameworks = await Framework.findAll({ order: [["name", "ASC"]], limit: 3 });
  interface TenantBilling { startInv: number; amount: number; statuses: ("Paid" | "Unpaid" | "Draft")[]; }
  interface TenantSpec {
    code: string;
    name: string;
    status: OrgStatus;
    industry: string;
    country: string;
    source: "Direct" | "Partner";
    partnerCode: string | null;
    email: string;
    phone: string;
    website: string;
    address: string;
    adminUser: string;
    adminName: string;
    adminEmail: string;
    adminStatus: UserStatus;
    siteName: string;
    siteType: SiteType;
    frameworks: FrameworkAssignmentStatus[];
    billing: TenantBilling | null;
  }
  const TENANT_SPECS: TenantSpec[] = [
    { code: "TEN-1001", name: "PT Maju Bersama", status: "Active", industry: "Technology", country: "ID", source: "Partner", partnerCode: "PRT-1001",
      email: "it@majubersama.co.id", phone: "+62 21 5550 1000", website: "majubersama.co.id", address: "Jl. Gatot Subroto 10, Jakarta",
      adminUser: "rina.admin", adminName: "Rina Wijaya", adminEmail: "rina@majubersama.co.id", adminStatus: "Active",
      siteName: "Head Office", siteType: "Head Office", frameworks: ["Active", "Planned"],
      billing: { startInv: 1, amount: 12000000, statuses: ["Paid", "Paid", "Paid", "Paid", "Unpaid", "Draft"] } },
    { code: "TEN-1002", name: "Sentosa Logistics", status: "Active", industry: "Logistics", country: "ID", source: "Direct", partnerCode: null,
      email: "admin@sentosalog.com", phone: "+62 31 5550 2000", website: "sentosalog.com", address: "Jl. Rungkut Industri 5, Surabaya",
      adminUser: "doni.admin", adminName: "Doni Saputra", adminEmail: "doni@sentosalog.com", adminStatus: "Active",
      siteName: "Surabaya HQ", siteType: "Head Office", frameworks: ["Active"],
      billing: { startInv: 7, amount: 28000000, statuses: ["Paid", "Paid", "Paid", "Paid", "Unpaid", "Draft"] } },
    { code: "TEN-1003", name: "Andalan Pharma", status: "PendingApproval", industry: "Pharmaceutical", country: "ID", source: "Direct", partnerCode: null,
      email: "it@andalanpharma.co.id", phone: "+62 22 5550 3000", website: "andalanpharma.co.id", address: "Jl. Soekarno Hatta 88, Bandung",
      adminUser: "siti.admin", adminName: "Siti Aminah", adminEmail: "siti@andalanpharma.co.id", adminStatus: "PendingActivation",
      siteName: "Bandung Plant", siteType: "Factory", frameworks: [],
      billing: null },
    { code: "TEN-1004", name: "Global Tekstil", status: "Suspended", industry: "Manufacturing", country: "ID", source: "Partner", partnerCode: "PRT-1004",
      email: "admin@globaltekstil.com", phone: "+62 24 5550 4000", website: "globaltekstil.com", address: "Jl. Industri Raya 2, Semarang",
      adminUser: "bayu.admin", adminName: "Bayu Hartono", adminEmail: "bayu@globaltekstil.com", adminStatus: "Suspended",
      siteName: "Semarang HQ", siteType: "Head Office", frameworks: [],
      billing: { startInv: 13, amount: 4000000, statuses: ["Paid", "Paid", "Paid", "Unpaid", "Unpaid", "Draft"] } },
    { code: "TEN-1005", name: "ABC Manufacturing", status: "Active", industry: "Manufacturing", country: "ID", source: "Partner", partnerCode: "PRT-1005",
      email: "info@abcmfg.co", phone: "+62 21 5550 5000", website: "abcmfg.co", address: "Jl. Industri Pulogadung 12, Jakarta",
      adminUser: "maria.admin", adminName: "Maria Santos", adminEmail: "maria@abcmfg.co", adminStatus: "Active",
      siteName: "Head Office", siteType: "Head Office", frameworks: ["Active", "Active", "Active"],
      billing: { startInv: 19, amount: 18000000, statuses: ["Paid", "Paid", "Paid", "Paid", "Paid", "Draft"] } },
  ];
  const MONTHS: [string, string, string][] = [
    ["January", "2026-01-01", "2026-01-31"], ["February", "2026-02-01", "2026-02-28"], ["March", "2026-03-01", "2026-03-31"],
    ["April", "2026-04-01", "2026-04-30"], ["May", "2026-05-01", "2026-05-31"], ["June", "2026-06-01", "2026-06-30"],
  ];
  const tenantsByCode = new Map<string, Organization>();
  let siteSeq = 2000;
  let faSeq = 1000;
  for (const spec of TENANT_SPECS) {
    siteSeq += 1;
    const parentOrgId = spec.source === "Partner" ? partnersByCode.get(spec.partnerCode!)!.id : so.id;
    const [t] = await Organization.findOrCreate({
      where: { code: spec.code },
      defaults: {
        name: spec.name, code: spec.code, type: "Tenant", status: spec.status,
        parentOrgId, tenantId: null,
        email: spec.email, phone: spec.phone, website: spec.website, country: spec.country, address: spec.address,
        legalName: `${spec.name} Pte Ltd`, industry: spec.industry,
      },
    });
    // Idempotent backfill so re-seeding an older DB picks up the exact mockup profile.
    t.name = spec.name; t.status = spec.status; t.parentOrgId = parentOrgId;
    t.email = spec.email; t.phone = spec.phone; t.website = spec.website;
    t.country = spec.country; t.address = spec.address; t.industry = spec.industry;
    if (!t.tenantId) t.tenantId = t.id;
    await t.save();
    const tRoles = await ensureRoleSet(t.id, "Tenant");
    await grantRoleSet(tRoles);
    await ensureUser(spec.adminUser, spec.adminName, spec.adminEmail, t.id, tRoles.get("Administrator")!, t.id, { status: spec.adminStatus });
    const [site] = await Site.findOrCreate({
      where: { orgId: t.id, isPrimary: true },
      defaults: {
        orgId: t.id, code: `STE-${siteSeq}`, name: spec.siteName, type: spec.siteType,
        country: spec.country, address: null, status: "Active", isPrimary: true,
        description: null, contactPerson: null, contactEmail: null, contactPhone: null,
      },
    });
    site.name = spec.siteName; site.type = spec.siteType;
    await site.save();
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
    if (spec.billing) {
      for (let m = 0; m < MONTHS.length; m++) {
        const [period, start, end] = MONTHS[m];
        const number = `INV-2026-${String(spec.billing.startInv + m).padStart(4, "0")}`;
        const status = spec.billing.statuses[m];
        const mm = String(m + 1).padStart(2, "0");
        await Invoice.findOrCreate({
          where: { number },
          defaults: {
            number, orgId: t.id, period: `${period} 2026`, start, end, amount: spec.billing.amount, currency: "IDR", status,
            paidDate: status === "Paid" ? `2026-${mm}-05` : null,
            dueDate: status === "Unpaid" ? `2026-${mm}-14` : null,
          },
        });
      }
    }
    tenantsByCode.set(spec.code, t);
  }
  // Primary tenant referenced by downstream demo data (tickets / notifications / implementation records).
  const tenant = tenantsByCode.get("TEN-1001")!;

  // 11. Knowledge Base — platform-global help articles (idempotent via code).
  interface KbSpec {
    title: string; category: string; status: "Draft" | "Published"; featured?: boolean;
    summary: string; keywords: string[]; views: number; helpful: number; notHelpful: number; content: string;
  }
  const KB_SPECS: KbSpec[] = [
    { title: "How to Create a Tenant", category: "platform", status: "Published", featured: true, summary: "Provision a new customer organization and its primary site.", keywords: ["tenant", "create tenant", "onboarding", "provisioning"], views: 842, helpful: 96, notHelpful: 6, content: "# Creating a Tenant\nTenants are created by the Service Provider from **Tenant Management**.\n\n1. Open Tenant Management and click New Tenant.\n2. Choose the Acquisition Source (Direct or Partner).\n3. Enter the organization details and the Primary Site.\n4. Create the initial Tenant Administrator.\n5. Send the activation email.\n\n> Every tenant must have exactly one Primary Site, created during onboarding." },
    { title: "How to Create a Site", category: "platform", status: "Published", summary: "Add implementation scopes (sites) to a tenant.", keywords: ["site", "primary site", "head office", "factory"], views: 531, helpful: 60, notHelpful: 4, content: "# Creating a Site\nSites are managed inside a tenant's **Sites** tab.\n\n1. Open the tenant and go to the Sites tab.\n2. Click Add Site and choose a Site Type.\n3. Set whether it is the Primary Site.\n4. Save.\n\n> Frameworks are assigned to sites, not directly to the tenant." },
    { title: "How to Add Team Members", category: "platform", status: "Published", summary: "Invite internal Service Provider users and assign role groups.", keywords: ["team", "users", "roles", "invite", "activation"], views: 418, helpful: 44, notHelpful: 3, content: "# Adding Team Members\nUse **Team Management** to add internal users.\n\n1. Click Add User and choose a Role Group.\n2. For Administrators, set Full or Custom access.\n3. Submit — an activation email is sent automatically.\n\nRole groups: Administrator, Billing Manager, Technical Support." },
    { title: "How to Assign Frameworks", category: "framework", status: "Published", featured: true, summary: "Understand how frameworks map to sites and requirements.", keywords: ["framework", "assignment", "requirements", "iso"], views: 766, helpful: 80, notHelpful: 9, content: "# Assigning Frameworks\nFrameworks belong to **sites**. A framework contains requirements; framework elements map many-to-many to those requirements.\n\n- Head Office → ISO 9001\n- Factory → ISO 45001\n- Data Center → ISO/IEC 27001\n\n> Framework assignment to sites is rolling out progressively." },
    { title: "Understanding Framework Elements", category: "framework", status: "Published", summary: "Framework elements are the primary cross-reference object.", keywords: ["framework element", "cross-reference", "mapping", "requirement"], views: 389, helpful: 41, notHelpful: 5, content: "# Framework Elements\nA framework element (e.g. Internal Audit) can satisfy requirements across multiple frameworks.\n\n> One element → many requirements, and one requirement → many elements." },
    { title: "How Subscription Billing Works", category: "billing", status: "Published", featured: true, summary: "How AXIA bills tenants and issues invoices.", keywords: ["billing", "subscription", "invoice", "currency"], views: 611, helpful: 70, notHelpful: 8, content: "# Subscription Billing\nAll revenue is collected by **AXIA**. Tenants always pay AXIA directly — partners never invoice tenants.\n\n| Frequency | Notes |\n| --- | --- |\n| Monthly | Billed each period |\n| Annual | May include a discount |\n\n> Receipts are issued only after a payment is verified." },
    { title: "How to View Invoices", category: "billing", status: "Published", summary: "Find invoices, payments, and receipts for a tenant.", keywords: ["invoice", "payment", "receipt", "view"], views: 298, helpful: 30, notHelpful: 2, content: "# Viewing Invoices\nOpen a tenant and go to the **Billing** tab to see the subscription, invoices, payments, and receipts. Service Providers can also see all invoices under Billing Management → Invoices." },
    { title: "How Receipts Work", category: "billing", status: "Published", summary: "When and how receipts are generated.", keywords: ["receipt", "payment verification"], views: 176, helpful: 18, notHelpful: 1, content: "# Receipts\nA receipt is issued automatically once a payment is **verified**. Receipts reference the invoice and payment, and remain available for history." },
    { title: "How Partner Revenue Share Works", category: "partner", status: "Published", featured: true, summary: "How partners earn revenue share on tenant invoices.", keywords: ["partner", "revenue share", "payout", "commission"], views: 524, helpful: 58, notHelpful: 7, content: "# Partner Revenue Share\nOnly **partner-acquired** tenants generate revenue share. AXIA pays the partner a percentage of each tenant invoice based on the Partner Agreement.\n\n> Direct-acquired tenants do not generate partner revenue share." },
    { title: "How Partner Tiers Work", category: "partner", status: "Published", summary: "Bronze, Silver, and Gold tiers and their share ranges.", keywords: ["partner tier", "bronze", "silver", "gold"], views: 347, helpful: 38, notHelpful: 4, content: "# Partner Tiers\n| Tier | Base | Maximum |\n| --- | --- | --- |\n| Bronze | 15% | 20% |\n| Silver | 20% | 30% |\n| Gold | 30% | 35% |\n\nCurrent share may vary within the approved tier range." },
    { title: "Cannot Activate Account", category: "troubleshooting", status: "Published", summary: "Steps to resolve activation link issues.", keywords: ["activation", "cannot activate", "link expired", "password"], views: 903, helpful: 88, notHelpful: 21, content: "# Cannot Activate Account\nActivation links expire for security.\n\n1. Check the email address the link was sent to.\n2. Use the Resend Activation option.\n3. Open the new link within the validity window.\n\n> If it still fails, create a ticket from Ticket Management." },
    { title: "Cannot Upload Files", category: "troubleshooting", status: "Published", summary: "Fixes for failed file uploads.", keywords: ["upload", "file", "attachment", "error"], views: 472, helpful: 40, notHelpful: 12, content: "# Cannot Upload Files\nSupported formats: PDF, DOCX, XLSX, PNG, JPG.\n\n- Confirm the file type is supported.\n- Large files may take longer — wait for the upload to finish.\n- Retry after refreshing if the upload stalls." },
    { title: "Cannot Access Framework", category: "troubleshooting", status: "Published", summary: "Why a framework may not be visible.", keywords: ["framework access", "permission", "visibility"], views: 213, helpful: 19, notHelpful: 6, content: "# Cannot Access Framework\nFrameworks are assigned per site. Confirm the framework is assigned to the relevant site and that your account has access to that site." },
    { title: "Can One Tenant Have Multiple Sites?", category: "faq", status: "Published", summary: "Yes — tenants can have many sites.", keywords: ["tenant", "sites", "multiple"], views: 355, helpful: 48, notHelpful: 1, content: "# Multiple Sites\nYes. A tenant can have many sites (Head Office, Factory, Warehouse, …) but exactly **one Primary Site**." },
    { title: "Can One Site Have Multiple Frameworks?", category: "faq", status: "Published", summary: "Yes — sites can carry several frameworks.", keywords: ["site", "frameworks", "multiple"], views: 281, helpful: 34, notHelpful: 2, content: "# Multiple Frameworks per Site\nYes. A single site can implement several frameworks (e.g. a Factory running ISO 9001 and ISO 45001)." },
    { title: "How Do I Reset My Password?", category: "faq", status: "Published", summary: "Reset your password from the Security tab.", keywords: ["password", "reset", "security"], views: 688, helpful: 74, notHelpful: 5, content: "# Resetting Your Password\nOpen the account menu → **Security** → Change Password. New passwords must be at least 8 characters with an uppercase letter, a lowercase letter, and a number." },
    { title: "Version 1.0.0 Release Notes", category: "release", status: "Published", summary: "Initial AXIA platform release.", keywords: ["release", "changelog", "1.0.0"], views: 402, helpful: 36, notHelpful: 2, content: "# Version 1.0.0\nThe first AXIA release.\n\n- Organization, Team, Partner, Tenant, and Framework management\n- Partnership Agreements with a block editor\n- Billing Management with revenue share\n- Ticket Management with SLA tracking\n- Knowledge Base" },
    { title: "Tenant Onboarding Checklist (Draft)", category: "platform", status: "Draft", summary: "Internal draft checklist for tenant onboarding.", keywords: ["onboarding", "checklist", "internal"], views: 0, helpful: 0, notHelpful: 0, content: "# Onboarding Checklist (Draft)\n- Create tenant\n- Create primary site\n- Create administrator\n- Confirm activation\n\n> Draft — pending review before publishing." },
  ];
  for (let i = 0; i < KB_SPECS.length; i++) {
    const s = KB_SPECS[i];
    const code = `KB-2026-${String(i + 1).padStart(4, "0")}`;
    const [article] = await KbArticle.findOrCreate({
      where: { code },
      defaults: {
        code, title: s.title, category: s.category, status: s.status, author: "AXIA Support",
        summary: s.summary, content: s.content, keywords: s.keywords, featured: s.featured ?? false,
        views: s.views, uniqueViews: Math.round(s.views * 0.72), helpful: s.helpful, notHelpful: s.notHelpful,
        publishedAt: s.status === "Published" ? new Date() : null,
      },
    });
    // Idempotent backfill so a re-seed aligns each code to the exact mockup article.
    article.title = s.title; article.category = s.category; article.status = s.status;
    article.summary = s.summary; article.content = s.content; article.keywords = s.keywords;
    article.featured = s.featured ?? false;
    if (s.status === "Published" && !article.publishedAt) article.publishedAt = new Date();
    await article.save();
  }

  // 12. Support tickets across personas — the exact AXIA mockup roster (8). Hour-
  //     precise timestamps so the ticket SLA (first-response / resolution) derives.
  const tHr = (d: number, h: number) => new Date(2026, 5, d, h, 0, 0).toISOString();
  const abcMfg = tenantsByCode.get("TEN-1005")!;            // ABC Manufacturing
  const abcConsulting = partnersByCode.get("PRT-1005")!;    // ABC Consulting (partner)
  interface TicketSpec {
    subject: string; description: string; category: string; priority: string; status: string;
    scope: "sp" | "partner" | "tenant"; orgId: string; orgName: string; managedBy: string | null;
    by: { name: string; email: string }; assignedTo: string | null;
    messages: { author: { name: string; kind: "user" | "support" }; text: string; ts: string }[];
    activity: { event: string; ts: string }[];
  }
  const TICKET_SPECS: TicketSpec[] = [
    { subject: "Cannot Activate Tenant Administrator", description: "The activation link for our administrator account returns an error when clicked. Please advise.", category: "Technical Support", priority: "High", status: "In Progress", scope: "tenant", orgId: abcMfg.id, orgName: abcMfg.name, managedBy: "ABC Consulting", by: { name: "Maria Santos", email: "maria@abcmfg.co" }, assignedTo: "Raka Pratama", messages: [{ author: { name: "Maria Santos", kind: "user" }, text: "Hi, our admin can't activate — the link errors out. Screenshot attached.", ts: tHr(2, 9) }, { author: { name: "Raka Pratama", kind: "support" }, text: "Thanks Maria, we're looking into it. Could you confirm the email address the link was sent to?", ts: tHr(2, 14) }, { author: { name: "Maria Santos", kind: "user" }, text: "It was sent to maria@abcmfg.co.", ts: tHr(2, 16) }], activity: [{ event: "Ticket created", ts: tHr(2, 9) }, { event: "Assigned to Raka Pratama", ts: tHr(2, 12) }, { event: "Status changed to In Progress", ts: tHr(2, 12) }] },
    { subject: "Invoice Status Incorrect", description: "INV-2026-0019 shows as unpaid but we have completed the bank transfer.", category: "Billing", priority: "Medium", status: "Waiting for Customer", scope: "tenant", orgId: abcMfg.id, orgName: abcMfg.name, managedBy: "ABC Consulting", by: { name: "Maria Santos", email: "maria@abcmfg.co" }, assignedTo: "Dewi Lestari", messages: [{ author: { name: "Maria Santos", kind: "user" }, text: "Our May invoice still shows unpaid after payment.", ts: tHr(5, 10) }, { author: { name: "Dewi Lestari", kind: "support" }, text: "Could you share the transfer reference number so we can match it?", ts: tHr(5, 18) }], activity: [{ event: "Ticket created", ts: tHr(5, 10) }, { event: "Assigned to Dewi Lestari", ts: tHr(5, 18) }, { event: "Status changed to Waiting for Customer", ts: tHr(5, 18) }] },
    { subject: "Need Assistance with Partner Onboarding", description: "We would like guidance on onboarding our first batch of tenants.", category: "Commercial", priority: "Medium", status: "Open", scope: "partner", orgId: abcConsulting.id, orgName: abcConsulting.name, managedBy: null, by: { name: "Andi Wijaya", email: "andi@nusantara.cloud" }, assignedTo: null, messages: [{ author: { name: "Andi Wijaya", kind: "user" }, text: "Hello, can someone walk us through onboarding tenants under our partnership?", ts: tHr(7, 13) }], activity: [{ event: "Ticket created", ts: tHr(7, 13) }] },
    { subject: "Document Upload Error", description: "Uploading a PDF over 5MB fails silently.", category: "Bug Report", priority: "High", status: "Resolved", scope: "tenant", orgId: abcMfg.id, orgName: abcMfg.name, managedBy: "ABC Consulting", by: { name: "Maria Santos", email: "maria@abcmfg.co" }, assignedTo: "Raka Pratama", messages: [{ author: { name: "Maria Santos", kind: "user" }, text: "Large PDF uploads fail with no message.", ts: tHr(1, 8) }, { author: { name: "Raka Pratama", kind: "support" }, text: "Fixed in the latest release — please retry and confirm.", ts: tHr(1, 20) }, { author: { name: "Maria Santos", kind: "user" }, text: "Working now, thank you!", ts: tHr(2, 9) }], activity: [{ event: "Ticket created", ts: tHr(1, 8) }, { event: "Status changed to In Progress", ts: tHr(1, 20) }, { event: "Ticket resolved", ts: tHr(2, 9) }] },
    { subject: "Feature Request: Bulk Site Import", description: "Could we import sites via CSV for large tenants?", category: "Feature Request", priority: "Low", status: "Open", scope: "partner", orgId: abcConsulting.id, orgName: abcConsulting.name, managedBy: null, by: { name: "Andi Wijaya", email: "andi@nusantara.cloud" }, assignedTo: null, messages: [{ author: { name: "Andi Wijaya", kind: "user" }, text: "A CSV bulk site import would save us a lot of time.", ts: tHr(8, 11) }], activity: [{ event: "Ticket created", ts: tHr(8, 11) }] },
    { subject: "Need Help Assigning Framework", description: "How do we map ISO 9001 to a specific site?", category: "General Inquiry", priority: "Medium", status: "Closed", scope: "tenant", orgId: abcMfg.id, orgName: abcMfg.name, managedBy: "ABC Consulting", by: { name: "Maria Santos", email: "maria@abcmfg.co" }, assignedTo: "Giandy Gumilang", messages: [{ author: { name: "Maria Santos", kind: "user" }, text: "Where do I assign a framework to our factory site?", ts: tHr(1, 9) }, { author: { name: "Giandy Gumilang", kind: "support" }, text: "Frameworks are assigned per site — this is coming soon to your workspace.", ts: tHr(1, 13) }], activity: [{ event: "Ticket created", ts: tHr(1, 9) }, { event: "Ticket resolved", ts: tHr(1, 18) }, { event: "Ticket closed", ts: tHr(2, 12) }] },
    { subject: "Critical: Tenant Cannot Sign In", description: "All users at PT Maju Bersama are locked out after the maintenance window.", category: "Technical Support", priority: "Critical", status: "In Progress", scope: "tenant", orgId: tenant.id, orgName: tenant.name, managedBy: "Nusantara Cloud", by: { name: "Rina Wijaya", email: "rina@majubersama.co.id" }, assignedTo: "Raka Pratama", messages: [{ author: { name: "Rina Wijaya", kind: "user" }, text: "Nobody can sign in since this morning. This is urgent.", ts: tHr(9, 8) }, { author: { name: "Raka Pratama", kind: "support" }, text: "Escalated and investigating now — we'll update within the hour.", ts: tHr(9, 14) }], activity: [{ event: "Ticket created", ts: tHr(9, 8) }, { event: "Assigned to Raka Pratama", ts: tHr(9, 9) }, { event: "Status changed to In Progress", ts: tHr(9, 14) }] },
    { subject: "Billing Inquiry — Revenue Share", description: "Requesting a breakdown of our Q2 revenue share statements.", category: "Billing", priority: "Medium", status: "Resolved", scope: "partner", orgId: abcConsulting.id, orgName: abcConsulting.name, managedBy: null, by: { name: "Andi Wijaya", email: "andi@nusantara.cloud" }, assignedTo: "Dewi Lestari", messages: [{ author: { name: "Andi Wijaya", kind: "user" }, text: "Can we get a breakdown of our revenue share for Q2?", ts: tHr(4, 10) }, { author: { name: "Dewi Lestari", kind: "support" }, text: "Statement summary attached — let us know if you need more detail.", ts: tHr(4, 15) }], activity: [{ event: "Ticket created", ts: tHr(4, 10) }, { event: "Ticket resolved", ts: tHr(6, 15) }] },
  ];
  for (let i = 0; i < TICKET_SPECS.length; i++) {
    const s = TICKET_SPECS[i];
    const code = `TKT-2026-${String(i + 1).padStart(4, "0")}`;
    const [tk] = await Ticket.findOrCreate({
      where: { code },
      defaults: {
        code, subject: s.subject, description: s.description, category: s.category, priority: s.priority as never,
        status: s.status as never, scope: s.scope, orgId: s.orgId, orgName: s.orgName, managedBy: s.managedBy,
        createdBy: s.by, assignedTo: s.assignedTo, messages: s.messages, activity: s.activity, attachments: [],
      },
    });
    // Idempotent backfill so a re-seed aligns each code to the exact mockup ticket.
    tk.subject = s.subject; tk.description = s.description; tk.category = s.category;
    tk.priority = s.priority as never; tk.status = s.status as never; tk.scope = s.scope;
    tk.orgId = s.orgId; tk.orgName = s.orgName; tk.managedBy = s.managedBy;
    tk.createdBy = s.by; tk.assignedTo = s.assignedTo; tk.messages = s.messages; tk.activity = s.activity;
    await tk.save();
  }

  // 13. In-app notifications (bell). SO-scoped (orgId null) + per-org examples.
  //     Cleared first so the bell matches the mockup exactly after a re-seed.
  await Notification.destroy({ where: {}, truncate: true });
  const nIso = (d: number) => new Date(2026, 5, d, 12, 0, 0).toISOString();
  const NOTIF_SPECS: { orgId: string | null; text: string; read: boolean; at: string }[] = [
    { orgId: null, text: "Critical ticket TKT-2026-0007 needs attention", read: false, at: nIso(9) },
    { orgId: abcConsulting.id, text: "New ticket: Need Assistance with Partner Onboarding", read: false, at: nIso(7) },
    { orgId: abcConsulting.id, text: "Reply on TKT-2026-0008 — Billing Inquiry", read: true, at: nIso(6) },
    { orgId: abcMfg.id, text: "Ticket TKT-2026-0004 was resolved", read: true, at: nIso(4) },
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

  // 16. Partnership Agreement templates (the 4 mockup templates). All four share
  //     the same default block document, mirroring the mockup's seedAgreementTemplates.
  let agBlkN = 0;
  const ab = (type: AgreementBlock["type"], text: string): AgreementBlock => ({ id: `blk-seed-${++agBlkN}`, type, text });
  const agreementBlocks = (): AgreementBlock[] => [
    ab("heading", "PARTNERSHIP AGREEMENT"),
    ab("paragraph", "This Partnership Agreement (\"Agreement\") is made on {{agreement_date}} between {{service_provider_name}} (\"Service Provider\") and {{partner_name}} (\"Partner\", {{partner_code}})."),
    ab("heading", "1. Parties"),
    ab("paragraph", "Service Provider: {{service_provider_name}}, of {{service_provider_address}}."),
    ab("paragraph", "Partner: {{partner_name}}, of {{partner_address}}, {{partner_country}}."),
    ab("heading", "2. Appointment as Partner"),
    ab("paragraph", "The Service Provider appoints the Partner as a non-exclusive partner for the Term, effective {{effective_date}}."),
    ab("heading", "3. Partner Rights and Responsibilities"),
    ab("clause", "The Partner shall market and sell subscriptions to the Platform in good faith."),
    ab("clause", "The Partner shall provide first-line support to its Tenants."),
    ab("heading", "4. Commercial Terms"),
    ab("paragraph", "All commercial terms are denominated in {{currency}} unless otherwise stated."),
    ab("heading", "5. Revenue Share"),
    ab("paragraph", "The Partner shall be entitled to a revenue share of {{revenue_share_percentage}}% on net subscription revenue, with a partner discount of {{partner_discount_percentage}}%."),
    ab("heading", "6. Payment Terms"),
    ab("paragraph", "Payments are due within {{payment_due_days}} days of invoice."),
    ab("heading", "7. Term and Termination"),
    ab("paragraph", "This Agreement runs for {{agreement_duration_months}} months from the effective date and expires on {{expiration_date}}, unless terminated earlier on {{termination_notice_days}} days written notice."),
    ab("heading", "8. Governing Law"),
    ab("paragraph", "This Agreement is governed by {{governing_law}}, with jurisdiction in {{jurisdiction}}."),
    ab("heading", "9. Signatures"),
    ab("signature", "Signed for and on behalf of the parties."),
  ];
  interface AgtSpec { code: string; name: string; description: string; version: string; status: "Draft" | "Active" | "Archived"; }
  const AGT_SPECS: AgtSpec[] = [
    { code: "AGT-1001", name: "Standard Reseller Agreement", description: "Default agreement for standard reseller partners.", version: "v2.1", status: "Active" },
    { code: "AGT-1002", name: "Distributor Agreement", description: "Agreement for regional distributors with volume commitments.", version: "v1.4", status: "Active" },
    { code: "AGT-1003", name: "Principal Partner Agreement", description: "Agreement for principal partners — in preparation.", version: "v1.0", status: "Draft" },
    { code: "AGT-1004", name: "Reseller Agreement (Legacy)", description: "Superseded 2025 reseller terms, retained for history.", version: "v1.0", status: "Archived" },
  ];
  for (const a of AGT_SPECS) {
    await AgreementTemplate.findOrCreate({
      where: { code: a.code },
      defaults: { code: a.code, name: a.name, description: a.description, version: a.version, status: a.status, blocks: agreementBlocks() },
    });
  }

  // 17. Tenant Requests (registration requests). The mockup's tenant requests are
  //     partner-originated; the project's RegistrationRequest requires a distributor,
  //     so the four ABC-Consulting-originated requests are seeded (proposedTenant
  //     carries the mockup org + contact fields). Idempotent via the proposed code.
  interface TreqSpec { code: string; orgName: string; industry: string; country: string; contactPerson: string; contactEmail: string; contactPhone: string; status: "PendingApproval" | "Approved" | "Rejected"; decisionReason: string | null; }
  const TREQ_SPECS: TreqSpec[] = [
    { code: "TRQ-1001", orgName: "Nusantara Foods", industry: "Food & Beverage", country: "ID", contactPerson: "Agus Salim", contactEmail: "agus@nusantarafoods.co.id", contactPhone: "+62 21 5551 1000", status: "PendingApproval", decisionReason: null },
    { code: "TRQ-1002", orgName: "Bali Resort Group", industry: "Hospitality", country: "ID", contactPerson: "Wayan Sukarta", contactEmail: "wayan@baliresort.com", contactPhone: "+62 361 5552 000", status: "PendingApproval", decisionReason: null },
    { code: "TRQ-1003", orgName: "ABC Manufacturing", industry: "Manufacturing", country: "ID", contactPerson: "Maria Santos", contactEmail: "maria@abcmfg.co", contactPhone: "+62 21 5550 5000", status: "Approved", decisionReason: "Provisioned as TEN-1005" },
    { code: "TRQ-1005", orgName: "Trans Logistik Cepat", industry: "Logistics", country: "ID", contactPerson: "Eko Prasetyo", contactEmail: "eko@translogistik.co.id", contactPhone: "+62 31 5554 300", status: "Rejected", decisionReason: "Duplicate of existing tenant" },
  ];
  const existingRegs = await RegistrationRequest.findAll({ where: { distributorOrgId: abcConsulting.id } });
  for (const r of TREQ_SPECS) {
    const proposed = {
      code: r.code, name: r.orgName, email: r.contactEmail, country: r.country,
      industry: r.industry, contactPhone: r.contactPhone,
      adminFullName: r.contactPerson, adminUsername: r.contactEmail.split("@")[0], adminEmail: r.contactEmail,
    };
    const existing = existingRegs.find((x) => (x.proposedTenant as { code?: string }).code === r.code);
    if (existing) {
      existing.proposedTenant = proposed; existing.status = r.status; existing.decisionReason = r.decisionReason;
      await existing.save();
    } else {
      await RegistrationRequest.create({ distributorOrgId: abcConsulting.id, proposedTenant: proposed, status: r.status, decisionReason: r.decisionReason });
    }
  }

  // 18. Site Requests — the mockup's controlled site additions/changes/closures.
  //     Change/Closure target a tenant's primary site (project seeds one site/tenant).
  const abcPrimary = await Site.findOne({ where: { orgId: abcMfg.id, isPrimary: true } });
  interface SreqSpec { code: string; orgId: string; type: SiteRequestType; siteId: string | null; requestedBy: string; proposed: SiteRequestProposed; reason: string; status: SiteRequestStatus; }
  const SREQ_SPECS: SreqSpec[] = [
    { code: "SRQ-1001", orgId: abcMfg.id, type: "Site Addition", siteId: null, requestedBy: "Tenant", proposed: { name: "Bandung Distribution Center", siteType: "Warehouse", country: "ID", address: "Jl. Soekarno Hatta 210, Bandung" }, reason: "New regional distribution hub to serve West Java.", status: "Submitted" },
    { code: "SRQ-1002", orgId: abcMfg.id, type: "Site Change", siteId: abcPrimary?.id ?? null, requestedBy: "Tenant", proposed: { name: "Factory A", address: "Kawasan Industri MM2100 Blok C-5, Bekasi" }, reason: "Corrected building/block in registered address after relocation within the estate.", status: "Under Review" },
    { code: "SRQ-1003", orgId: abcMfg.id, type: "Site Closure", siteId: abcPrimary?.id ?? null, requestedBy: "Partner", proposed: {}, reason: "Warehouse lease ending; consolidating into the new Bandung DC.", status: "Draft" },
    { code: "SRQ-1004", orgId: tenant.id, type: "Site Addition", siteId: null, requestedBy: "Partner", proposed: { name: "Bandung Sales Office", siteType: "Branch Office", country: "ID", address: "Jl. Asia Afrika 50, Bandung" }, reason: "Expansion of sales coverage.", status: "Approved" },
  ];
  for (const s of SREQ_SPECS) {
    await SiteRequest.findOrCreate({
      where: { code: s.code },
      defaults: { code: s.code, orgId: s.orgId, type: s.type, siteId: s.siteId, requestedBy: s.requestedBy, proposed: s.proposed, reason: s.reason, status: s.status, provisioned: false, provisionedSiteId: null },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    [
      "Seed complete.",
      "  Orgs: AXIA (ServiceOwner) · 5 partners (Nusantara Cloud, SecureEdge, Andes Compliance, Rhein Governance, ABC Consulting) · 5 tenants (PT Maju Bersama, Sentosa Logistics, Andalan Pharma, Global Tekstil, ABC Manufacturing)",
      "  Roles per org: Super Admin (SO only, bypass) + Administrator (full CRUD) + specialists (read-only)",
      "  Library data: 6 frameworks · 7 elements · 18 KB articles · 8 tickets · 4 agreement templates · 4 tenant requests · 4 site requests",
      `  Demo sign-in (password ${DEFAULT_PASSWORD}): Service Provider → superadmin (admin@axia.io) · Partner → andi.admin (andi@nusantara.cloud) · Tenant → maria.admin (maria@abcmfg.co)`,
      `  SP team (password ${DEFAULT_PASSWORD}): superadmin / billing.lead / support.lead / sara.admin / budi.support / maya.billing`,
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
