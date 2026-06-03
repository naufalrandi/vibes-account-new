import { Organization, User, Role, Subscription } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { organizationScopeWhere } from "../../lib/scope";

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

export type DashboardStats = ServiceOwnerStats | AdministratorStats | MemberStats;

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

  // Tenant → Member view
  const teamMembers = await User.count({ where: { orgId: auth.orgId } });
  return { role: "Member", activeTasks: 0, pendingReviews: 0, completed: 0, teamMembers };
}

export async function getDashboardRecent(auth: AuthContext): Promise<DashboardRecent> {
  const orgWhere = organizationScopeWhere(auth);
  const userWhere = auth.orgType === "ServiceOwner" ? {} : { orgId: auth.orgId };

  const [rawOrgs, rawUsers] = await Promise.all([
    Organization.findAll({
      where: orgWhere,
      order: [["createdAt", "DESC"]],
      limit: 5,
      attributes: ["id", "name", "code", "status"],
    }),
    User.findAll({
      where: userWhere,
      include: [{ model: Role, through: { attributes: [] }, attributes: ["name"] }],
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
