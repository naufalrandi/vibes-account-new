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
  IsraScenarioProjectedResidual,
  IsraScenarioCycle,
  IsraAnnexAControl,
  IsraOrgControl,
  IsraControlMaturityBaseline,
  IsraKmVulnControl,
  IsraVulnControlOverlay,
  IsraAppetiteLog,
  IsraOrgSettings,
  ISRA_REVIEW_PERIOD_DEFAULT,
  israAddMonthsIso,
} from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, NotFoundError, ConflictError } from "../../lib/errors";
import { ISRA_RESIDUAL_BASIS, type IsraResidualBasis } from "../../db/models/israResidualCycle.models";

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

/** Ports OD's `isra2AdqEval(score)` (app.html:19383) — the adequacy verdict
 * frozen alongside a residual assessment at save time (G-91), so a later
 * change to the org's appetite threshold cannot rewrite a past verdict. */
async function computeAdequacy(score: number, orgId: string): Promise<{ threshold: number; appetiteVersion: number | null; result: "Within acceptance criteria" | "Above acceptance criteria"; assessedAt: string }> {
  const appetiteLog = await IsraAppetiteLog.findOne({ where: { orgId }, order: [["version", "DESC"]] });
  const threshold = appetiteLog?.threshold ?? 9;
  return {
    threshold,
    appetiteVersion: appetiteLog?.version ?? null,
    result: score <= threshold ? "Within acceptance criteria" : "Above acceptance criteria",
    assessedAt: new Date().toISOString(),
  };
}

/** Ports OD's `isra2ResidualBasisText(basis)` (app.html:18658) verbatim,
 * including the "(Method C)" parenthetical. OD's source HTML-escapes the
 * ampersand (`&amp;`) because it is a raw string literal spliced into HTML —
 * per this repo's established convention for that (lib/od-spec/pageHeaders.ts
 * in the frontend port: the *rendered* text is what gets stored), the real
 * `&` character is stored here, not the entity. */
const ISRA_RESIDUAL_BASIS_TEXT: Record<IsraResidualBasis, string> = {
  verified: "implemented & verified controls (Method C)",
  projected: "the planned treatment controls in scope",
  current: "the current risk (no new treatment credited this cycle)",
  inherent: "the inherent risk (no controls credited yet)",
};

export function residualBasisText(basis: string | null | undefined): string {
  if (basis && (ISRA_RESIDUAL_BASIS as readonly string[]).includes(basis)) {
    return ISRA_RESIDUAL_BASIS_TEXT[basis as IsraResidualBasis];
  }
  return "the controls in scope";
}

// 12-area consequence calculation with dominance floor (§3.2)
export function calculateWeightedSeverity(
  potentialImpacts: { area: string; severity: number }[],
  override?: { severity: number; justification?: string } | null
): { sev: number; exposure: number; wavg: number; dominant: boolean; maxArea?: string; maxSev?: number } {
  if (override && typeof override.severity === "number" && override.severity >= 1 && override.severity <= 5) {
    return {
      sev: override.severity,
      exposure: Math.round(((override.severity - 1) / 4) * 100),
      wavg: override.severity,
      dominant: false,
    };
  }

  const rated = potentialImpacts.filter((p) => typeof p.severity === "number" && p.severity > 0);
  if (rated.length === 0) {
    return { sev: 0, exposure: 0, wavg: 0, dominant: false };
  }

  let wsum = 0;
  let acc = 0;
  let maxSev = 0;
  let maxArea = "";
  for (const p of rated) {
    const weight = ISRA_CONSEQ_WEIGHT[p.area] ?? 1;
    wsum += weight;
    acc += weight * p.severity;
    if (p.severity > maxSev) {
      maxSev = p.severity;
      maxArea = p.area;
    }
  }

  const wavg = wsum > 0 ? acc / wsum : 0;
  const hasDominant = rated.some((p) => p.severity >= 4);
  const floor = hasDominant ? 4 : 0;
  const sev = Math.min(5, Math.max(1, Math.max(Math.round(wavg), floor)));
  const exposure = Math.min(100, Math.max(0, Math.round(((wavg - 1) / 4) * 100)));

  return { sev, exposure, wavg, dominant: hasDominant, maxArea, maxSev };
}

