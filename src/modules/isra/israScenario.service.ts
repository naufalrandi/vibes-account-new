import { Op } from "sequelize";
import {
  IsraScenario,
  IsraScenarioVuln,
  IsraScenarioPotentialImpact,
  IsraExistingControl,
  IsraExistingControlAnnexRef,
  IsraScenarioCurrentRisk,
  IsraScenarioTreatmentDecision,
  IsraScenarioRecommendationSnapshot,
  IsraScenarioRecommendationDisposition,
  IsraScenarioAddedControl,
  IsraRtp,
  IsraRtpAction,
  IsraRtpActionControl,
  IsraScenarioActualResidual,
  IsraScenarioResidual,
  IsraScenarioCycle,
  IsraAnnexAControl,
  IsraOrgControl,
  IsraControlMaturityBaseline,
  IsraKmVulnControl,
  IsraVulnControlOverlay,
} from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : v === "" ? "" : v == null ? null : String(v);

export const ISRA_CONSEQ_WEIGHT: Record<string, number> = {
  life: 20,
  privacy: 15,
  legal: 13,
  financial: 11,
  ops: 10,
  reputation: 10,
  contracts: 5,
  parties: 5,
  skills: 3,
  deadlines: 3,
  market: 3,
  environment: 2,
};

export const ISRA_BANDS: [number, number, string][] = [
  [1, 4, "Low"],
  [5, 9, "Medium"],
  [10, 14, "High"],
  [15, 19, "Very High"],
  [20, 25, "Critical"],
];

export function getRiskBand(score: number): string {
  for (const [min, max, name] of ISRA_BANDS) {
    if (score >= min && score <= max) return name;
  }
  return score > 25 ? "Critical" : "Low";
}

// 12-area consequence calculation with dominance floor (§3.2)
export function calculateWeightedSeverity(
  potentialImpacts: { area: string; severity: number }[],
  override?: { severity: number; justification?: string } | null
): { sev: number; exposure: number; wavg: number; dominant: boolean } {
  if (override && override.justification && override.severity >= 1 && override.severity <= 5) {
    return {
      sev: override.severity,
      exposure: Math.round(((override.severity - 1) / 4) * 100),
      wavg: override.severity,
      dominant: false,
    };
  }

  const rated = potentialImpacts.filter((p) => p.severity > 0);
  if (rated.length === 0) {
    return { sev: 0, exposure: 0, wavg: 0, dominant: false };
  }

  let wsum = 0;
  let acc = 0;
  for (const p of rated) {
    const weight = ISRA_CONSEQ_WEIGHT[p.area] ?? 1;
    wsum += weight;
    acc += weight * p.severity;
  }

  const wavg = wsum > 0 ? acc / wsum : 0;
  const hasDominant = rated.some((p) => p.severity >= 4);
  const floor = hasDominant ? 4 : 0;
  const sev = Math.min(5, Math.max(1, Math.max(Math.round(wavg), floor)));
  const exposure = Math.min(100, Math.max(0, Math.round(((wavg - 1) / 4) * 100)));

  return { sev, exposure, wavg, dominant: hasDominant };
}

