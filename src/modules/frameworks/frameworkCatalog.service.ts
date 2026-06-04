import { Framework, FrameworkFamily, FrameworkType, OrganizationFramework } from "../../db/models";
import type { FrameworkStatus } from "../../db/models/framework.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { ConflictError, NotFoundError } from "../../lib/errors";

/** A single framework as it appears in the browse-and-subscribe catalog. */
export interface CatalogFramework {
  id: string;
  code: string;
  name: string;
  version: string | null;
  status: FrameworkStatus;
  shortDescription: string | null;
  isSubscribed: boolean;
}

export interface CatalogFamily {
  id: string;
  code: string;
  name: string;
  description: string | null;
  frameworkCount: number;
  frameworks: CatalogFramework[];
}

export interface CatalogType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  frameworkCount: number;
  families: CatalogFamily[];
}

// Eager-load the full type → family → framework tree in one query so the catalog
// is assembled in memory rather than with N+1 lookups per family.
const CATALOG_INCLUDE = {
  model: FrameworkFamily,
  separate: false,
  include: [Framework],
};

/**
 * Build the hierarchical framework catalog for the actor's organization: every
 * framework type, its families, and the frameworks under each family. Each
 * framework carries `isSubscribed` reflecting whether the actor's org already
 * holds a subscription to it.
 */
export async function getCatalog(auth: AuthContext): Promise<CatalogType[]> {
  const types = await FrameworkType.findAll({
    include: [CATALOG_INCLUDE],
    order: [
      ["sortOrder", "ASC"],
      ["name", "ASC"],
      [FrameworkFamily, "sortOrder", "ASC"],
      [FrameworkFamily, "name", "ASC"],
      [FrameworkFamily, Framework, "name", "ASC"],
    ],
  });

  // One lookup of the org's subscriptions; turned into a Set for O(1) marking.
  const subs = await OrganizationFramework.findAll({ where: { orgId: auth.orgId } });
  const subscribedIds = new Set(subs.map((s) => s.frameworkId));

  return types.map((type) => {
    const families = (type.get("FrameworkFamilies") as FrameworkFamily[] | undefined) ?? [];
    const mappedFamilies = families.map((family) => {
      const frameworks = (family.get("Frameworks") as Framework[] | undefined) ?? [];
      return {
        id: family.id,
        code: family.code,
        name: family.name,
        description: family.description,
        frameworkCount: frameworks.length,
        frameworks: frameworks.map((f) => ({
          id: f.id,
          code: f.code,
          name: f.name,
          version: f.version,
          status: f.status,
          shortDescription: f.shortDescription,
          isSubscribed: subscribedIds.has(f.id),
        })),
      };
    });
    return {
      id: type.id,
      code: type.code,
      name: type.name,
      description: type.description,
      frameworkCount: mappedFamilies.reduce((sum, fam) => sum + fam.frameworkCount, 0),
      families: mappedFamilies,
    };
  });
}

export interface SubscribeResult {
  id: string;
  orgId: string;
  frameworkId: string;
}

/**
 * Subscribe the actor's organization to a framework. Rejects a missing framework
 * (404) and a duplicate subscription (409). The (org, framework) uniqueness is
 * also enforced by a DB constraint as a backstop against races.
 */
export async function subscribe(auth: AuthContext, frameworkId: string, ip: string | null): Promise<SubscribeResult> {
  const framework = await Framework.findByPk(frameworkId);
  if (!framework) throw new NotFoundError("Framework does not exist", "FRAMEWORK_NOT_FOUND");

  const existing = await OrganizationFramework.findOne({ where: { orgId: auth.orgId, frameworkId } });
  if (existing) {
    throw new ConflictError("Organization is already subscribed to this framework", "ALREADY_SUBSCRIBED");
  }

  let record: OrganizationFramework;
  try {
    record = await OrganizationFramework.create({
      orgId: auth.orgId,
      frameworkId,
      subscribedByUserId: auth.userId,
    });
  } catch (e: unknown) {
    // Concurrent requests can pass the findOne check and collide on the unique
    // index; surface the same conflict the pre-check would have raised.
    if ((e as { name?: string })?.name === "SequelizeUniqueConstraintError") {
      throw new ConflictError("Organization is already subscribed to this framework", "ALREADY_SUBSCRIBED");
    }
    throw e;
  }

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "framework.subscribed",
    entityType: "OrganizationFramework",
    entityId: record.id,
    sourceIp: ip,
    result: "Success",
    metadata: { frameworkId },
  });

  return { id: record.id, orgId: record.orgId, frameworkId: record.frameworkId };
}
