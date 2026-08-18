import type { Transaction } from "sequelize";
import { Action, Menu, RoleActionGrant, RoleMenuGrant } from "../../db/models";
import { ACTIONS } from "./actions.catalog";

/**
 * Action keys whose service-layer implementation is unconditionally gated to
 * `orgType === "ServiceOwner"` — granting them to a Distributor/Tenant role is
 * a pure over-grant with no legitimate use (B2/P0-6: `grantEverything`
 * previously handed these to the seeded partner/tenant admins). Enumerated
 * against `actions.catalog.ts` + every route/service gate:
 *  - `kb.manage` / `ticket.manage`: explicit B2/P0-6 findings — KB authoring
 *    and ticket status/assign are now Service-Owner-only
 *    (kb.service.ts `assertServiceOwner`, ticket.service.ts `setStatus`/`assignTicket`).
 *  - `demo.*`: demo.service.ts's `assertSp` gates every exported function
 *    unconditionally, reads included.
 *  - Framework configuration (element/framework-type/framework-family/
 *    assessment, reads included): element.service.ts, frameworkType.service.ts,
 *    frameworkFamily.service.ts and (conformance-question/response)
 *    assessment.service.ts all assert ServiceOwner on every exported
 *    function; no Distributor/Tenant nav route calls any of them (FE
 *    `navConfig.ts` keeps this whole group inside the ServiceOwner case only).
 *  - `org.create` / `org.activate`: organization.service.ts unconditionally
 *    blocks direct org creation and the Active transition for non-SO actors.
 *  - `registration.decide`: registration.service.ts approve/reject are
 *    SO-only — a Distributor only ever submits (`registration.submit`, kept).
 *  - `partner.*`: partner.service.ts's `createPartner` is SO-only, and the
 *    "manage other partner orgs" screen has no OD partner-persona
 *    equivalent (FE nav confirms — Distributor never sees `/partners`);
 *    `partner.delete` has no route at all.
 *  - `agreement.*`: partnership-agreement templates are SP master data with
 *    no partner-facing path (a partner's own agreement is served through
 *    `partner.read`'s `/partners/:id/agreement`, not `agreement.read`).
 *  - `tenant.create`: tenant.service.ts's `provisionTenant` is SO-only
 *    direct creation — Distributors use `registration.submit` instead.
 *
 * `framework.read` / `requirement.read` are deliberately NOT in this list:
 * frameworks/requirements are catalog data (no orgId), `/my-frameworks` links
 * a tenant's assigned framework name to `/frameworks/:id`, and
 * framework.service.ts / requirement.service.ts now allow any authenticated
 * caller to list/get (writes stay ServiceOwner-only via `framework.create`/
 * `framework.update`/`framework.delete`/`requirement.manage`, which remain here).
 *
 * Everything else — including the demo flows' management-system, competence,
 * implementation, site-request-create/read, and ticket-create/read actions —
 * stays granted.
 *
 * Shared by the seeder (`src/db/seeders/seed.ts`) AND live BE tenant
 * provisioning (`tenant.service.ts` `provisionTenant`, `registration.service.ts`
 * `approveRegistration`) so a fresh Distributor/Tenant Administrator gets the
 * exact same curated grant set regardless of how the org was created.
 */
export const SP_ONLY_ACTIONS: readonly string[] = [
  ACTIONS.KB_MANAGE,
  ACTIONS.TICKET_MANAGE,
  ACTIONS.DEMO_READ,
  ACTIONS.DEMO_CREATE,
  ACTIONS.DEMO_MANAGE,
  ACTIONS.ELEMENT_READ,
  ACTIONS.ELEMENT_MANAGE,
  ACTIONS.FRAMEWORK_CREATE,
  ACTIONS.FRAMEWORK_UPDATE,
  ACTIONS.FRAMEWORK_DELETE,
  ACTIONS.REQUIREMENT_MANAGE,
  ACTIONS.ASSESSMENT_READ,
  ACTIONS.ASSESSMENT_MANAGE,
  ACTIONS.FRAMEWORK_TYPE_READ,
  ACTIONS.FRAMEWORK_TYPE_CREATE,
  ACTIONS.FRAMEWORK_TYPE_UPDATE,
  ACTIONS.FRAMEWORK_TYPE_DELETE,
  ACTIONS.FRAMEWORK_FAMILY_READ,
  ACTIONS.FRAMEWORK_FAMILY_CREATE,
  ACTIONS.FRAMEWORK_FAMILY_UPDATE,
  ACTIONS.FRAMEWORK_FAMILY_DELETE,
  ACTIONS.ORG_CREATE,
  ACTIONS.ORG_ACTIVATE,
  ACTIONS.REGISTRATION_DECIDE,
  ACTIONS.SITE_REQUEST_DECIDE,
  ACTIONS.PARTNER_READ,
  ACTIONS.PARTNER_CREATE,
  ACTIONS.PARTNER_UPDATE,
  ACTIONS.PARTNER_DELETE,
  ACTIONS.AGREEMENT_READ,
  ACTIONS.AGREEMENT_CREATE,
  ACTIONS.AGREEMENT_UPDATE,
  ACTIONS.AGREEMENT_DELETE,
  ACTIONS.TENANT_CREATE,
];

/**
 * Grant a role every menu + every action EXCEPT the SP-only groups above
 * (B2/P0-6 curated grant set for Distributor/Tenant admin roles, whether
 * seeded or created via live provisioning). Menus stay fully granted —
 * `requireAction` (the actual authorization boundary) only consults action
 * grants, and trimming menu visibility is a nav/IAM-admin-UI concern outside
 * this helper's scope. Accepts an optional transaction so callers inside a
 * `sequelize.transaction()` block (e.g. `provisionTenant`) stay atomic.
 */
export async function grantEverythingExceptSpOnly(roleId: string, tx?: Transaction): Promise<void> {
  const excluded = new Set<string>(SP_ONLY_ACTIONS);
  for (const menu of await Menu.findAll({ transaction: tx })) {
    await RoleMenuGrant.findOrCreate({
      where: { roleId, menuId: menu.id },
      defaults: { roleId, menuId: menu.id, granted: true },
      transaction: tx,
    });
  }
  for (const action of await Action.findAll({ transaction: tx })) {
    if (excluded.has(action.key)) continue;
    await RoleActionGrant.findOrCreate({
      where: { roleId, actionId: action.id },
      defaults: { roleId, actionId: action.id, granted: true },
      transaction: tx,
    });
  }
}