export async function recalculateScenarioScores(scenarioId: string, orgId: string, markReview = false) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId } });
  if (!scenario) return null;

  const impacts = await IsraScenarioPotentialImpact.findAll({ where: { scenarioId } });
  const impactResult = calculateWeightedSeverity(
    impacts.map((i) => ({ area: i.area, severity: i.severity })),
    scenario.impactOverride
  );

  const inherentImpact = impactResult.sev || 0;
  const inherentL = scenario.inherentL || 0;
  const inherentScore = inherentL > 0 && inherentImpact > 0 ? inherentL * inherentImpact : 0;
  const inherentBand = inherentScore > 0 ? getRiskBand(inherentScore) : "";

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

  // All 5 dimensions required > 0 for valid baseline maturity
  const baselineMaturityMap = new Map<string, number>();
  for (const b of baselines) {
    const g = b.gov ?? 0, d = b.doc ?? 0, i = b.impl ?? 0, m = b.mon ?? 0, c = b.comp ?? 0;
    if (g > 0 && d > 0 && i > 0 && m > 0 && c > 0) {
      const avg = (g + d + i + m + c) / 5;
      baselineMaturityMap.set(b.annexRef, avg);
    }
  }

  // Calculate Method C Current Risk (§3.4)
  const eligibleControls = controls.filter((c) => {
    const statusEligible = c.status === "Implemented" || c.status === "Implemented and Effective";
    const hasDesc = !!c.description && c.description.trim().length > 0;
    const refs = refsByControl.get(c.id) || [];
    if (!statusEligible || !hasDesc || refs.length === 0) return false;
    // OD's isra2CtrlEligibility also requires at least one mapped Annex A ref
    // to carry a nonzero P/D/C reduction profile on either axis — a control
    // mapped only to refs with no capability/dedication has "mapped controls
    // have no P/D/C reduction profile" and is excluded, not just zero-power.
    return refs.some((ref) => {
      const prof = controlProfileMap.get(ref);
      if (!prof) return false;
      const cap = Math.min(1, (prof.fnP ? 0.6 : 0) + (prof.fnD ? 0.3 : 0) + (prof.fnC ? 0.1 : 0));
      return cap > 0 && (prof.dedL || prof.dedC);
    });
  });

  const getPower = (c: IsraExistingControl, axis: "L" | "C") => {
    const refs = refsByControl.get(c.id) || [];
    let bestPower = 0;
    let bestCap = 0;
    let bestMat = 0;

    for (const ref of refs) {
      const prof = controlProfileMap.get(ref);
      if (!prof) continue; // unknown ref yields cap 0 / ineligibility
      const applies = axis === "L" ? prof.dedL : prof.dedC;
      if (!applies) continue;

      const cap = Math.min(1, (prof.fnP ? 0.6 : 0) + (prof.fnD ? 0.3 : 0) + (prof.fnC ? 0.1 : 0));

      // Maturity factor: all 5 dimensions required > 0
      let matFactor = 0;
      if (c.maturityByRef && typeof c.maturityByRef[ref] === "number" && c.maturityByRef[ref] > 0) {
        matFactor = c.maturityByRef[ref] / 5;
      } else if (baselineMaturityMap.has(ref)) {
        matFactor = baselineMaturityMap.get(ref)! / 5;
      } else if (c.maturity) {
        const m = c.maturity;
        if (
          typeof m.gov === "number" && m.gov > 0 &&
          typeof m.doc === "number" && m.doc > 0 &&
          typeof m.impl === "number" && m.impl > 0 &&
          typeof m.mon === "number" && m.mon > 0 &&
          typeof m.comp === "number" && m.comp > 0
        ) {
          matFactor = (m.gov + m.doc + m.impl + m.mon + m.comp) / 25;
        }
      }

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
    if (currentBasis <= 0) return 0;
    const list = verifiedOnly ? eligibleControls.filter((c) => c.verified || c.verifiedEffectiveness != null) : eligibleControls;

    // Strong evaluated across all controls in the list before grouping
    let isStrong = false;
    const groupPowers = new Map<string, { power: number; cap: number; matFactor: number }>();
    for (const c of list) {
      const p = getPower(c, axis);
      if (p.cap >= 0.6 && p.matFactor >= 0.8) {
        isStrong = true;
      }
      const key = c.objective?.trim() || c.id;
      const existing = groupPowers.get(key);
      if (!existing || p.power > existing.power) {
        groupPowers.set(key, p);
      }
    }

    let pool = 0;
    for (const g of groupPowers.values()) {
      pool += g.power;
    }

    const range = Math.max(0, currentBasis - 1);
    const cap = Math.min(isStrong ? 2 : 1, range);
    const drop = Math.min(Math.round(pool), cap);
    return drop;
  };

  const dropL = poolAxis("L", inherentL);
  const dropC = poolAxis("C", inherentImpact);

  const suggestedL = inherentL > 0 ? Math.max(1, inherentL - dropL) : 0;
  const suggestedImpact = inherentImpact > 0 ? Math.max(1, inherentImpact - dropC) : 0;
  const suggestedScore = suggestedL > 0 && suggestedImpact > 0 ? suggestedL * suggestedImpact : 0;
  const suggestedBand = suggestedScore > 0 ? getRiskBand(suggestedScore) : "";

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
      needsReview: markReview,
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
    currentRisk.confirmedAt = new Date();
    currentRisk.calcAt = new Date();
    currentRisk.needsReview = markReview ? true : (currentRisk.needsReview ?? false);
    currentRisk.eligibleControlIds = eligibleControls.map((c) => c.id);
    await currentRisk.save();
  }

  // Actual Residual calculation
  const verifiedControls = eligibleControls.filter((c) => c.verified || c.verifiedEffectiveness != null);
  const actDropL = poolAxis("L", inherentL, true);
  const actDropC = poolAxis("C", inherentImpact, true);
  const actL = inherentL > 0 ? Math.max(1, inherentL - actDropL) : 0;
  const actImpact = inherentImpact > 0 ? Math.max(1, inherentImpact - actDropC) : 0;
  const actScore = actL > 0 && actImpact > 0 ? actL * actImpact : 0;
  const actBand = actScore > 0 ? getRiskBand(actScore) : "";

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
      confirmedAt: new Date(),
      confirmedBy: "System (Actual Residual)",
      verifiedControlIds: verifiedControls.map((c) => c.id),
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
    actualRes.confirmedAt = new Date();
    actualRes.verifiedControlIds = verifiedControls.map((c) => c.id);
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
    // Unassessed (sev === 0) must stay 0 — coercing to 1 would render an
    // unrated scenario as "Low" instead of "not assessed" (G-21; matches OD's
    // isra2OverallImpact/isra2InherentScore, which never inflate sev to 1).
    plain.overallImpact = weighted.sev;
    // R287 / OD `isra2WeightedSeverity` also returns the 0-100 exposure index,
    // which the port computed and then discarded before the response.
    plain.exposure = weighted.exposure;
    plain.inherentScore = plain.inherentL > 0 && plain.overallImpact > 0 ? plain.inherentL * plain.overallImpact : 0;
    plain.inherentBand = plain.inherentScore > 0 ? getRiskBand(plain.inherentScore) : "";

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
  const projectedResidual = await IsraScenarioProjectedResidual.findOne({ where: { scenarioId: id } });
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
  plain.projectedResidual = projectedResidual ? projectedResidual.get({ plain: true }) : null;
  plain.cycles = cycles.map((c) => c.get({ plain: true }));

  const weighted = calculateWeightedSeverity(plain.potentialImpacts, plain.impactOverride);
  // See listScenarios above — unassessed (sev === 0) must stay 0 (G-21).
  plain.overallImpact = weighted.sev;
  plain.exposure = weighted.exposure;
  plain.inherentScore = plain.inherentL > 0 && plain.overallImpact > 0 ? plain.inherentL * plain.overallImpact : 0;
  plain.inherentBand = plain.inherentScore > 0 ? getRiskBand(plain.inherentScore) : "";

  // Auto-suggested residual for this cycle (isra2SuggestResidual) — computed
  // fresh on every read, exactly as OD does (isra2ResidualForm/
  // isra2ResidualSection call it inline, they never cache it). Only omitted
  // when the residual has already been assessed and confirmed this cycle,
  // matching OD's `_fromProj=!r.assessmentDate&&...` gate on the auto-card.
  plain.suggestedResidual = residual?.assessmentDate ? null : await suggestResidual(id, auth.orgId);

  return plain;
}

