import { Role, User } from "../models";
import type { PermissionMode, UserStatus } from "../models/user.model";

/**
 * OD `seedUsers()` (js/core.js) — the AXIA (Service Provider) staff roster
 * behind Team Management, the permission grid, and the business-unit access
 * grants.
 *
 * Before this seeder the backend created three generic principals
 * (`soadmin`/`admin`/`user`), which left every state the Team Management screen
 * exists to show unreachable in a seeded database: no departments, no
 * Pending Activation or Suspended rows, no unprovisioned staff (people who are
 * on the roster but hold no login), and no per-business-unit grants. Those
 * three stay as-is — they are the auth fixtures the API tests and the dev login
 * depend on — and this roster is seeded alongside them.
 *
 * One deviation from OD, forced by a unique constraint already in place:
 *
 *  - `axia1` uses `matthew.murdock@axia.io` rather than OD's `admin@axia.io`,
 *    because `admin@axia.io` is the existing `admin` auth fixture (`seed.ts`
 *    `ensureUser("admin", ...)`. OD collapses the platform owner and the demo
 *    administrator login into one row; here they are two.
 *
 * `axia2` previously deviated too (`natalia.romanova@axia.io`), on the grounds
 * that `seedCompetenceRolesAndAssignments` had already created her under that
 * address — but that seeder derives `SP_TEAM` from this very table
 * (`competenceRoles.ts`), so there was never a collision to avoid. Restored to
 * OD's `billing@axia.io` (core.js:152).
 *
 * Everything else — usernames, titles, departments, statuses, role groups,
 * permission modes, permission keys and unit grants — is OD verbatim.
 */

/** OD `ALLMOD` = `MODULES.map(m => m.key)` — the Service Provider permission grid's columns. */
export const SP_MODULES: readonly string[] = ["team", "partner", "tenant", "framework", "billing", "ticket"];

/** OD's `c(d)` helper: `new Date(2026, 4, d, 9, 0, 0)`. */
const may = (day: number): Date => new Date(2026, 4, day, 9, 0, 0);

export interface AxiaTeamMember {
  /** OD `db.users[].id`, kept so competence/assessment seeders can resolve the same person. */
  odId: string;
  username: string;
  email: string;
  fullName: string;
  /** OD `roleGroup`; "" means the person is on the roster but holds no login. */
  roleGroup: "" | "Administrator" | "Billing Manager" | "Technical Support";
  permissionMode: PermissionMode | null;
  permissions: string[];
  /** OD `title` — stored as `User.position`. */
  title: string;
  department: string;
  phone: string | null;
  status: UserStatus;
  superAdmin: boolean;
  provisioned: boolean;
  units: string[];
  createdAt: Date;
  lastLogin: Date | null;
}

