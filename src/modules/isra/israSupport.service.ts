import { Op } from "sequelize";
import {
  IsraOrgSettings,
  ISRA_REVIEW_PERIOD_DEFAULT,
  israRiskScheme,
  IsraAppetiteLog,
  IsraScenario,
  IsraExistingControl,
  IsraExistingControlAnnexRef,
} from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";

export async function getOrgSettings(auth: AuthContext) {
  let settings = await IsraOrgSettings.findOne({ where: { orgId: auth.orgId } });
  if (!settings) {
    settings = await IsraOrgSettings.create({
      orgId: auth.orgId,
      matrix: { type: "5x5" },
      conseqMethod: "12-area-weighted",
      requireAccept: true,
      requireHigher: true,
      autoRec: true,
      overrideAllowed: true,
      residualEnabled: true,
      reviewFreq: "Annual",
      reviewPeriodWithinMonths: ISRA_REVIEW_PERIOD_DEFAULT.within,
      reviewPeriodAboveMonths: ISRA_REVIEW_PERIOD_DEFAULT.above,
      ciaSeverityMap: { low: 2, medium: 3, high: 4, critical: 5 },
      conseqCiaRelation: {},
      // R289 — null keeps OD's five-band fallback until the tenant sets its own.
      riskLevels: null,
    });
  }
  return settings.get({ plain: true });
}

export async function saveOrgSettings(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  let settings = await IsraOrgSettings.findOne({ where: { orgId: auth.orgId } });
  const matrix =
    typeof input.matrix === "object" && input.matrix !== null
      ? (input.matrix as Record<string, unknown>)
      : { type: String(input.matrix || "5x5") };

  if (!settings) {
    settings = await IsraOrgSettings.create({
      orgId: auth.orgId,
      matrix,
      conseqMethod: (input.conseqMethod as string) || "12-area-weighted",
      requireAccept: input.requireAccept !== undefined ? Boolean(input.requireAccept) : true,
      requireHigher: input.requireHigher !== undefined ? Boolean(input.requireHigher) : true,
      autoRec: input.autoRec !== undefined ? Boolean(input.autoRec) : true,
      overrideAllowed: input.overrideAllowed !== undefined ? Boolean(input.overrideAllowed) : true,
      residualEnabled: input.residualEnabled !== undefined ? Boolean(input.residualEnabled) : true,
      reviewFreq: (input.reviewFreq as string) || "Annual",
      reviewPeriodWithinMonths: typeof input.reviewPeriodWithinMonths === "number" ? input.reviewPeriodWithinMonths : ISRA_REVIEW_PERIOD_DEFAULT.within,
      reviewPeriodAboveMonths: typeof input.reviewPeriodAboveMonths === "number" ? input.reviewPeriodAboveMonths : ISRA_REVIEW_PERIOD_DEFAULT.above,
      ciaSeverityMap: (input.ciaSeverityMap as any) || { low: 2, medium: 3, high: 4, critical: 5 },
      conseqCiaRelation: (input.conseqCiaRelation as any) || {},
      riskLevels: input.riskLevels !== undefined ? israRiskScheme(input.riskLevels as string[]) : null,
    });
  } else {
    if (input.matrix !== undefined) settings.matrix = matrix;
    if (input.conseqMethod !== undefined) settings.conseqMethod = input.conseqMethod as string;
    if (input.requireAccept !== undefined) settings.requireAccept = Boolean(input.requireAccept);
    if (input.requireHigher !== undefined) settings.requireHigher = Boolean(input.requireHigher);
    if (input.autoRec !== undefined) settings.autoRec = Boolean(input.autoRec);
    if (input.overrideAllowed !== undefined) settings.overrideAllowed = Boolean(input.overrideAllowed);
    if (input.residualEnabled !== undefined) settings.residualEnabled = Boolean(input.residualEnabled);
    if (input.reviewFreq !== undefined) settings.reviewFreq = input.reviewFreq as string;
    if (input.reviewPeriodWithinMonths !== undefined) settings.reviewPeriodWithinMonths = Number(input.reviewPeriodWithinMonths);
    if (input.reviewPeriodAboveMonths !== undefined) settings.reviewPeriodAboveMonths = Number(input.reviewPeriodAboveMonths);
    if (input.ciaSeverityMap !== undefined) settings.ciaSeverityMap = input.ciaSeverityMap as any;
    if (input.conseqCiaRelation !== undefined) settings.conseqCiaRelation = input.conseqCiaRelation as any;
    // R289 / OD `israRlSetCount` — the scheme is normalised (2..6 names, each
    // falling back to its default) before it is stored.
    if (input.riskLevels !== undefined) {
      settings.riskLevels = input.riskLevels === null ? null : israRiskScheme(input.riskLevels as string[]);
    }
    await settings.save();
  }

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "isra.settings.updated",
    entityType: "IsraOrgSettings",
    entityId: settings.orgId,
    sourceIp: ip,
    result: "Success",
  });

  return settings.get({ plain: true });
}

export async function getAppetiteLog(auth: AuthContext) {
  const logs = await IsraAppetiteLog.findAll({
    where: { orgId: auth.orgId },
    order: [["version", "DESC"]],
  });
  return logs.map((l) => l.get({ plain: true }));
}

export async function logAppetite(auth: AuthContext, input: Record<string, unknown>, _ip: string | null) {
  const count = await IsraAppetiteLog.count({ where: { orgId: auth.orgId } });
  const row = await IsraAppetiteLog.create({
    orgId: auth.orgId,
    version: count + 1,
    threshold: typeof input.threshold === "number" ? input.threshold : 9,
    effectiveDate: (input.effectiveDate as string) || new Date().toISOString().slice(0, 10),
    // isra2AppetiteForm (core.js:15763) — Effective date / Approved by /
    // Approval date / Change rationale are all form-entered on every
    // threshold change; fall back to the acting user/today only when the
    // caller didn't supply them (e.g. older clients).
    approvedBy: (input.approvedBy as string) || auth.userId,
    approvalDate: (input.approvalDate as string) || new Date().toISOString().slice(0, 10),
    rationale: (input.rationale as string) || "Updated risk appetite threshold",
  });

  return row.get({ plain: true });
}

export async function validateIntegrity(auth: AuthContext) {
  const scenarios = await IsraScenario.findAll({ where: { orgId: auth.orgId } });
  const controls = await IsraExistingControl.findAll({ where: { orgId: auth.orgId } });

  let missingJustifications = 0;
  for (const s of scenarios) {
    if (s.impactOverride && !s.impactOverride.justification) {
      missingJustifications++;
    }
  }

  const controlIds = controls.map((c) => c.id);
  const annexRefs = controlIds.length
    ? await IsraExistingControlAnnexRef.findAll({
        where: { existingControlId: { [Op.in]: controlIds } },
      })
    : [];

  const controlsWithRefs = new Set(annexRefs.map((r) => r.existingControlId));
  const controlsWithoutAnnexRefs = controls.filter((c) => !controlsWithRefs.has(c.id)).length;

  return {
    valid: missingJustifications === 0,
    totalScenarios: scenarios.length,
    totalControls: controls.length,
    legacyScenarios: 0,
    missingJustifications,
    controlsWithoutAnnexRefs,
    checkedAt: new Date().toISOString(),
  };
}