export async function recalculateScenarioScores(scenarioId: string, orgId: string) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId } });
  if (!scenario) return null;

  const impacts = await IsraScenarioPotentialImpact.findAll({ where: { scenarioId } });
  const impactResult = calculateWeightedSeverity(
    impacts.map((i) => ({ area: i.area, severity: i.severity })),
    scenario.impactOverride
  );

  const inherentImpact = impactResult.sev || 1;
  const inherentL = scenario.inherentL || 1;
  const inherentScore = inherentL * inherentImpact;
  const inherentBand = getRiskBand(inherentScore);

  // Load existing controls
  const controls = await IsraExistingControl.findAll({ where: { scenarioId, orgId } });
  const controlAnnexRefs = await IsraExistingControlAnnexRef.findAll({
    where: { existingControlId: { [Op.in]: controls.map((c) => c.id) } },
  });
  const refsByControl = new Map<string, string[]>();
  for (const r of controlAnnexRefs) {
    const list = refsByControl.get(r.existingControlId) || [];
    list.push(r.annexRef);
    refsByControl.set(r.existingControlId, list);
  }

  // Load Annex A controls and org baselines
  const allAnnexRefs = Array.from(new Set(controlAnnexRefs.map((r) => r.annexRef)));
  const annexRows = allAnnexRefs.length ? await IsraAnnexAControl.findAll({ where: { ref: { [Op.in]: allAnnexRefs } } }) : [];
  const orgControls = allAnnexRefs.length ? await IsraOrgControl.findAll({ where: { orgId, ref: { [Op.in]: allAnnexRefs } } }) : [];
  const baselines = allAnnexRefs.length ? await IsraControlMaturityBaseline.findAll({ where: { orgId, annexRef: { [Op.in]: allAnnexRefs } } }) : [];

  const controlProfileMap = new Map<string, { fnP: boolean; fnD: boolean; fnC: boolean; dedL: boolean; dedC: boolean }>();
  for (const a of annexRows) {
    controlProfileMap.set(a.ref, { fnP: a.fnP, fnD: a.fnD, fnC: a.fnC, dedL: a.dedL, dedC: a.dedC });
  }
  for (const o of orgControls) {
    controlProfileMap.set(o.ref, { fnP: o.fnP, fnD: o.fnD, fnC: o.fnC, dedL: o.dedL, dedC: o.dedC });
  }

  const baselineMaturityMap = new Map<string, number>();
  for (const b of baselines) {
    const avg = ((b.gov ?? 0) + (b.doc ?? 0) + (b.impl ?? 0) + (b.mon ?? 0) + (b.comp ?? 0)) / 5;
    baselineMaturityMap.set(b.annexRef, avg);
  }

  // Calculate Method C Current Risk (§3.4)
  const eligibleControls = controls.filter((c) => {
    const statusEligible = c.status === "Implemented" || c.status === "Implemented and Effective";
    const hasDesc = !!c.description && c.description.trim().length > 0;
    const refs = refsByControl.get(c.id) || [];
    return statusEligible && hasDesc && refs.length > 0;
  });

  const getPower = (c: IsraExistingControl, axis: "L" | "C") => {
    const refs = refsByControl.get(c.id) || [];
    let bestPower = 0;
    let bestCap = 0;
    let bestMat = 0;

    for (const ref of refs) {
      const prof = controlProfileMap.get(ref) || { fnP: true, fnD: false, fnC: false, dedL: true, dedC: false };
      const applies = axis === "L" ? prof.dedL : prof.dedC;
      if (!applies) continue;

      const cap = Math.min(1, (prof.fnP ? 0.6 : 0) + (prof.fnD ? 0.3 : 0) + (prof.fnC ? 0.1 : 0));

      // Maturity factor
      let matLevel = 0;
      if (c.maturityByRef && typeof c.maturityByRef[ref] === "number") {
        matLevel = c.maturityByRef[ref];
      } else if (baselineMaturityMap.has(ref)) {
        matLevel = baselineMaturityMap.get(ref)!;
      } else if (c.maturity) {
        const m = c.maturity;
        const vals = [m.gov, m.doc, m.impl, m.mon, m.comp].filter((x) => typeof x === "number") as number[];
        matLevel = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      }

      const matFactor = matLevel > 0 ? matLevel / 5 : 0;
      const power = cap * matFactor;
      if (power > bestPower) {
        bestPower = power;
        bestCap = cap;
        bestMat = matFactor;
      }
    }

    return { power: bestPower, cap: bestCap, matFactor: bestMat };
  };

  const poolAxis = (axis: "L" | "C", currentBasis: number, verifiedOnly = false) => {
    const list = verifiedOnly ? eligibleControls.filter((c) => c.verified || c.verifiedEffectiveness != null) : eligibleControls;
    const groupPowers = new Map<string, { power: number; cap: number; matFactor: number }>();
    for (const c of list) {
      const key = c.objective?.trim() || c.id;
      const p = getPower(c, axis);
      const existing = groupPowers.get(key);
      if (!existing || p.power > existing.power) {
        groupPowers.set(key, p);
      }
    }

    let pool = 0;
    let isStrong = false;
    for (const g of groupPowers.values()) {
      pool += g.power;
      if (g.cap >= 0.6 && g.matFactor >= 0.8) {
        isStrong = true;
      }
    }

    const range = Math.max(0, currentBasis - 1);
    const cap = Math.min(isStrong ? 2 : 1, range);
    const drop = Math.min(Math.round(pool), cap);
    return drop;
  };

  const dropL = poolAxis("L", inherentL);
  const dropC = poolAxis("C", inherentImpact);

  const suggestedL = Math.max(1, inherentL - dropL);
  const suggestedImpact = Math.max(1, inherentImpact - dropC);
  const suggestedScore = suggestedL * suggestedImpact;
  const suggestedBand = getRiskBand(suggestedScore);

  // Auto-adopt Current Risk
  let currentRisk = await IsraScenarioCurrentRisk.findOne({ where: { scenarioId } });
  if (!currentRisk) {
    currentRisk = await IsraScenarioCurrentRisk.create({
      scenarioId,
      method: "C-capped-quality-gated",
      methodVer: 1,
      calcAt: new Date(),
      iL: inherentL,
      iImpact: inherentImpact,
      suggestedL,
      suggestedImpact,
      suggestedScore,
      suggestedBand,
      confirmedL: suggestedL,
      confirmedImpact: suggestedImpact,
      confirmedScore: suggestedScore,
      confirmedBand: suggestedBand,
      confirmedAt: new Date(),
      confirmedBy: "System (Auto-adopt)",
      needsReview: false,
      eligibleControlIds: eligibleControls.map((c) => c.id),
    });
  } else {
    currentRisk.iL = inherentL;
    currentRisk.iImpact = inherentImpact;
    currentRisk.suggestedL = suggestedL;
    currentRisk.suggestedImpact = suggestedImpact;
    currentRisk.suggestedScore = suggestedScore;
    currentRisk.suggestedBand = suggestedBand;
    currentRisk.confirmedL = suggestedL;
    currentRisk.confirmedImpact = suggestedImpact;
    currentRisk.confirmedScore = suggestedScore;
    currentRisk.confirmedBand = suggestedBand;
    currentRisk.calcAt = new Date();
    currentRisk.eligibleControlIds = eligibleControls.map((c) => c.id);
    await currentRisk.save();
  }

  // Actual Residual calculation
  const actDropL = poolAxis("L", inherentL, true);
  const actDropC = poolAxis("C", inherentImpact, true);
  const actL = Math.max(1, inherentL - actDropL);
  const actImpact = Math.max(1, inherentImpact - actDropC);
  const actScore = actL * actImpact;
  const actBand = getRiskBand(actScore);

  let actualRes = await IsraScenarioActualResidual.findOne({ where: { scenarioId } });
  if (!actualRes) {
    actualRes = await IsraScenarioActualResidual.create({
      scenarioId,
      suggestedL: actL,
      suggestedImpact: actImpact,
      suggestedScore: actScore,
      suggestedBand: actBand,
      confirmedL: actL,
      confirmedImpact: actImpact,
      confirmedScore: actScore,
      confirmedBand: actBand,
      verifiedControlIds: eligibleControls.filter((c) => c.verified).map((c) => c.id),
      needsReview: false,
    });
  } else {
    actualRes.suggestedL = actL;
    actualRes.suggestedImpact = actImpact;
    actualRes.suggestedScore = actScore;
    actualRes.suggestedBand = actBand;
    actualRes.confirmedL = actL;
    actualRes.confirmedImpact = actImpact;
    actualRes.confirmedScore = actScore;
    actualRes.confirmedBand = actBand;
    actualRes.verifiedControlIds = eligibleControls.filter((c) => c.verified).map((c) => c.id);
    await actualRes.save();
  }

  return {
    scenario,
    inherent: { l: inherentL, impact: inherentImpact, score: inherentScore, band: inherentBand },
    current: currentRisk.get({ plain: true }),
    actual: actualRes.get({ plain: true }),
  };
}