export const AXIA_TEAM: readonly AxiaTeamMember[] = [
  { odId: "axia1", username: "superadmin", email: "matthew.murdock@axia.io", fullName: "Matthew Michael Murdock",
    roleGroup: "Administrator", permissionMode: "Full Access", permissions: [...SP_MODULES],
    title: "Platform Owner", department: "Executive", phone: "+62 811 1000 100",
    status: "Active", superAdmin: true, provisioned: true, units: [], createdAt: may(1), lastLogin: may(20) },
  { odId: "axia2", username: "billing.lead", email: "billing@axia.io", fullName: "Natalia Alianovna Romanova",
    roleGroup: "Billing Manager", permissionMode: null, permissions: ["billing"],
    title: "Billing Lead", department: "Finance", phone: null,
    status: "Active", superAdmin: false, provisioned: true, units: [], createdAt: may(1), lastLogin: null },
  { odId: "axia3", username: "support.lead", email: "nicholas.fury@axia.io", fullName: "Nicholas Joseph Fury",
    roleGroup: "Technical Support", permissionMode: null, permissions: ["ticket"],
    title: "Support Lead", department: "Customer Success", phone: null,
    status: "Active", superAdmin: false, provisioned: true, units: [], createdAt: may(1), lastLogin: null },
  { odId: "axia4", username: "pernille.admin", email: "carol.danvers@axia.io", fullName: "Carol Susan Jane Danvers",
    roleGroup: "Administrator", permissionMode: "Custom Access", permissions: ["team", "tenant", "framework"],
    title: "Operations Manager", department: "Operations", phone: null,
    status: "Active", superAdmin: false, provisioned: true, units: ["lims", "datana", "motoran"], createdAt: may(6), lastLogin: null },
  { odId: "axia5", username: "andres.support", email: "steven.rogers@axia.io", fullName: "Steven Grant Rogers",
    roleGroup: "Technical Support", permissionMode: null, permissions: ["ticket"],
    title: "Support Engineer", department: "Customer Success", phone: null,
    status: "PendingActivation", superAdmin: false, provisioned: true, units: [], createdAt: may(8), lastLogin: null },
  { odId: "axia6", username: "samantha.billing", email: "jean.grey@axia.io", fullName: "Jean Elaine Grey",
    roleGroup: "Billing Manager", permissionMode: null, permissions: ["billing"],
    title: "Billing Officer", department: "Finance", phone: null,
    status: "Suspended", superAdmin: false, provisioned: true, units: [], createdAt: may(9), lastLogin: null },
  { odId: "axia7", username: "wanda.maximoff", email: "wanda.maximoff@axia.io", fullName: "Wanda Marya Maximoff",
    roleGroup: "", permissionMode: null, permissions: [],
    title: "Marketing Specialist", department: "Marketing", phone: null,
    status: "Active", superAdmin: false, provisioned: false, units: [], createdAt: may(10), lastLogin: null },
  { odId: "axia8", username: "peter.parker", email: "peter.parker@axia.io", fullName: "Peter Benjamin Parker",
    roleGroup: "", permissionMode: null, permissions: [],
    title: "Sales Executive", department: "Commercial", phone: null,
    status: "Active", superAdmin: false, provisioned: false, units: [], createdAt: may(11), lastLogin: null },
  { odId: "axia9", username: "ororo.munroe", email: "ororo.munroe@axia.io", fullName: "Ororo Munroe",
    roleGroup: "", permissionMode: null, permissions: [],
    title: "People & Culture Officer", department: "Human Resources", phone: null,
    status: "Active", superAdmin: false, provisioned: false, units: [], createdAt: may(11), lastLogin: null },
  { odId: "axia10", username: "bruce.banner", email: "robert.banner@axia.io", fullName: "Robert Bruce Banner",
    roleGroup: "", permissionMode: null, permissions: [],
    title: "Finance Analyst", department: "Finance", phone: null,
    status: "Active", superAdmin: false, provisioned: false, units: [], createdAt: may(12), lastLogin: null },
  { odId: "axia11", username: "scott.summers", email: "scott.summers@axia.io", fullName: "Scott Edward Summers",
    roleGroup: "", permissionMode: null, permissions: [],
    title: "Lead Auditor", department: "Delivery", phone: null,
    status: "Active", superAdmin: false, provisioned: false, units: ["acert"], createdAt: may(12), lastLogin: null },
  { odId: "axia12", username: "bobby.drake", email: "robert.drake@axia.io", fullName: "Robert Louis Drake",
    roleGroup: "", permissionMode: null, permissions: [],
    title: "Quality Assurance Officer", department: "Quality", phone: null,
    status: "Active", superAdmin: false, provisioned: false, units: ["lims"], createdAt: may(13), lastLogin: null },
  { odId: "axia13", username: "kurt.wagner", email: "kurt.wagner@axia.io", fullName: "Kurt Wagner",
    roleGroup: "", permissionMode: null, permissions: [],
    title: "Operations Coordinator", department: "Operations", phone: null,
    status: "Active", superAdmin: false, provisioned: false, units: [], createdAt: may(13), lastLogin: null },
  { odId: "axia14", username: "anna.lebeau", email: "anna.lebeau@axia.io", fullName: "Anna Marie LeBeau",
    roleGroup: "", permissionMode: null, permissions: [],
    title: "Executive Assistant", department: "Executive", phone: null,
    status: "Active", superAdmin: false, provisioned: false, units: [], createdAt: may(14), lastLogin: null },
];

/**
 * Seeds the roster under the Service Provider org. Idempotent on `email` — the
 * natural key `ensurePerson` (competenceRoles.ts) already uses, so whichever
 * seeder runs first creates the row and this one fills in the Team Management
 * fields it could not know about.
 *
 * A member with a `roleGroup` is attached to the matching Service-Owner `Role`;
 * an unprovisioned member gets none. Nobody here is given a password: OD seeds
 * these with `password:''` and provisioning happens through the activation
 * flow, so a seeded roster must not become a set of loginable accounts.
 */
export async function seedAxiaTeam(spOrgId: string): Promise<Map<string, string>> {
  const roleByName = new Map<string, Role>();
  for (const role of await Role.findAll({ where: { orgId: spOrgId } })) roleByName.set(role.name, role);

  const idByOdId = new Map<string, string>();
  for (const m of AXIA_TEAM) {
    const [user, created] = await User.findOrCreate({
      where: { email: m.email },
      defaults: {
        orgId: spOrgId, tenantId: null, fullName: m.fullName, username: m.username, email: m.email,
        passwordHash: null, status: m.status, position: m.title, workUnit: null,
        lastLogin: m.lastLogin, activationToken: null, resetToken: null, resetExpires: null,
        permissionMode: m.permissionMode, permissions: m.permissions,
        department: m.department, provisioned: m.provisioned, units: m.units,
        phone: m.phone, createdAt: m.createdAt,
      },
    });

    // `ensurePerson` (competenceRoles.ts) may have created the row first with
    // nothing but name/email/position; `department === null` is the signature of
    // such a bare row. Fill it in so the order of the two seeders cannot change
    // what Team Management shows — but never on a row that already carries
    // roster data, or re-running the seeder would silently revert edits an
    // operator made through the UI.
    const bare = !created && user.department === null;
    if (bare) {
      user.set({
        fullName: m.fullName, username: m.username, status: m.status, position: m.title,
        phone: m.phone, permissionMode: m.permissionMode, permissions: m.permissions,
        department: m.department, provisioned: m.provisioned, units: m.units, lastLogin: m.lastLogin,
      });
      await user.save();
    }

    if (created || bare) {
      const role = m.roleGroup ? roleByName.get(m.superAdmin ? "Super Admin" : m.roleGroup) : undefined;
      await (user as unknown as { setRoles(roles: Role[]): Promise<void> }).setRoles(role ? [role] : []);
    }
    idByOdId.set(m.odId, user.id);
  }
  return idByOdId;
}
