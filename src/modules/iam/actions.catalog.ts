// Canonical action keys used by requireAction across the app.
export const ACTIONS = {
  ORG_READ: "org.read",
  ORG_CREATE: "org.create",
  ORG_UPDATE: "org.update",
  ORG_ACTIVATE: "org.activate",
  ORG_SUSPEND: "org.suspend",
  REGISTRATION_SUBMIT: "registration.submit",
  REGISTRATION_DECIDE: "registration.decide",
  USER_READ: "user.read",
  USER_CREATE: "user.create",
  USER_UPDATE: "user.update",
  USER_SUSPEND: "user.suspend",
  ROLE_ASSIGN: "role.assign",
  ROLE_READ: "role.read",
  ROLE_CREATE: "role.create",
  ROLE_UPDATE: "role.update",
  ROLE_GRANT: "role.grant",
  MENU_READ: "menu.read",
  MENU_MANAGE: "menu.manage",
  AUDIT_READ: "audit.read",
} as const;

export type ActionKey = (typeof ACTIONS)[keyof typeof ACTIONS];

export interface SeedAction {
  key: string;
  name: string;
}
export interface SeedMenu {
  name: string;
  heading?: string;
  route?: string;
  routeSeo?: string;
  icon?: string;
  actions?: SeedAction[];
  children?: SeedMenu[];
}

/** The default navigable menu tree + the actions available under each menu. */
export const MENU_SEED: SeedMenu[] = [
  { name: "Dashboard", route: "/dashboard", routeSeo: "dashboard", icon: "grid" },
  {
    name: "User Management",
    heading: "User Management",
    icon: "users",
    children: [
      {
        name: "Organizations",
        route: "/organizations",
        routeSeo: "organizations",
        icon: "building",
        actions: [
          { key: ACTIONS.ORG_READ, name: "View organizations" },
          { key: ACTIONS.ORG_CREATE, name: "Create organization" },
          { key: ACTIONS.ORG_UPDATE, name: "Edit organization" },
          { key: ACTIONS.ORG_ACTIVATE, name: "Activate organization" },
          { key: ACTIONS.ORG_SUSPEND, name: "Suspend organization" },
          { key: ACTIONS.REGISTRATION_SUBMIT, name: "Submit tenant registration" },
          { key: ACTIONS.REGISTRATION_DECIDE, name: "Approve/reject registration" },
        ],
      },
      {
        name: "Users",
        route: "/users",
        routeSeo: "users",
        icon: "user",
        actions: [
          { key: ACTIONS.USER_READ, name: "View users" },
          { key: ACTIONS.USER_CREATE, name: "Create user" },
          { key: ACTIONS.USER_UPDATE, name: "Edit user" },
          { key: ACTIONS.USER_SUSPEND, name: "Suspend/deactivate user" },
          { key: ACTIONS.ROLE_ASSIGN, name: "Assign/remove role" },
        ],
      },
      {
        name: "Roles & Access",
        route: "/roles",
        routeSeo: "roles",
        icon: "shield",
        actions: [
          { key: ACTIONS.ROLE_READ, name: "View roles" },
          { key: ACTIONS.ROLE_CREATE, name: "Create role" },
          { key: ACTIONS.ROLE_UPDATE, name: "Edit role" },
          { key: ACTIONS.ROLE_GRANT, name: "Edit role grants" },
        ],
      },
      {
        name: "Menus",
        route: "/menus",
        routeSeo: "menus",
        icon: "list",
        actions: [
          { key: ACTIONS.MENU_READ, name: "View menus" },
          { key: ACTIONS.MENU_MANAGE, name: "Manage menus/actions" },
        ],
      },
      {
        name: "Audit Log",
        route: "/audit",
        routeSeo: "audit",
        icon: "history",
        actions: [{ key: ACTIONS.AUDIT_READ, name: "View audit log" }],
      },
    ],
  },
];