// ============================ Scenario CRUD ================================

export async function listScenarios(auth: AuthContext) {
  const scenarios = await IsraScenario.findAll({
    where: { orgId: auth.orgId },
    order: [["createdAt", "ASC"]],
  });

  const scenarioIds = scenarios.map((s) => s.id);
  const vulns = scenarioIds.length ? await IsraScenarioVuln.findAll({ where: { scenarioId: { [Op.in]: scenarioIds } } }) : [];
  const impacts = scenarioIds.length ? await IsraScenarioPotentialImpact.findAll({ where: { scenarioId: { [Op.in]: scenarioIds } } }) : [];
  const currentRisks = scenarioIds.length ? await IsraScenarioCurrentRisk.findAll({ where: { scenarioId: { [Op.in]: scenarioIds } } }) : [];
  const treatments = scenarioIds.length ? await IsraScenarioTreatmentDecision.findAll({ where: { scenarioId: { [Op.in]: scenarioIds }, isCurrent: true } }) : [];
  const rtps = scenarioIds.length ? await IsraRtp.findAll({ where: { scenarioId: { [Op.in]: scenarioIds }, isCurrent: true } }) : [];
  const residuals = scenarioIds.length ? await IsraScenarioResidual.findAll({ where: { scenarioId: { [Op.in]: scenarioIds } } }) : [];

  const vulnsByScen = new Map<string, string[]>();
  for (const v of vulns) {
    const list = vulnsByScen.get(v.scenarioId) || [];
    list.push(v.vulnId);
    vulnsByScen.set(v.scenarioId, list);
  }

  const impactsByScen = new Map<string, any[]>();
  for (const i of impacts) {
    const list = impactsByScen.get(i.scenarioId) || [];
    list.push(i.get({ plain: true }));
    impactsByScen.set(i.scenarioId, list);
  }

  const currentByScen = new Map<string, any>();
  for (const c of currentRisks) currentByScen.set(c.scenarioId, c.get({ plain: true }));

  const treatByScen = new Map<string, any>();
  for (const t of treatments) treatByScen.set(t.scenarioId, t.get({ plain: true }));

  const rtpByScen = new Map<string, any>();
  for (const r of rtps) rtpByScen.set(r.scenarioId, r.get({ plain: true }));

  const resByScen = new Map<string, any>();
  for (const r of residuals) resByScen.set(r.scenarioId, r.get({ plain: true }));

  return scenarios.map((s) => {
    const plain = s.get({ plain: true }) as any;
    plain.includedVulns = vulnsByScen.get(s.id) || [];
    plain.potentialImpacts = impactsByScen.get(s.id) || [];
    plain.current = currentByScen.get(s.id) || null;
    plain.treatment = treatByScen.get(s.id) || null;
    plain.rtp = rtpByScen.get(s.id) || null;
    plain.residual = resByScen.get(s.id) || null;

    const weighted = calculateWeightedSeverity(plain.potentialImpacts, plain.impactOverride);
    plain.overallImpact = weighted.sev || 1;
    plain.inherentScore = (plain.inherentL || 1) * plain.overallImpact;
    plain.inherentBand = getRiskBand(plain.inherentScore);

    return plain;
  });
}

