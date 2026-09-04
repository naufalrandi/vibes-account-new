import {
  AuditLog,
  Framework,
  FrameworkAssignment,
  Organization,
  Role,
  Site,
  Subscription,
  User,
} from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { organizationScopeWhere, userScopeWhere } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { ForbiddenError, NotFoundError } from "../../lib/errors";

export interface ServiceOwnerStats {
  role: "ServiceOwner";
  totalOrgs: number;
  activeOrgs: number;
  totalUsers: number;
  activeUsers: number;
  adminUsers: number;
}

export interface AdministratorStats {
  role: "Administrator";
  activeSubscriptions: number;
  totalFrameworks: number;
  totalUsers: number;
  activeUsers: number;
  profileCount: number;
}

export interface TenantDashboardSite {
  id: string;
  name: string;
  isPrimary: boolean;
  status: string;
}

export interface TenantDashboardAssignment {
  id: string;
  frameworkName: string;
  siteName: string;
  status: string;
}

export interface TenantDashboardActivity {
  id: string;
  action: string;
  entityType: string;
  at: string;
}

/**
 * OD tn-dashboard (index.html:8000–8022) payload for a Tenant Administrator:
 * the four stat counts plus the Tenant Information / Sites / Framework
 * Assignments / Recent Activity card data, all in one response so the FE
 * renders without a request waterfall. `orgType` disambiguates from the
 * Distributor payload, which shares role "Administrator".
 */
export interface TenantAdministratorStats {
  role: "Administrator";
  orgType: "Tenant";
  sites: number;
  frameworkAssignments: number;
  activeFrameworks: number;
  teamMembers: number;
  tenant: {
    name: string;
    country: string | null;
    status: string;
    primarySite: string | null;
  };
  siteList: TenantDashboardSite[];
  assignments: TenantDashboardAssignment[];
  activity: TenantDashboardActivity[];
}

export type DashboardStats =
  | ServiceOwnerStats
  | AdministratorStats
  | TenantAdministratorStats;

export interface DashboardRecentOrg {
  id: string;
  name: string;
  code: string;
  status: string;
}

export interface DashboardRecentUser {
  id: string;
  fullName: string;
  email: string;
  status: string;
  role: string;
}

export interface DashboardRecent {
  orgs: DashboardRecentOrg[];
  users: DashboardRecentUser[];
}

const TOTAL_FRAMEWORKS = 13;

/**
 * `orgId` lets a caller ask for a specific tenant's dashboard instead of its
 * own — the AXIA Clients · SaaS preview, where a Service Owner views a tenant
 * workspace without becoming that tenant.
 *
 * Authorization is not relaxed for it: the target is checked against
 * `visibleTenantOrgIds(auth)`, the same helper the sites, management-review and
 * scope services use, so a Distributor can only reach its own child tenants and
 * a Tenant only itself. A Service Owner is unrestricted there, which is what
 * already governs every other cross-tenant read in this API.
 */
export async function getDashboardStats(auth: AuthContext, orgId?: string): Promise<DashboardStats> {
  if (orgId && orgId !== auth.orgId) {
    const visible = await visibleTenantOrgIds(auth);
    if (visible !== null && !visible.includes(orgId)) throw new ForbiddenError();
    const target = await Organization.findByPk(orgId, { attributes: ["id", "type"] });
    if (!target) throw new NotFoundError("Organization not found", "ORG_NOT_FOUND");
    if (target.type !== "Tenant") throw new ForbiddenError();
    return getTenantAdministratorStats({ ...auth, orgId, orgType: "Tenant" });
  }
  if (auth.orgType === "ServiceOwner") {
    const [totalOrgs, activeOrgs, totalUsers, activeUsers, adminUsers] = await Promise.all([
      Organization.count({}),
      Organization.count({ where: { status: "Active" } }),
      User.count({}),
      User.count({ where: { status: "Active" } }),
      User.count({
        include: [
          {
            model: Role,
            through: { attributes: [] },
            where: { isSuperAdmin: true },
            required: true,
          },
        ],
      }),
    ]);
    return { role: "ServiceOwner", totalOrgs, activeOrgs, totalUsers, activeUsers, adminUsers };
  }

  if (auth.orgType === "Distributor") {
    const [activeSubscriptions, totalUsers, activeUsers] = await Promise.all([
      Subscription.count({ where: { orgId: auth.orgId, status: "Active" } }),
      User.count({ where: { orgId: auth.orgId } }),
      User.count({ where: { orgId: auth.orgId, status: "Active" } }),
    ]);
    return {
      role: "Administrator",
      activeSubscriptions,
      totalFrameworks: TOTAL_FRAMEWORKS,
      totalUsers,
      activeUsers,
      profileCount: totalUsers,
    };
  }

  // Tenant → OD's tn-dashboard, for every tenant role. OD lands all three
  // tenant sub-personas (Top Management / MS Team / Basic User) on the same
  // first menu key (`setTenantRole`, core.js:2484) and renders one dashboard
  // for all of them. The FE's `/administrator/dashboard` branches on org type,
  // not role, for the same reason — so the role-gated "Member" payload that
  // used to feed the now-removed `/member/dashboard` (SOF-91) would only ever
  // produce an empty admin surface here.
  return getTenantAdministratorStats(auth);
}

