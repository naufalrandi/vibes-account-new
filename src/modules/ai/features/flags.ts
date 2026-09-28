import { AiFeatureFlag } from "../../../db/models";
import { platformOrgId } from "../../../lib/ai";

export type FlagSource = "org" | "platform" | "default";

/**
 * Per-feature on/off for `orgId`: the org's own row wins, else the Service
 * Owner org's row (the platform default), else enabled.
 */
export async function resolveFlags(orgId: string, features: string[]): Promise<Map<string, { enabled: boolean; source: FlagSource }>> {
  const platformId = await platformOrgId();
  const orgIds = platformId && platformId !== orgId ? [orgId, platformId] : [orgId];
  const rows = await AiFeatureFlag.findAll({ where: { orgId: orgIds, feature: features } });
  const out = new Map<string, { enabled: boolean; source: FlagSource }>();
  for (const feature of features) {
    const own = rows.find((r) => r.feature === feature && r.orgId === orgId);
    const platform = rows.find((r) => r.feature === feature && r.orgId === platformId);
    if (own) out.set(feature, { enabled: own.enabled, source: orgId === platformId ? "platform" : "org" });
    else if (platform) out.set(feature, { enabled: platform.enabled, source: "platform" });
    else out.set(feature, { enabled: true, source: "default" });
  }
  return out;
}

export async function isFeatureEnabled(orgId: string, feature: string): Promise<boolean> {
  return (await resolveFlags(orgId, [feature])).get(feature)!.enabled;
}
