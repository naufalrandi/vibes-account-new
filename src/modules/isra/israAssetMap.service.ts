import { Op } from "sequelize";
import {
  IsraAssetMap,
  IsraAssetMapUsage,
  IsraAssetMapSecondary,
  IsraAssetMapThreat,
  IsraAssetMapVuln,
  IsraPrimaryAssetLibrary,
  IsraSecondaryAssetLibrary,
  IsraThreatLibrary,
  IsraVulnLibrary,
  IsraSaSubgroup,
  IsraKmSaThreat,
  IsraKmThreatVuln,
} from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, NotFoundError, ConflictError } from "../../lib/errors";

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : v === "" ? "" : v == null ? null : String(v);

export async function getAssetMapTree(auth: AuthContext) {
  const maps = await IsraAssetMap.findAll({
    where: { orgId: auth.orgId },
    order: [["createdAt", "ASC"]],
  });

  const mapIds = maps.map((m) => m.id);
  const usages = mapIds.length
    ? await IsraAssetMapUsage.findAll({
        where: { assetMapId: { [Op.in]: mapIds } },
        order: [["createdAt", "ASC"]],
      })
    : [];

  const usageIds = usages.map((u) => u.id);
  const secondaries = usageIds.length
    ? await IsraAssetMapSecondary.findAll({
        where: { usageId: { [Op.in]: usageIds } },
        order: [["createdAt", "ASC"]],
      })
    : [];

  const secondaryIds = secondaries.map((s) => s.id);
  const threats = secondaryIds.length
    ? await IsraAssetMapThreat.findAll({
        where: { secondaryId: { [Op.in]: secondaryIds } },
        order: [["createdAt", "ASC"]],
      })
    : [];

  const threatIds = threats.map((t) => t.id);
  const vulns = threatIds.length
    ? await IsraAssetMapVuln.findAll({
        where: { threatRowId: { [Op.in]: threatIds } },
        order: [["createdAt", "ASC"]],
      })
    : [];

  // Group into nested structure
  const vulnsByThreat = new Map<string, any[]>();
  for (const v of vulns) {
    const arr = vulnsByThreat.get(v.threatRowId) || [];
    arr.push(v.get({ plain: true }));
    vulnsByThreat.set(v.threatRowId, arr);
  }

  const threatsBySecondary = new Map<string, any[]>();
  for (const t of threats) {
    const plain = t.get({ plain: true }) as any;
    plain.vulns = vulnsByThreat.get(t.id) || [];
    const arr = threatsBySecondary.get(t.secondaryId) || [];
    arr.push(plain);
    threatsBySecondary.set(t.secondaryId, arr);
  }

  const secondariesByUsage = new Map<string, any[]>();
  for (const s of secondaries) {
    const plain = s.get({ plain: true }) as any;
    plain.threats = threatsBySecondary.get(s.id) || [];
    const arr = secondariesByUsage.get(s.usageId) || [];
    arr.push(plain);
    secondariesByUsage.set(s.usageId, arr);
  }

  const usagesByMap = new Map<string, any[]>();
  for (const u of usages) {
    const plain = u.get({ plain: true }) as any;
    plain.secondaries = secondariesByUsage.get(u.id) || [];
    const arr = usagesByMap.get(u.assetMapId) || [];
    arr.push(plain);
    usagesByMap.set(u.assetMapId, arr);
  }

  return maps.map((m) => {
    const plain = m.get({ plain: true }) as any;
    plain.usages = usagesByMap.get(m.id) || [];
    return plain;
  });
}

export async function createAssetMap(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const primaryAssetRef = str(input.primaryAssetRef);
  const primaryAssetSource = str(input.primaryAssetSource) || "platform";
  if (!primaryAssetRef) throw new BadRequestError("Primary asset reference is required", "PRIMARY_ASSET_REQUIRED");

  // Check duplicate root
  const existing = await IsraAssetMap.findOne({
    where: { orgId: auth.orgId, primaryAssetRef },
  });
  if (existing) {
    return existing.get({ plain: true });
  }

  const row = await IsraAssetMap.create({
    orgId: auth.orgId,
    primaryAssetRef,
    primaryAssetSource,
  });

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "isra.assetMap.created",
    entityType: "IsraAssetMap",
    entityId: row.id,
    sourceIp: ip,
    result: "Success",
  });

  return row.get({ plain: true });
}

export async function deleteAssetMap(auth: AuthContext, id: string, ip: string | null) {
  const map = await IsraAssetMap.findOne({ where: { id, orgId: auth.orgId } });
  if (!map) throw new NotFoundError("Asset map not found", "ASSET_MAP_NOT_FOUND");

  await map.destroy();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "isra.assetMap.deleted",
    entityType: "IsraAssetMap",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}