export async function getScenarioById(auth: AuthContext, id: string) {
  const scenario = await IsraScenario.findOne({ where: { id, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  const vulns = await IsraScenarioVuln.findAll({ where: { scenarioId: id } });
  const impacts = await IsraScenarioPotentialImpact.findAll({ where: { scenarioId: id } });
  const controls = await IsraExistingControl.findAll({ where: { scenarioId: id, orgId: auth.orgId } });
  const controlAnnexRefs = await IsraExistingControlAnnexRef.findAll({
    where: { existingControlId: { [Op.in]: controls.map((c) => c.id) } },
  });
  const currentRisk = await IsraScenarioCurrentRisk.findOne({ where: { scenarioId: id } });
  const treatment = await IsraScenarioTreatmentDecision.findOne({ where: { scenarioId: id, isCurrent: true } });
  const recommendations = await IsraScenarioRecommendationSnapshot.findOne({ where: { scenarioId: id, isCurrent: true } });
  const dispositions = await IsraScenarioRecommendationDisposition.findAll({ where: { scenarioId: id } });
  const addedControls = await IsraScenarioAddedControl.findAll({ where: { scenarioId: id } });
  const rtp = await IsraRtp.findOne({ where: { scenarioId: id, isCurrent: true } });
  const rtpActions = rtp ? await IsraRtpAction.findAll({ where: { rtpId: rtp.id } }) : [];
  const residual = await IsraScenarioResidual.findOne({ where: { scenarioId: id } });
  const cycles = await IsraScenarioCycle.findAll({ where: { scenarioId: id }, order: [["cycleNumber", "ASC"]] });

  const plain = scenario.get({ plain: true }) as any;
  plain.includedVulns = vulns.map((v) => v.vulnId);
  plain.potentialImpacts = impacts.map((i) => i.get({ plain: true }));

  const refsByControl = new Map<string, string[]>();
  for (const r of controlAnnexRefs) {
    const list = refsByControl.get(r.existingControlId) || [];
    list.push(r.annexRef);
    refsByControl.set(r.existingControlId, list);
  }
  plain.existingControls = controls.map((c) => {
    const cp = c.get({ plain: true }) as any;
    cp.annexRefs = refsByControl.get(c.id) || [];
    return cp;
  });

  plain.current = currentRisk ? currentRisk.get({ plain: true }) : null;
  plain.treatment = treatment ? treatment.get({ plain: true }) : null;
  plain.recommendations = recommendations ? recommendations.get({ plain: true }) : null;
  plain.dispositions = dispositions.map((d) => d.get({ plain: true }));
  plain.addedControls = addedControls.map((a) => a.get({ plain: true }));
  plain.rtp = rtp ? { ...rtp.get({ plain: true }), actions: rtpActions.map((a) => a.get({ plain: true })) } : null;
  plain.residual = residual ? residual.get({ plain: true }) : null;
  plain.cycles = cycles.map((c) => c.get({ plain: true }));

  const weighted = calculateWeightedSeverity(plain.potentialImpacts, plain.impactOverride);
  plain.overallImpact = weighted.sev || 1;
  plain.inherentScore = (plain.inherentL || 1) * plain.overallImpact;
  plain.inherentBand = getRiskBand(plain.inherentScore);

  return plain;
}

export async function createScenario(auth: AuthContext, input: Record<string, unknown>, ip: string | null) {
  const primaryAssetRef = str(input.primaryAssetRef);
  const primaryAssetSource = str(input.primaryAssetSource) || "platform";
  const secondaryAssetRef = str(input.secondaryAssetRef);
  const secondaryAssetSource = str(input.secondaryAssetSource) || "platform";
  const threatId = str(input.threatId);
  const title = str(input.title);

  if (!primaryAssetRef || !secondaryAssetRef || !threatId || !title) {
    throw new BadRequestError("Primary asset, secondary asset, threat, and title are required", "MISSING_REQUIRED_FIELDS");
  }

  // Generate next RSC- code
  const count = await IsraScenario.count({ where: { orgId: auth.orgId } });
  const code = `RSC-${String(count + 1).padStart(4, "0")}`;

  const row = await IsraScenario.create({
    orgId: auth.orgId,
    code,
    primaryAssetRef,
    primaryAssetSource,
    processRef: str(input.processRef),
    secondaryAssetRef,
    secondaryAssetSource,
    threatId,
    title,
    status: "Draft",
    cia: (input.cia as any) || {},
    inherentL: typeof input.inherentL === "number" ? input.inherentL : 3,
    evalCycle: 1,
    reviewDue: str(input.reviewDue),
    createdBy: auth.userId,
  });

  // Attach vulns if provided
  if (Array.isArray(input.includedVulns)) {
    for (const vulnId of input.includedVulns) {
      await IsraScenarioVuln.create({
        scenarioId: row.id,
        vulnId: String(vulnId),
      });
    }
  }

  // Attach potential impacts if provided
  if (Array.isArray(input.potentialImpacts)) {
    for (const p of input.potentialImpacts as any[]) {
      if (p.area && typeof p.severity === "number") {
        await IsraScenarioPotentialImpact.create({
          scenarioId: row.id,
          area: p.area,
          severity: p.severity,
          note: p.note || "",
        });
      }
    }
  }

  await recalculateScenarioScores(row.id, auth.orgId);

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "isra.scenario.created",
    entityType: "IsraScenario",
    entityId: row.id,
    sourceIp: ip,
    result: "Success",
  });

  return getScenarioById(auth, row.id);
}

export async function updateScenario(auth: AuthContext, id: string, input: Record<string, unknown>, ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  if (input.title !== undefined) scenario.title = str(input.title) || scenario.title;
  if (input.processRef !== undefined) scenario.processRef = str(input.processRef);
  if (input.status !== undefined) scenario.status = str(input.status) || scenario.status;
  if (input.cia !== undefined) scenario.cia = (input.cia as any) || scenario.cia;
  if (input.inherentL !== undefined && typeof input.inherentL === "number") scenario.inherentL = input.inherentL;
  if (input.reviewDue !== undefined) scenario.reviewDue = str(input.reviewDue);
  if (input.impactOverride !== undefined) scenario.impactOverride = (input.impactOverride as any) || null;

  await scenario.save();

  // Update vulns if provided
  if (Array.isArray(input.includedVulns)) {
    await IsraScenarioVuln.destroy({ where: { scenarioId: id } });
    for (const vulnId of input.includedVulns) {
      await IsraScenarioVuln.create({ scenarioId: id, vulnId: String(vulnId) });
    }
  }

  // Update impacts if provided
  if (Array.isArray(input.potentialImpacts)) {
    await IsraScenarioPotentialImpact.destroy({ where: { scenarioId: id } });
    for (const p of input.potentialImpacts as any[]) {
      if (p.area && typeof p.severity === "number") {
        await IsraScenarioPotentialImpact.create({
          scenarioId: id,
          area: p.area,
          severity: p.severity,
          note: p.note || "",
        });
      }
    }
  }

  await recalculateScenarioScores(id, auth.orgId);

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "isra.scenario.updated",
    entityType: "IsraScenario",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });

  return getScenarioById(auth, id);
}