async function getTenantAdministratorStats(auth: AuthContext): Promise<TenantAdministratorStats> {
  const [org, siteRows, assignmentRows, activeFrameworks, teamMembers, activityRows] =
    await Promise.all([
      Organization.findByPk(auth.orgId, { attributes: ["name", "country", "status"] }),
      Site.findAll({
        where: { orgId: auth.orgId },
        order: [["isPrimary", "DESC"], ["name", "ASC"]],
        attributes: ["id", "name", "status", "isPrimary"],
      }),
      FrameworkAssignment.findAll({
        where: { orgId: auth.orgId },
        include: [
          { model: Framework, attributes: ["name"], required: false },
          { model: Site, attributes: ["name"], required: false },
        ],
        order: [["createdAt", "DESC"]],
      }),
      // Distinct active frameworks across the tenant's assignments (OD counts
      // active assignments; distinct framework ids is the honest "frameworks" read).
      FrameworkAssignment.count({
        where: { orgId: auth.orgId, status: "Active" },
        distinct: true,
        col: "framework_id",
      }),
      User.count({ where: { orgId: auth.orgId } }),
      // Same scope rule as the audit module's tenant branch (audit.controller.ts).
      AuditLog.findAll({
        where: { tenantId: auth.tenantId },
        order: [["at", "DESC"]],
        limit: 8,
        attributes: ["id", "action", "entityType", "at"],
      }),
    ]);

  const assignments: TenantDashboardAssignment[] = assignmentRows.map((a) => {
    const joined = a as unknown as { Framework?: { name: string }; Site?: { name: string } };
    return {
      id: a.id,
      frameworkName: joined.Framework?.name ?? "—",
      siteName: joined.Site?.name ?? "—",
      status: a.status,
    };
  });

  return {
    role: "Administrator",
    orgType: "Tenant",
    sites: siteRows.length,
    frameworkAssignments: assignmentRows.length,
    activeFrameworks,
    teamMembers,
    tenant: {
      name: org?.name ?? "—",
      country: org?.country ?? null,
      status: org?.status ?? "Active",
      primarySite: siteRows.find((s) => s.isPrimary)?.name ?? null,
    },
    siteList: siteRows.map((s) => ({ id: s.id, name: s.name, isPrimary: s.isPrimary, status: s.status })),
    assignments,
    activity: activityRows.map((a) => ({
      id: a.id,
      action: a.action,
      entityType: a.entityType,
      at: a.at.toISOString(),
    })),
  };
}

export async function getDashboardRecent(auth: AuthContext): Promise<DashboardRecent> {
  const orgWhere = organizationScopeWhere(auth);
  const userWhere = userScopeWhere(auth);

  const [rawOrgs, rawUsers] = await Promise.all([
    Organization.findAll({
      where: orgWhere,
      order: [["createdAt", "DESC"]],
      limit: 5,
      attributes: ["id", "name", "code", "status"],
    }),
    User.findAll({
      where: userWhere,
      include: [
        ...(auth.orgType === "Distributor"
          ? [{ model: Organization, attributes: [] as string[], required: true }]
          : []),
        { model: Role, through: { attributes: [] }, attributes: ["name"], required: false },
      ],
      order: [["createdAt", "DESC"]],
      limit: 5,
      attributes: ["id", "fullName", "email", "status", "createdAt"],
    }),
  ]);

  const orgs: DashboardRecentOrg[] = rawOrgs.map((o) => ({
    id: o.id,
    name: o.name,
    code: o.code,
    status: o.status,
  }));

  const users: DashboardRecentUser[] = rawUsers.map((u) => {
    const roles = (u as unknown as { Roles?: { name: string }[] }).Roles;
    return {
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      status: u.status,
      role: roles?.[0]?.name ?? "—",
    };
  });

  return { orgs, users };
}