async function requireOwnedUsage(auth: AuthContext, usageId: string): Promise<IsraAssetMapUsage> {
  const usage = await IsraAssetMapUsage.findByPk(usageId);
  if (!usage) throw new NotFoundError("Usage not found", "USAGE_NOT_FOUND");
  const map = await IsraAssetMap.findOne({ where: { id: usage.assetMapId, orgId: auth.orgId } });
  if (!map) throw new NotFoundError("Asset map not found", "ASSET_MAP_NOT_FOUND");
  return usage;
}

async function requireOwnedSecondary(auth: AuthContext, secondaryId: string): Promise<IsraAssetMapSecondary> {
  const sec = await IsraAssetMapSecondary.findByPk(secondaryId);
  if (!sec) throw new NotFoundError("Secondary attachment not found", "SEC_NOT_FOUND");
  await requireOwnedUsage(auth, sec.usageId);
  return sec;
}

async function requireOwnedThreatRow(auth: AuthContext, threatRowId: string): Promise<IsraAssetMapThreat> {
  const threatRow = await IsraAssetMapThreat.findByPk(threatRowId);
  if (!threatRow) throw new NotFoundError("Threat attachment not found", "THREAT_NOT_FOUND");
  await requireOwnedSecondary(auth, threatRow.secondaryId);
  return threatRow;
}

async function requireOwnedVulnRow(auth: AuthContext, vulnRowId: string): Promise<IsraAssetMapVuln> {
  const vulnRow = await IsraAssetMapVuln.findByPk(vulnRowId);
  if (!vulnRow) throw new NotFoundError("Vulnerability attachment not found", "VULN_NOT_FOUND");
  await requireOwnedThreatRow(auth, vulnRow.threatRowId);
  return vulnRow;
}

export async function addUsage(auth: AuthContext, mapId: string, processRef: string, _ip: string | null) {
  const map = await IsraAssetMap.findOne({ where: { id: mapId, orgId: auth.orgId } });
  if (!map) throw new NotFoundError("Asset map not found", "ASSET_MAP_NOT_FOUND");
  if (!processRef) throw new BadRequestError("Process reference is required", "PROCESS_REF_REQUIRED");

  const row = await IsraAssetMapUsage.create({
    assetMapId: map.id,
    processRef,
  });

  return row.get({ plain: true });
}

export async function deleteUsage(auth: AuthContext, usageId: string, _ip: string | null) {
  const usage = await requireOwnedUsage(auth, usageId);
  await usage.destroy();
}

export async function addSecondary(
  auth: AuthContext,
  usageId: string,
  input: {
    secondaryAssetRef: string;
    secondaryAssetSource?: string;
    groupId?: string | null;
    subgroupId?: string | null;
  },
  _ip: string | null
) {
  const usage = await requireOwnedUsage(auth, usageId);

  const secondaryAssetRef = str(input.secondaryAssetRef);
  if (!secondaryAssetRef) throw new BadRequestError("Secondary asset reference is required", "SEC_ASSET_REQUIRED");

  let groupId = input.groupId || null;
  let subgroupId = input.subgroupId || null;

  // If groupId/subgroupId not provided, look up from library
  if (!subgroupId) {
    const secLib = await IsraSecondaryAssetLibrary.findByPk(secondaryAssetRef);
    if (secLib) {
      groupId = secLib.groupId;
      subgroupId = secLib.subgroupId;
    }
  }

  const row = await IsraAssetMapSecondary.create({
    usageId: usage.id,
    secondaryAssetRef,
    secondaryAssetSource: input.secondaryAssetSource || "platform",
    groupId,
    subgroupId,
    baselineVer: 1,
  });

  // Check if subgroup is approved for baseline auto-load
  if (subgroupId) {
    const sub = await IsraSaSubgroup.findByPk(subgroupId);
    if (sub && sub.status === "Approved") {
      // Find baseline threats
      const kmThreats = await IsraKmSaThreat.findAll({ where: { subgroupId } });
      for (const kt of kmThreats) {
        const threatRow = await IsraAssetMapThreat.create({
          secondaryId: row.id,
          threatId: kt.threatId,
          isBaseline: true,
        });

        // Find baseline vulns for this subgroup + threat
        const kmVulns = await IsraKmThreatVuln.findAll({
          where: { subgroupId, threatId: kt.threatId },
        });
        for (const kv of kmVulns) {
          await IsraAssetMapVuln.create({
            threatRowId: threatRow.id,
            vulnId: kv.vulnId,
            isBaseline: true,
          });
        }
      }
    }
  }

  return row.get({ plain: true });
}