export async function deleteScenario(auth: AuthContext, id: string, ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  await scenario.destroy();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "isra.scenario.deleted",
    entityType: "IsraScenario",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}

// ============================ Existing Controls ============================

export async function createExistingControl(auth: AuthContext, scenarioId: string, input: Record<string, unknown>, ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  const title = str(input.title);
  if (!title) throw new BadRequestError("Control title is required", "TITLE_REQUIRED");

  const row = await IsraExistingControl.create({
    orgId: auth.orgId,
    scenarioId,
    title,
    description: str(input.description) || "",
    status: str(input.status) || "Implemented and Effective",
    affects: str(input.affects) || "likelihood",
    objective: str(input.objective),
    maturity: (input.maturity as any) || null,
    maturityByRef: (input.maturityByRef as any) || {},
    verified: Boolean(input.verified),
    verifiedEffectiveness: typeof input.verifiedEffectiveness === "number" ? input.verifiedEffectiveness : null,
    createdBy: auth.userId,
  });

  if (Array.isArray(input.annexRefs)) {
    for (const ref of input.annexRefs) {
      await IsraExistingControlAnnexRef.create({
        existingControlId: row.id,
        annexRef: String(ref),
      });
    }
  }

  await recalculateScenarioScores(scenarioId, auth.orgId);
  return row.get({ plain: true });
}

