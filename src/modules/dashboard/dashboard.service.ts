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

export interface MemberStats {
  role: "Member";
  activeTasks: number;
  pendingReviews: number;
  completed: number;
  teamMembers: number;
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
  | TenantAdministratorStats
  | MemberStats;

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

export async function getDashboardStats(auth: AuthContext): Promise<DashboardStats> {
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

  // Tenant → Administrators get the OD tn-dashboard payload; everyone else the Member view.
  if (await isTenantAdministrator(auth)) return getTenantAdministratorStats(auth);
  const teamMembers = await User.count({ where: { orgId: auth.orgId } });
  return { role: "Member", activeTasks: 0, pendingReviews: 0, completed: 0, teamMembers };
}

/**
 * Mirrors the FE's landing-route rule (navConfig getDashboardHref): any granted
 * role whose name matches /administrator/i lands on the admin dashboard, so the
 * same test decides which payload that page receives.
 */
async function isTenantAdministrator(auth: AuthContext): Promise<boolean> {
  const user = await User.findByPk(auth.userId, {
    attributes: ["id"],
    include: [{ model: Role, through: { attributes: [] }, attributes: ["name"], required: false }],
  });
  const roles = (user as unknown as { Roles?: { name: string }[] } | null)?.Roles ?? [];
  return roles.some((r) => /administrator/i.test(r.name));
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
