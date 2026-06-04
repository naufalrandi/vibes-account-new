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
  USER_DELETE: "user.delete",
  ROLE_ASSIGN: "role.assign",
  ROLE_READ: "role.read",
  ROLE_CREATE: "role.create",
  ROLE_UPDATE: "role.update",
  ROLE_GRANT: "role.grant",
  MENU_READ: "menu.read",
  MENU_MANAGE: "menu.manage",
  AUDIT_READ: "audit.read",
  PROFILE_READ: "profile.read",
  PROFILE_CREATE: "profile.create",
  PROFILE_UPDATE: "profile.update",
  PROFILE_DELETE: "profile.delete",
  ACCOUNT_READ: "account.read",
  ACCOUNT_CREATE: "account.create",
  ACCOUNT_UPDATE: "account.update",
  ACCOUNT_DELETE: "account.delete",
  FRAMEWORK_TYPE_READ: "frameworkType.read",
  FRAMEWORK_TYPE_CREATE: "frameworkType.create",
  FRAMEWORK_TYPE_UPDATE: "frameworkType.update",
  FRAMEWORK_TYPE_DELETE: "frameworkType.delete",
  FRAMEWORK_FAMILY_READ: "frameworkFamily.read",
  FRAMEWORK_FAMILY_CREATE: "frameworkFamily.create",
  FRAMEWORK_FAMILY_UPDATE: "frameworkFamily.update",
  FRAMEWORK_FAMILY_DELETE: "frameworkFamily.delete",
  FRAMEWORK_READ: "framework.read",
  FRAMEWORK_CREATE: "framework.create",
  FRAMEWORK_UPDATE: "framework.update",
  FRAMEWORK_DELETE: "framework.delete",
  FRAMEWORK_CATALOG_READ: "frameworkCatalog.read",
  FRAMEWORK_CATALOG_SUBSCRIBE: "frameworkCatalog.subscribe",
  MY_FRAMEWORK_READ: "myFramework.read",
  MY_FRAMEWORK_DELETE: "myFramework.delete",
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
          { key: ACTIONS.USER_DELETE, name: "Remove user" },
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
      {
        name: "Profiles",
        route: "/profiles",
        routeSeo: "profiles",
        icon: "id-card",
        actions: [
          { key: ACTIONS.PROFILE_READ, name: "View profiles" },
          { key: ACTIONS.PROFILE_CREATE, name: "Create profile" },
          { key: ACTIONS.PROFILE_UPDATE, name: "Edit profile" },
          { key: ACTIONS.PROFILE_DELETE, name: "Delete profile" },
        ],
      },
      {
        name: "Accounts",
        route: "/accounts",
        routeSeo: "accounts",
        icon: "link",
        actions: [
          { key: ACTIONS.ACCOUNT_READ, name: "View accounts" },
          { key: ACTIONS.ACCOUNT_CREATE, name: "Create account" },
          { key: ACTIONS.ACCOUNT_UPDATE, name: "Edit account" },
          { key: ACTIONS.ACCOUNT_DELETE, name: "Delete account" },
        ],
      },
    ],
  },
  {
    name: "Framework Configuration",
    heading: "Framework Configuration",
    icon: "layers",
    children: [
      {
        name: "Framework Types",
        route: "/framework-types",
        routeSeo: "framework-types",
        icon: "layers",
        actions: [
          { key: ACTIONS.FRAMEWORK_TYPE_READ, name: "View framework types" },
          { key: ACTIONS.FRAMEWORK_TYPE_CREATE, name: "Create framework type" },
          { key: ACTIONS.FRAMEWORK_TYPE_UPDATE, name: "Edit framework type" },
          { key: ACTIONS.FRAMEWORK_TYPE_DELETE, name: "Delete framework type" },
        ],
      },
      {
        name: "Framework Families",
        route: "/framework-families",
        routeSeo: "framework-families",
        icon: "layers",
        actions: [
          { key: ACTIONS.FRAMEWORK_FAMILY_READ, name: "View framework families" },
          { key: ACTIONS.FRAMEWORK_FAMILY_CREATE, name: "Create framework family" },
          { key: ACTIONS.FRAMEWORK_FAMILY_UPDATE, name: "Edit framework family" },
          { key: ACTIONS.FRAMEWORK_FAMILY_DELETE, name: "Delete framework family" },
        ],
      },
      {
        name: "Frameworks",
        route: "/frameworks",
        routeSeo: "frameworks",
        icon: "layers",
        actions: [
          { key: ACTIONS.FRAMEWORK_READ, name: "View frameworks" },
          { key: ACTIONS.FRAMEWORK_CREATE, name: "Create framework" },
          { key: ACTIONS.FRAMEWORK_UPDATE, name: "Edit framework" },
          { key: ACTIONS.FRAMEWORK_DELETE, name: "Delete framework" },
        ],
      },
      {
        name: "Framework Catalog",
        route: "/framework-catalog",
        routeSeo: "framework-catalog",
        icon: "book-open",
        actions: [
          { key: ACTIONS.FRAMEWORK_CATALOG_READ, name: "Browse framework catalog" },
          { key: ACTIONS.FRAMEWORK_CATALOG_SUBSCRIBE, name: "Subscribe to framework" },
        ],
      },
      {
        name: "My Frameworks",
        route: "/my-frameworks",
        routeSeo: "my-frameworks",
        icon: "book-open",
        actions: [
          { key: ACTIONS.MY_FRAMEWORK_READ, name: "View my framework subscriptions" },
          { key: ACTIONS.MY_FRAMEWORK_DELETE, name: "Remove a framework subscription" },
        ],
      },
    ],
  },
];