export async function deleteSecondary(auth: AuthContext, secId: string, _ip: string | null) {
  const sec = await requireOwnedSecondary(auth, secId);
  await sec.destroy();
}

export async function addThreat(
  auth: AuthContext,
  secondaryId: string,
  threatId: string,
  isBaseline = false,
  _ip: string | null
) {
  await requireOwnedSecondary(auth, secondaryId);

  const row = await IsraAssetMapThreat.create({
    secondaryId,
    threatId,
    isBaseline,
  });

  return row.get({ plain: true });
}

/**
 * OD `israMapRemoveThreat` refuses when the node came from the approved
 * subgroup baseline (`th.b`). An inherited node is not the org's to delete:
 * `getBaselineDiff`/refresh reconcile the map against the baseline, so a
 * hand-deleted one either reappears or silently diverges from the subgroup it
 * is supposed to track. Detaching happens by changing the subgroup, not by
 * removing rows out from under it.
 */
export async function deleteThreat(auth: AuthContext, threatRowId: string, _ip: string | null) {
  const threatRow = await requireOwnedThreatRow(auth, threatRowId);
  if (threatRow.isBaseline) {
    throw new ConflictError("Inherited baseline threat — cannot be removed", "BASELINE_NODE_LOCKED");
  }
  await threatRow.destroy();
}

export async function addVuln(
  auth: AuthContext,
  threatRowId: string,
  vulnId: string,
  isBaseline = false,
  _ip: string | null
) {
  await requireOwnedThreatRow(auth, threatRowId);

  const row = await IsraAssetMapVuln.create({
    threatRowId,
    vulnId,
    isBaseline,
  });

  return row.get({ plain: true });
}

/** OD `israMapRemoveVuln` — same rule as `deleteThreat`, for baseline vulns. */
export async function deleteVuln(auth: AuthContext, vulnRowId: string, _ip: string | null) {
  const vulnRow = await requireOwnedVulnRow(auth, vulnRowId);
  if (vulnRow.isBaseline) {
    throw new ConflictError("Inherited baseline vulnerability — cannot be removed", "BASELINE_NODE_LOCKED");
  }
  await vulnRow.destroy();
}

export async function getBaselineDiff(auth: AuthContext, secondaryId: string) {
  const sec = await requireOwnedSecondary(auth, secondaryId);
  if (!sec || !sec.subgroupId) return { canRefresh: false, additions: [], removals: [] };

  const sub = await IsraSaSubgroup.findByPk(sec.subgroupId);
  if (!sub || sub.status !== "Approved") return { canRefresh: false, additions: [], removals: [] };

  // Current attached threats
  const currentThreats = await IsraAssetMapThreat.findAll({ where: { secondaryId } });
  const currentThreatIds = new Set(currentThreats.map((t) => t.threatId));

  // Baseline threats
  const kmThreats = await IsraKmSaThreat.findAll({ where: { subgroupId: sec.subgroupId } });
  const baselineThreatIds = new Set(kmThreats.map((t) => t.threatId));

  const additions = Array.from(baselineThreatIds).filter((tid) => !currentThreatIds.has(tid));
  const removals = currentThreats.filter((t) => t.isBaseline && !baselineThreatIds.has(t.threatId)).map((t) => t.threatId);

  return {
    canRefresh: additions.length > 0 || removals.length > 0,
    additions,
    removals,
    currentVersion: sec.baselineVer,
    latestVersion: sub.version || 1,
  };
}

export async function refreshBaseline(auth: AuthContext, secondaryId: string, _ip: string | null) {
  const sec = await requireOwnedSecondary(auth, secondaryId);
  if (!sec || !sec.subgroupId) throw new BadRequestError("No subgroup for baseline refresh", "NO_SUBGROUP");

  const diff = await getBaselineDiff(auth, secondaryId);
  if (!diff.canRefresh) return { refreshed: false };

  // Apply additions
  for (const threatId of diff.additions) {
    const threatRow = await IsraAssetMapThreat.create({
      secondaryId,
      threatId,
      isBaseline: true,
    });

    const kmVulns = await IsraKmThreatVuln.findAll({
      where: { subgroupId: sec.subgroupId, threatId },
    });
    for (const kv of kmVulns) {
      await IsraAssetMapVuln.create({
        threatRowId: threatRow.id,
        vulnId: kv.vulnId,
        isBaseline: true,
      });
    }
  }

  sec.baselineVer = diff.latestVersion || 1;
  await sec.save();

  return { refreshed: true, additions: diff.additions, removals: diff.removals };
}
