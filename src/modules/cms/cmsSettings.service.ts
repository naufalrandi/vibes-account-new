import { CmsSettings } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";

export interface SettingsInput {
  siteName?: string | null;
  domain?: string | null;
  tagline?: string | null;
  primaryColor?: string | null;
  seoTitle?: string | null;
  seoDesc?: string | null;
  analytics?: string | null;
  live?: boolean;
}

/** GET returns-or-creates the default row for the caller's own org (singleton per org). */
export async function getSettings(auth: AuthContext): Promise<CmsSettings> {
  const [row] = await CmsSettings.findOrCreate({ where: { orgId: auth.orgId }, defaults: { orgId: auth.orgId } });
  return row;
}

/** PUT upserts the singleton row. */
export async function putSettings(auth: AuthContext, input: SettingsInput, ip: string | null): Promise<CmsSettings> {
  const [row] = await CmsSettings.findOrCreate({ where: { orgId: auth.orgId }, defaults: { orgId: auth.orgId } });
  if (input.siteName !== undefined) row.siteName = input.siteName;
  if (input.domain !== undefined) row.domain = input.domain;
  if (input.tagline !== undefined) row.tagline = input.tagline;
  if (input.primaryColor !== undefined) row.primaryColor = input.primaryColor;
  if (input.seoTitle !== undefined) row.seoTitle = input.seoTitle;
  if (input.seoDesc !== undefined) row.seoDesc = input.seoDesc;
  if (input.analytics !== undefined) row.analytics = input.analytics;
  if (input.live !== undefined) row.live = input.live;
  await row.save();
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.settings.updated", entityType: "CmsSettings", entityId: row.id, sourceIp: ip, result: "Success" });
  return row;
}