export async function updateExistingControl(auth: AuthContext, controlId: string, input: Record<string, unknown>, ip: string | null) {
  const control = await IsraExistingControl.findOne({ where: { id: controlId, orgId: auth.orgId } });
  if (!control) throw new NotFoundError("Control not found", "CONTROL_NOT_FOUND");

  if (input.title !== undefined) control.title = str(input.title) || control.title;
  if (input.description !== undefined) control.description = str(input.description) || "";
  if (input.status !== undefined) control.status = str(input.status) || control.status;
  if (input.affects !== undefined) control.affects = str(input.affects) || control.affects;
  if (input.objective !== undefined) control.objective = str(input.objective);
  if (input.maturity !== undefined) control.maturity = (input.maturity as any) || null;
  if (input.maturityByRef !== undefined) control.maturityByRef = (input.maturityByRef as any) || {};
  if (input.verified !== undefined) control.verified = Boolean(input.verified);
  if (input.verifiedEffectiveness !== undefined) control.verifiedEffectiveness = typeof input.verifiedEffectiveness === "number" ? input.verifiedEffectiveness : null;

  await control.save();

  if (Array.isArray(input.annexRefs)) {
    await IsraExistingControlAnnexRef.destroy({ where: { existingControlId: control.id } });
    for (const ref of input.annexRefs) {
      await IsraExistingControlAnnexRef.create({
        existingControlId: control.id,
        annexRef: String(ref),
      });
    }
  }

  await recalculateScenarioScores(control.scenarioId, auth.orgId);
  return control.get({ plain: true });
}