async function nextScenarioCode(orgId: string): Promise<string> {
  const rows = await IsraScenario.findAll({
    where: { orgId },
    attributes: ["code"],
  });
  let max = 0;
  for (const r of rows) {
    const m = (r.code || "").match(/^RSC-(\d+)$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `RSC-${String(max + 1).padStart(4, "0")}`;
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

  // Generate next RSC- code per tenant
  const code = await nextScenarioCode(auth.orgId);

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
  if (input.status !== undefined) {
    const nextStatus = str(input.status) || scenario.status;
    if (nextStatus === "Closed" && scenario.status !== "Closed") {
      const check = await canCloseScenario(id, auth.orgId);
      if (!check.canClose) {
        throw new BadRequestError(`Cannot close scenario: ${check.reasons.join("; ")}`, "SCENARIO_CANNOT_CLOSE");
      }
    }
    scenario.status = nextStatus;
  }
  if (input.cia !== undefined) scenario.cia = (input.cia as any) || scenario.cia;
  if (input.inherentL !== undefined && typeof input.inherentL === "number") scenario.inherentL = input.inherentL;
  if (input.likelihoodNote !== undefined) scenario.likelihoodNote = str(input.likelihoodNote);
  if (input.ciaDesc !== undefined) scenario.ciaDesc = (input.ciaDesc as any) || {};
  if (input.reviewDue !== undefined) scenario.reviewDue = str(input.reviewDue);
  if (input.impactOverride !== undefined) {
    const rawOverride = input.impactOverride as Record<string, unknown> | null;
    if (rawOverride) {
      // OD gates this at the form (isra2OverrideForm: "Justification is
      // required for an override"), not at compute — this is the only
      // enforcement point in this split, since no FE form posts here yet
      // (G-20). An override without justification is an unauditable severity
      // change on an ISO 27001 risk scenario, so refuse the save outright
      // rather than silently persisting it.
      const overrideSeverity = typeof rawOverride.severity === "number" ? rawOverride.severity : null;
      const overrideJustification = str(rawOverride.justification);
      if (overrideSeverity == null || overrideSeverity < 1 || overrideSeverity > 5) {
        throw new BadRequestError("Override severity must be between 1 and 5", "OVERRIDE_SEVERITY_INVALID");
      }
      if (!overrideJustification) {
        throw new BadRequestError("Override justification is required", "OVERRIDE_JUSTIFICATION_REQUIRED");
      }
      scenario.impactOverride = {
        severity: overrideSeverity,
        justification: overrideJustification,
        by: auth.userId,
        at: new Date().toISOString(),
      };
    } else {
      scenario.impactOverride = null;
    }
  }

  await scenario.save();

  // Update vulns if provided.
  //
  // OD `isra2RemoveVuln` refuses to take the last one away ("A scenario must
  // keep at least one vulnerability"): the risk model is
  // threat -> vulnerability -> control, and the inherent score derives from
  // the vuln set, so a scenario with none scores nothing and means nothing.
  // This path replaces the set wholesale, so an empty array was wiping every
  // vulnerability in one call. A never-populated Draft is a different state
  // and is left alone — the invariant is on scenarios that have them.
  if (Array.isArray(input.includedVulns)) {
    if (input.includedVulns.length === 0) {
      const current = await IsraScenarioVuln.count({ where: { scenarioId: id } });
      if (current > 0) {
        throw new ConflictError("A scenario must keep at least one vulnerability", "SCENARIO_VULNS_REQUIRED");
      }
    }
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

export async function createExistingControl(auth: AuthContext, scenarioId: string, input: Record<string, unknown>, _ip: string | null) {
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
    owner: str(input.owner),
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

export async function updateExistingControl(auth: AuthContext, controlId: string, input: Record<string, unknown>, _ip: string | null) {
  const control = await IsraExistingControl.findOne({ where: { id: controlId, orgId: auth.orgId } });
  if (!control) throw new NotFoundError("Control not found", "CONTROL_NOT_FOUND");

  if (input.title !== undefined) control.title = str(input.title) || control.title;
  if (input.description !== undefined) control.description = str(input.description) || "";
  if (input.status !== undefined) control.status = str(input.status) || control.status;
  if (input.affects !== undefined) control.affects = str(input.affects) || control.affects;
  if (input.objective !== undefined) control.objective = str(input.objective);
  if (input.owner !== undefined) control.owner = str(input.owner);
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

export async function deleteExistingControl(auth: AuthContext, controlId: string, _ip: string | null) {
  const control = await IsraExistingControl.findOne({ where: { id: controlId, orgId: auth.orgId } });
  if (!control) throw new NotFoundError("Control not found", "CONTROL_NOT_FOUND");

  const scenarioId = control.scenarioId;
  await control.destroy();
  await recalculateScenarioScores(scenarioId, auth.orgId);
}

// ======================= Treatment, RTP, Residuals =========================

export async function saveTreatmentDecision(auth: AuthContext, scenarioId: string, input: Record<string, unknown>, _ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  const option = str(input.option) || "Modify";
  const rationale = str(input.rationale);
  // OD refuses the save outright when rationale is blank (isra2TreatForm:
  // "Decision rationale is required"; G-92) — validate before any mutation
  // so a rejected save leaves no partial state behind.
  if (!rationale) {
    throw new BadRequestError("Decision rationale is required", "TREATMENT_RATIONALE_REQUIRED");
  }

  // Mark previous current as not current
  await IsraScenarioTreatmentDecision.update({ isCurrent: false }, { where: { scenarioId, isCurrent: true } });

  const row = await IsraScenarioTreatmentDecision.create({
    scenarioId,
    cycle: scenario.evalCycle || 1,
    version: 1,
    option,
    rationale,
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

export async function saveRtp(auth: AuthContext, scenarioId: string, input: Record<string, unknown>, _ip: string | null) {
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
  } else if (rtp.status === "Approved") {
    /**
     * R339 / OD `isra2RtpSave` (js/core.js:15250) — editing an APPROVED plan
     * does not amend it. The approved version is preserved (it is what an
     * auditor was shown) and the edit becomes v+1 in Draft with the approval
     * cleared, because the new content has not been approved by anyone.
     * Before this, an approved plan could be rewritten in place and still
     * read "Approved" over content nobody signed off.
     */
    const approved = rtp;
    approved.isCurrent = false;
    await approved.save();
    rtp = await IsraRtp.create({
      scenarioId,
      cycle: approved.cycle,
      option: approved.option,
      title: approved.title,
      description: approved.description,
      addedControlIds: approved.addedControlIds,
      owner: approved.owner,
      supporting: approved.supporting,
      resources: approved.resources,
      startDate: approved.startDate,
      targetDate: approved.targetDate,
      expectedEvidence: approved.expectedEvidence,
      dependencies: approved.dependencies,
      version: (approved.version || 1) + 1,
      status: "Draft",
      createdBy: auth.userId ?? approved.createdBy,
      approvedBy: null,
      approvedAt: null,
      funding: (input.funding as any) ?? approved.funding,
      monitoring: str(input.monitoring) || approved.monitoring,
      completionCriteria: str(input.completionCriteria) || approved.completionCriteria,
      needsReview: true,
      isCurrent: true,
    });
    // Carry the approved version's roster forward, so a v+1 opened without an
    // explicit `actions` payload is not an empty plan.
    if (!Array.isArray(input.actions)) {
      const prior = await IsraRtpAction.findAll({ where: { rtpId: approved.id } });
      for (const a of prior) {
        const copy = await IsraRtpAction.create({
          rtpId: rtp.id, action: a.action, owners: a.owners, targetDate: a.targetDate, status: a.status,
        });
        const refs = await IsraRtpActionControl.findAll({ where: { rtpActionId: a.id } });
        for (const r of refs) await IsraRtpActionControl.create({ rtpActionId: copy.id, annexRef: r.annexRef });
      }
    }
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

export async function approveRtp(auth: AuthContext, scenarioId: string, _ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  const rtp = await IsraRtp.findOne({ where: { scenarioId, isCurrent: true } });
  if (!rtp) throw new NotFoundError("RTP not found", "RTP_NOT_FOUND");

  rtp.status = "Approved";
  rtp.approvedBy = auth.userId;
  rtp.approvedAt = new Date();
  await rtp.save();

  return rtp.get({ plain: true });
}

export interface IsraResidualSuggestion {
  l: number;
  impact: number;
  score: number;
  band: string;
  basis: IsraResidualBasis;
  basisText: string;
}

/**
 * Ports OD's `isra2SuggestResidual(sc)` (app.html:18643) — the four-tier
 * auto-suggested post-treatment residual, in priority order:
 *   1. verified  — controls implemented AND verified this cycle, Method C
 *      over verified Existing Controls only (`isra2DeriveActual`).
 *   2. projected — this cycle's user-ASSESSED Projected Residual. OD never
 *      runs Method C for this tier ("Planned/Added controls are not
 *      operating or evidenced yet") — it is whatever the user entered via
 *      `isra2ProjForm` / `saveProjectedResidual` below.
 *   3. current   — the confirmed Current Risk.
 *   4. inherent  — overall impact severity (or 3) x inherentL (or 3), when
 *      nothing above is available.
 * Then capped: if the picked score exceeds the confirmed Current Risk score,
 * it is replaced by Current — OD's own comment: "treatment cannot raise the
 * risk above where it already sits." Returns null only when the scenario
 * itself does not exist.
 */
export async function suggestResidual(scenarioId: string, orgId: string): Promise<IsraResidualSuggestion | null> {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId } });
  if (!scenario) return null;

  const current = await IsraScenarioCurrentRisk.findOne({ where: { scenarioId } });
  const curL = current?.confirmedL ?? null;
  const curImpact = current?.confirmedImpact ?? null;
  const curScore = current?.confirmedScore ?? null;
  const curBand = current?.confirmedBand ?? null;
  // OD's `curConf` gate is `!!sc.current.confirmedAt` alone. This backend's
  // "Auto-adopt Current Risk" (recalculateScenarioScores) sets confirmedAt
  // unconditionally the instant a scenario exists, even fully unrated (score
  // 0 — the same "not assessed" sentinel this codebase already uses for
  // overallImpact/inherentScore, G-21). A literal confirmedAt-only gate would
  // make tier 3 fire on that zero placeholder and tier 4 unreachable, so this
  // additionally requires a real (nonzero) confirmed score — the adaptation
  // this repo's auto-adopt behavior requires to keep the tier faithful.
  const curMeaningful = !!(current && current.confirmedAt && curScore != null && curScore > 0 && curL && curImpact);

  let pick: { l: number; impact: number; score: number; band: string; basis: IsraResidualBasis } | null = null;

  // Tier 1 — verified (Method C over controls verified this cycle).
  const actualRes = await IsraScenarioActualResidual.findOne({ where: { scenarioId } });
  if (actualRes && (actualRes.verifiedControlIds || []).length > 0) {
    const l = actualRes.suggestedL ?? 0;
    const impact = actualRes.suggestedImpact ?? 0;
    const score = actualRes.suggestedScore ?? l * impact;
    pick = { l, impact, score, band: actualRes.suggestedBand || getRiskBand(score), basis: "verified" };
  }

  // Tier 2 — projected (user-assessed, never Method C).
  if (!pick) {
    const projected = await IsraScenarioProjectedResidual.findOne({ where: { scenarioId } });
    if (projected && projected.confirmedL && projected.confirmedImpact) {
      const score = projected.confirmedScore ?? projected.confirmedL * projected.confirmedImpact;
      pick = { l: projected.confirmedL, impact: projected.confirmedImpact, score, band: projected.confirmedBand || getRiskBand(score), basis: "projected" };
    }
  }

  // Tier 3 — current (see curMeaningful above). A scenario with no
  // meaningfully-scored Current Risk yet (unrated, or no Current Risk row at
  // all) falls through to inherent below instead of duplicating the Method C
  // derivation for a case OD's own "derive fresh" branch would otherwise cover.
  if (!pick && curMeaningful) {
    pick = { l: curL as number, impact: curImpact as number, score: curScore as number, band: curBand || getRiskBand(curScore as number), basis: "current" };
  }

  // Tier 4 — inherent.
  if (!pick) {
    const impacts = await IsraScenarioPotentialImpact.findAll({ where: { scenarioId } });
    const weighted = calculateWeightedSeverity(
      impacts.map((i) => i.get({ plain: true })) as { area: string; severity: number }[],
      scenario.impactOverride as { severity: number; justification?: string } | null,
    );
    const oi = weighted.sev || 3;
    const iL = scenario.inherentL || 3;
    pick = { l: iL, impact: oi, score: iL * oi, band: getRiskBand(iL * oi), basis: "inherent" };
  }

  // Cap at Current — treatment cannot raise the risk above where it already sits.
  if (curMeaningful && pick.score > (curScore as number)) {
    pick = { l: curL as number, impact: curImpact as number, score: curScore as number, band: curBand || getRiskBand(curScore as number), basis: "current" };
  }

  return { ...pick, basisText: residualBasisText(pick.basis) };
}

export async function saveResidual(auth: AuthContext, scenarioId: string, input: Record<string, unknown>, _ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  let residual = await IsraScenarioResidual.findOne({ where: { scenarioId } });
  // OD's residual is always L x Impact (isra2ResidualForm.onOk: `sco=L*I`) —
  // accept L/impact when the caller has them and derive score from them.
  // A bare `score` is still accepted (and still wins if L/impact are absent)
  // so existing callers that only ever posted a raw score keep working.
  const l = typeof input.l === "number" ? input.l : typeof input.L === "number" ? (input.L as number) : null;
  const impact = typeof input.impact === "number" ? input.impact : null;
  const score = l != null && impact != null ? l * impact : typeof input.score === "number" ? input.score : 4;
  const band = getRiskBand(score);
  const adequacy = await computeAdequacy(score, auth.orgId);

  if (!residual) {
    residual = await IsraScenarioResidual.create({
      scenarioId,
      l,
      impact,
      score,
      band,
      basis: str(input.basis) || "verified",
      assessmentDate: new Date().toISOString().slice(0, 10),
      assessedBy: auth.userId,
      notes: str(input.notes),
      adequacy,
    });
  } else {
    residual.l = l ?? residual.l;
    residual.impact = impact ?? residual.impact;
    residual.score = score;
    residual.band = band;
    residual.basis = str(input.basis) || residual.basis;
    residual.assessmentDate = new Date().toISOString().slice(0, 10);
    residual.assessedBy = auth.userId;
    residual.notes = str(input.notes);
    residual.adequacy = adequacy;
    await residual.save();
  }

  return residual.get({ plain: true });
}

/**
 * Ports OD's `isra2ProjForm` save (app.html:19374's `onOk`) — the Phase-3
 * USER-assessed Projected Residual entered during RTP planning. Unlike
 * Current/Actual Residual, OD deliberately does not run Method C here
 * (planned/added controls aren't operating or evidenced yet), so this only
 * persists the caller's L/impact — `suggestedL/Impact/Score/Band` are left
 * null (see the class doc on `IsraScenarioProjectedResidual`).
 */
export async function saveProjectedResidual(auth: AuthContext, scenarioId: string, input: Record<string, unknown>, _ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  const l = typeof input.l === "number" ? input.l : typeof input.L === "number" ? (input.L as number) : null;
  const impact = typeof input.impact === "number" ? input.impact : null;
  if (!l || !impact) {
    throw new BadRequestError("Projected Likelihood and Impact are required", "PROJECTED_LC_REQUIRED");
  }
  const score = l * impact;
  const band = getRiskBand(score);
  const adequacy = await computeAdequacy(score, auth.orgId);
  const rtp = await IsraRtp.findOne({ where: { scenarioId, isCurrent: true } });

  let projected = await IsraScenarioProjectedResidual.findOne({ where: { scenarioId } });
  if (!projected) {
    projected = await IsraScenarioProjectedResidual.create({
      scenarioId,
      suggestedL: null,
      suggestedImpact: null,
      suggestedScore: null,
      suggestedBand: null,
      confirmedL: l,
      confirmedImpact: impact,
      confirmedScore: score,
      confirmedBand: band,
      rtpVersion: rtp?.version ?? null,
      adequacy,
      confirmedAt: new Date(),
      confirmedBy: auth.userId,
      needsReview: false,
    });
  } else {
    projected.confirmedL = l;
    projected.confirmedImpact = impact;
    projected.confirmedScore = score;
    projected.confirmedBand = band;
    projected.rtpVersion = rtp?.version ?? null;
    projected.adequacy = adequacy;
    projected.confirmedAt = new Date();
    projected.confirmedBy = auth.userId;
    projected.needsReview = false;
    await projected.save();
  }

  return projected.get({ plain: true });
}

export async function canCloseScenario(scenarioId: string, orgId: string): Promise<{ canClose: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId } });
  if (!scenario) return { canClose: false, reasons: ["Scenario not found"] };

  const current = await IsraScenarioCurrentRisk.findOne({ where: { scenarioId } });
  if (!current || !current.confirmedScore) {
    reasons.push("Current risk score has not been evaluated/confirmed");
  }

  const appetiteLog = await IsraAppetiteLog.findOne({ where: { orgId }, order: [["version", "DESC"]] });
  const appetite = appetiteLog?.threshold ?? 9;

  const currentScore = current?.confirmedScore ?? 0;
  if (current && currentScore > appetite) {
    const residual = await IsraScenarioResidual.findOne({ where: { scenarioId } });
    const resScore = residual?.score ?? currentScore;
    if (!residual || resScore > appetite) {
      reasons.push(`Risk score (${resScore}) exceeds appetite threshold (${appetite})`);
    }
  }

  const rtp = await IsraRtp.findOne({ where: { scenarioId, isCurrent: true } });
  if (rtp && rtp.status !== "Approved") {
    reasons.push("Risk Treatment Plan is not approved");
  }
  if (rtp) {
    const actions = await IsraRtpAction.findAll({ where: { rtpId: rtp.id } });
    const pending = actions.filter((a) => a.status !== "Completed" && a.status !== "Verified");
    if (pending.length > 0) {
      reasons.push(`${pending.length} RTP action(s) are not verified/completed`);
    }
  }

  return { canClose: reasons.length === 0, reasons };
}

/**
 * Ports OD's `isra2PromoteResidual(sc)` (app.html:18669) — promotes the
 * confirmed residual to Current, closes the cycle, and either accepts the
 * risk (within appetite) or leaves it open for further treatment (above
 * appetite):
 *   - snapshot the cycle (current/treatment/rtp/actual/residual/projected)
 *   - current <- residual (L, impact, score, band)
 *   - null out residual AND projected, evalCycle++
 *   - reviewDue via the within/above review period
 *   - within appetite: mark accepted, archive the RTP out of "current",
 *     clear added controls (they're baked into the new Current now)
 *   - above appetite: leave "accepted" unset
 * OD's `sc.accepted={at,by,score}` has no dedicated column in this schema;
 * this port already used `treatment.status = "Accepted"` as the closest
 * available signal (pre-existing choice, kept) — fixed here to apply
 * unconditionally within appetite rather than only when the treatment
 * decision happened to already be "Active".
 */
export async function promoteResidual(auth: AuthContext, scenarioId: string, _ip: string | null) {
  const scenario = await IsraScenario.findOne({ where: { id: scenarioId, orgId: auth.orgId } });
  if (!scenario) throw new NotFoundError("Scenario not found", "SCENARIO_NOT_FOUND");

  const residual = await IsraScenarioResidual.findOne({ where: { scenarioId } });
  if (!residual) throw new BadRequestError("No residual risk recorded to promote", "NO_RESIDUAL");

  let current = await IsraScenarioCurrentRisk.findOne({ where: { scenarioId } });
  const treatment = await IsraScenarioTreatmentDecision.findOne({ where: { scenarioId, isCurrent: true } });
  const rtp = await IsraRtp.findOne({ where: { scenarioId, isCurrent: true } });
  const actualRes = await IsraScenarioActualResidual.findOne({ where: { scenarioId } });
  const projected = await IsraScenarioProjectedResidual.findOne({ where: { scenarioId } });

  // Appetite check drives both the review period and the accept/keep-treating branch.
  const appetiteLog = await IsraAppetiteLog.findOne({ where: { orgId: auth.orgId }, order: [["version", "DESC"]] });
  const appetiteThreshold = appetiteLog?.threshold ?? 9;
  const promotedScore = residual.score ?? 4;
  const promotedBand = residual.band ?? getRiskBand(promotedScore);
  const promotedL = residual.l ?? 1;
  const promotedImpact = residual.impact ?? 1;
  const within = promotedScore <= appetiteThreshold;

  // 1. Archive cycle history snapshot
  const currentCycle = scenario.evalCycle || 1;
  await IsraScenarioCycle.create({
    scenarioId,
    cycleNumber: currentCycle,
    snapshot: {
      cycle: currentCycle,
      currentRisk: current ? current.get({ plain: true }) : null,
      treatmentDecision: treatment ? treatment.get({ plain: true }) : null,
      rtp: rtp ? rtp.get({ plain: true }) : null,
      actualResidual: actualRes ? actualRes.get({ plain: true }) : null,
      projectedResidual: projected ? projected.get({ plain: true }) : null,
      residual: residual.get({ plain: true }),
      dueDate: scenario.reviewDue || "",
      completedAt: new Date().toISOString(),
      completedBy: auth.userId,
    },
    archivedAt: new Date(),
  });

  // 2. Advance evaluation cycle
  scenario.evalCycle = currentCycle + 1;

  // 3. Promote residual (L, impact, score, band) to Current
  if (!current) {
    current = await IsraScenarioCurrentRisk.create({
      scenarioId,
      method: "C-capped-quality-gated",
      methodVer: 1,
      calcAt: new Date(),
      iL: scenario.inherentL || 1,
      iImpact: promotedImpact,
      suggestedL: promotedL,
      suggestedImpact: promotedImpact,
      suggestedScore: promotedScore,
      suggestedBand: promotedBand,
      confirmedL: promotedL,
      confirmedImpact: promotedImpact,
      confirmedScore: promotedScore,
      confirmedBand: promotedBand,
      confirmedAt: new Date(),
      confirmedBy: `${auth.userId} (Promoted Residual)`,
      needsReview: false,
      eligibleControlIds: [],
    });
  } else {
    current.confirmedL = promotedL;
    current.confirmedImpact = promotedImpact;
    current.confirmedScore = promotedScore;
    current.confirmedBand = promotedBand;
    current.confirmedAt = new Date();
    current.confirmedBy = `${auth.userId} (Promoted Residual)`;
    await current.save();
  }

  // 4. Review due — OD `isra2ReviewPeriodMonths(within)` + `isra2AddMonthsISO`
  // (core.js:14767): the tenant's within/above period is in calendar MONTHS,
  // defaulting to 6 / 2.
  const orgSettings = await IsraOrgSettings.findOne({ where: { orgId: auth.orgId } });
  const reviewMonths = within
    ? (orgSettings?.reviewPeriodWithinMonths ?? ISRA_REVIEW_PERIOD_DEFAULT.within)
    : (orgSettings?.reviewPeriodAboveMonths ?? ISRA_REVIEW_PERIOD_DEFAULT.above);
  scenario.reviewDue = israAddMonthsIso(new Date(), reviewMonths);

  // 5. Within appetite: accept + archive the RTP out of "current" + clear added controls.
  //    Above appetite: leave acceptance unset — further treatment is needed.
  if (within) {
    if (treatment) {
      treatment.status = "Accepted";
      await treatment.save();
    }
    if (rtp) {
      rtp.isCurrent = false;
      await rtp.save();
    }
    await IsraScenarioAddedControl.destroy({ where: { scenarioId } });
  }

  await scenario.save();

  // 6. Clear residual AND projected slots for the next cycle.
  await residual.destroy();
  if (projected) await projected.destroy();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "isra.residual.promoted",
    entityType: "IsraScenario",
    entityId: scenarioId,
    sourceIp: _ip,
    result: "Success",
  });

  return { promoted: true, cycle: scenario.evalCycle, reviewDue: scenario.reviewDue, within };
}
