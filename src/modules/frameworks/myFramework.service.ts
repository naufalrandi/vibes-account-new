import { Framework, FrameworkFamily, FrameworkType, OrganizationFramework } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { NotFoundError } from "../../lib/errors";

/**
 * A framework subscription as it appears on the org's "My Frameworks" page: the
 * subscription record id plus the catalog framework, its family, and its type
 * flattened into a single row. `status` reflects the subscription itself (a live
 * subscription is "Active"); the framework's own publish status is not surfaced
 * here since the page lists the org's instances, not the catalog lifecycle.
 */
export interface MyFrameworkSubscription {
  subscriptionId: string;
  frameworkId: string;
  frameworkName: string;
  frameworkCode: string;
  shortDescription: string | null;
  familyId: string;
  familyName: string;
  typeId: string;
  typeName: string;
  version: string | null;
  status: "Active";
  activatedAt: string;
}

// Eager-load framework → family → type in one query so each row is assembled in
// memory rather than with per-subscription lookups.
const SUBSCRIPTION_INCLUDE = {
  model: Framework,
  include: [{ model: FrameworkFamily, include: [FrameworkType] }],
};

/**
 * List every framework subscription for the actor's organization. The org id is
 * taken from the authenticated context, never from the request — there is no way
 * for a caller to read another organization's subscriptions.
 */
export async function listMyFrameworks(auth: AuthContext): Promise<MyFrameworkSubscription[]> {
  const subs = await OrganizationFramework.findAll({
    where: { orgId: auth.orgId },
    include: [SUBSCRIPTION_INCLUDE],
    order: [["createdAt", "DESC"]],
  });

  return subs.flatMap((sub) => {
    const framework = sub.get("Framework") as Framework | undefined;
    // A framework deletion cascades the subscription away, so a row without its
    // framework should not occur; guard defensively and skip it if it does.
    if (!framework) return [];
    const family = framework.get("FrameworkFamily") as FrameworkFamily | undefined;
    const type = family?.get("FrameworkType") as FrameworkType | undefined;
    return [
      {
        subscriptionId: sub.id,
        frameworkId: framework.id,
        frameworkName: framework.name,
        frameworkCode: framework.code ?? "",
        shortDescription: framework.shortDescription,
        familyId: family?.id ?? "",
        familyName: family?.name ?? "",
        typeId: type?.id ?? "",
        typeName: type?.name ?? "",
        version: framework.version,
        status: "Active" as const,
        activatedAt: sub.createdAt.toISOString(),
      },
    ];
  });
}

export interface RemoveResult {
  id: string;
}

/**
 * Remove a single framework subscription owned by the actor's organization. The
 * lookup is scoped to the caller's org, so a subscription that does not exist or
 * belongs to another organization both surface as a 404 — the framework catalog
 * record itself is never touched.
 */
export async function removeMyFramework(
  auth: AuthContext,
  subscriptionId: string,
  ip: string | null,
): Promise<RemoveResult> {
  const sub = await OrganizationFramework.findOne({
    where: { id: subscriptionId, orgId: auth.orgId },
  });
  if (!sub) throw new NotFoundError("Framework subscription does not exist", "SUBSCRIPTION_NOT_FOUND");

  const frameworkId = sub.frameworkId;
  await sub.destroy();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "framework.unsubscribed",
    entityType: "OrganizationFramework",
    entityId: subscriptionId,
    sourceIp: ip,
    result: "Success",
    metadata: { frameworkId },
  });

  return { id: subscriptionId };
}