export async function deleteExistingControl(auth: AuthContext, controlId: string, ip: string | null) {
  const control = await IsraExistingControl.findOne({ where: { id: controlId, orgId: auth.orgId } });
  if (!control) throw new NotFoundError("Control not found", "CONTROL_NOT_FOUND");

  const scenarioId = control.scenarioId;
  await control.destroy();
  await recalculateScenarioScores(scenarioId, auth.orgId);
}

// ======================= Treatment, RTP, Residuals =========================

export async function saveTreatmentDecision(auth: AuthContext, scenarioId: string, input: Record<string, unknown>, ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  const option = str(input.option) || "Modify";

  // Mark previous current as not current
  await IsraScenarioTreatmentDecision.update({ isCurrent: false }, { where: { scenarioId, isCurrent: true } });

  const row = await IsraScenarioTreatmentDecision.create({
    scenarioId,
    cycle: scenario.evalCycle || 1,
    version: 1,
    option,
    rationale: str(input.rationale),
    decidedBy: auth.userId,
    decisionDate: new Date().toISOString().slice(0, 10),
    approvalStatus: str(input.approvalStatus) || "Approved",
    acceptance: (input.acceptance as any) || null,
    status: "Active",
    isCurrent: true,
  });

  return row.get({ plain: true });
}

export async function generateRecommendations(auth: AuthContext, scenarioId: string) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  const vulns = await IsraScenarioVuln.findAll({ where: { scenarioId } });
  const vulnIds = vulns.map((v) => v.vulnId);

  // Query platform KM edges
  const kmEdges = vulnIds.length ? await IsraKmVulnControl.findAll({ where: { vulnId: { [Op.in]: vulnIds } } }) : [];

  // Query org overlays
  const overlays = await IsraVulnControlOverlay.findAll({ where: { orgId: auth.orgId } });
  const suppressedRefs = new Set(overlays.filter((o) => o.kind === "suppress").map((o) => o.annexRef));

  const recommendedMap = new Map<string, string[]>();
  for (const edge of kmEdges) {
    if (suppressedRefs.has(edge.annexRef)) continue;
    const list = recommendedMap.get(edge.annexRef) || [];
    list.push(edge.vulnId);
    recommendedMap.set(edge.annexRef, list);
  }

  // Add overlay additions
  for (const o of overlays.filter((o) => o.kind === "add")) {
    if (o.annexRef) {
      const list = recommendedMap.get(o.annexRef) || [];
      if (o.vulnId) list.push(o.vulnId);
      recommendedMap.set(o.annexRef, list);
    }
  }

  const controls = Array.from(recommendedMap.entries()).map(([annexRef, fromVulns]) => ({
    annexRef,
    fromVulns,
  }));

  // Mark old snapshot not current
  await IsraScenarioRecommendationSnapshot.update({ isCurrent: false }, { where: { scenarioId, isCurrent: true } });

  const snapshot = await IsraScenarioRecommendationSnapshot.create({
    scenarioId,
    controls,
    mapVersion: 1,
    generatedAt: new Date(),
    isCurrent: true,
  });

  return snapshot.get({ plain: true });
}

export async function saveRtp(auth: AuthContext, scenarioId: string, input: Record<string, unknown>, ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  let rtp = await IsraRtp.findOne({ where: { scenarioId, isCurrent: true } });
  if (!rtp) {
    rtp = await IsraRtp.create({
      scenarioId,
      version: 1,
      status: "Draft",
      funding: (input.funding as any) || [],
      monitoring: str(input.monitoring) || "",
      completionCriteria: str(input.completionCriteria) || "",
      isCurrent: true,
    });
  } else {
    rtp.funding = (input.funding as any) || rtp.funding;
    rtp.monitoring = str(input.monitoring) || rtp.monitoring;
    rtp.completionCriteria = str(input.completionCriteria) || rtp.completionCriteria;
    await rtp.save();
  }

  // If actions provided
  if (Array.isArray(input.actions)) {
    await IsraRtpAction.destroy({ where: { rtpId: rtp.id } });
    for (const a of input.actions as any[]) {
      const actRow = await IsraRtpAction.create({
        rtpId: rtp.id,
        action: a.action || "",
        owners: a.owners || [],
        targetDate: a.targetDate || null,
        status: a.status || "Planned",
      });

      if (Array.isArray(a.addedControlRefs)) {
        for (const ref of a.addedControlRefs) {
          await IsraRtpActionControl.create({
            rtpActionId: actRow.id,
            annexRef: String(ref),
          });
        }
      }
    }
  }

  return rtp.get({ plain: true });
}

export async function approveRtp(auth: AuthContext, scenarioId: string, ip: string | null) {
  const rtp = await IsraRtp.findOne({ where: { scenarioId, isCurrent: true } });
  if (!rtp) throw new NotFoundError("RTP not found", "RTP_NOT_FOUND");

  rtp.status = "Approved";
  rtp.approvedBy = auth.userId;
  rtp.approvedAt = new Date();
  await rtp.save();

  return rtp.get({ plain: true });
}

export async function saveResidual(auth: AuthContext, scenarioId: string, input: Record<string, unknown>, ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  let residual = await IsraScenarioResidual.findOne({ where: { scenarioId } });
  const score = typeof input.score === "number" ? input.score : 4;
  const band = getRiskBand(score);

  if (!residual) {
    residual = await IsraScenarioResidual.create({
      scenarioId,
      score,
      band,
      basis: str(input.basis) || "verified",
      assessmentDate: new Date().toISOString().slice(0, 10),
      assessedBy: auth.userId,
      notes: str(input.notes),
    });
  } else {
    residual.score = score;
    residual.band = band;
    residual.basis = str(input.basis) || residual.basis;
    residual.assessmentDate = new Date().toISOString().slice(0, 10);
    residual.assessedBy = auth.userId;
    residual.notes = str(input.notes);
    await residual.save();
  }

  return residual.get({ plain: true });
}

export async function promoteResidual(auth: AuthContext, scenarioId: string, ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  const residual = await IsraScenarioResidual.findOne({ where: { scenarioId } });
  if (!residual) throw new BadRequestError("No residual risk recorded to promote", "NO_RESIDUAL");

  // Promote residual score to current risk confirmed score
  const current = await IsraScenarioCurrentRisk.findOne({ where: { scenarioId } });
  if (current) {
    current.confirmedScore = residual.score;
    current.confirmedBand = residual.band;
    current.confirmedAt = new Date();
    current.confirmedBy = `${auth.userId} (Promoted Residual)`;
    await current.save();
  }

  // Clear residual slot for next cycle
  await residual.destroy();

  return { promoted: true };
}
