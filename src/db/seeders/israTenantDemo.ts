import { randomUUID } from "node:crypto";
import {
  IsraAnnexAControl,
  IsraThreatLibrary,
  IsraVulnLibrary,
  IsraScenario,
  IsraScenarioVuln,
  IsraScenarioPotentialImpact,
  IsraScenarioCurrentRisk,
  IsraExistingControl,
  IsraExistingControlAnnexRef,
  IsraScenarioTreatmentDecision,
  IsraScenarioRecommendationSnapshot,
  IsraScenarioRecommendationDisposition,
  IsraScenarioAddedControl,
  IsraRtp,
  IsraRtpAction,
  IsraRtpActionControl,
  IsraScenarioProjectedResidual,
  IsraScenarioResidual,
  IsraScenarioCycle,
  IsraInitiative,
  IsraInitiativeScenario,
  IsraAssetMap,
  IsraAssetMapUsage,
  IsraAssetMapSecondary,
  IsraAssetMapThreat,
  IsraAssetMapVuln,
  IsraControlMaturityBaseline,
  IsraEvidence,
  IsraAudit,
  IsraOrgSettings,
} from "../models";
import {
  ISRA_DEMO_SCENARIOS,
  ISRA_DEMO_ASSET_MAPS,
  ISRA_DEMO_EXISTING_CONTROLS,
  ISRA_DEMO_EVIDENCE,
  ISRA_DEMO_AUDIT,
  ISRA_DEMO_INITIATIVES,
  ISRA_DEMO_SETTINGS,
  ISRA_DEMO_CONTROL_BASELINE,
  type IsraDemoScenarioRow,
} from "./isra.tenantDemo.data";

/**
 * ISRA tenant demo workspace — the risk register the demo tenant opens with.
 *
 * `seedIsraLibrary()` seeds the GLOBAL knowledge base (Annex A, threats,
 * vulns, asset taxonomy, knowledge maps). This seeder is the tenant-scoped
 * layer on top of it: OD's own generated demo register (`_israBulkScenV4` and
 * friends), snapshotted into `isra.tenantDemo.data.ts` by
 * `fe-vibes-new/tools/regen-od-tenant-isra.cjs`.
 *
 * It is NOT idempotent in the converging sense the library seeders are, and
 * deliberately so: this is demo *working* data that a user edits in place, so
 * re-running must never overwrite their edits. It seeds only into an empty
 * register and otherwise reports `skipped`.
 *
 * FK guard: scenarios reference `isra_threat_library`/`isra_vuln_library` and
 * baselines reference `isra_annexa_controls`. A row whose target is missing is
 * skipped and counted rather than crashing the seed mid-way — a non-zero skip
 * count means the demo snapshot has drifted from the library seed.
 */

/** OD's `potentialImpacts[].perspective` is the model's `area`. */
type DemoImpact = { perspective: string; severity: number; note: string };
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
/**
 * A parsed timestamp, or null. Guards against two shapes OD emits that Postgres
 * rejects outright: the empty string, and anything that parses to an Invalid
 * Date. `new Date("")` is Invalid Date, which Sequelize stringifies to the
 * literal "Invalid date" and the driver then refuses.
 */
const date = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * A `DATEONLY` value (`YYYY-MM-DD`), or null.
 *
 * 785 of OD's 801 scenarios carry `reviewDue: ""`. An empty string is not
 * nullish, so `?? null` passes it through to a date column and the whole seed
 * aborts on the first batch. OD also writes some of these as full ISO
 * timestamps, which a DATEONLY column will not take either — both are narrowed
 * to a plain date here.
 */
const dateOnly = (v: unknown): string | null => {
  const d = date(v);
  return d ? d.toISOString().slice(0, 10) : null;
};
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export interface IsraTenantDemoResult {
  skipped: boolean;
  scenarios: number;
  vulns: number;
  impacts: number;
  currentRisk: number;
  existingControls: number;
  treatments: number;
  recSnapshots: number;
  recDispositions: number;
  addedControls: number;
  rtps: number;
  rtpActions: number;
  projected: number;
  residual: number;
  cycles: number;
  assetMaps: number;
  evidence: number;
  audit: number;
  initiatives: number;
  controlBaseline: number;
  skippedScenarios: number;
  skippedVulns: number;
  skippedBaseline: number;
}

const EMPTY: IsraTenantDemoResult = {
  skipped: true, scenarios: 0, vulns: 0, impacts: 0, currentRisk: 0, existingControls: 0,
  treatments: 0, recSnapshots: 0, recDispositions: 0, addedControls: 0, rtps: 0, rtpActions: 0,
  projected: 0, residual: 0, cycles: 0, assetMaps: 0, evidence: 0, audit: 0, initiatives: 0,
  controlBaseline: 0, skippedScenarios: 0, skippedVulns: 0, skippedBaseline: 0,
};

/** Scenario core + its vuln / impact / current-risk children. */
function scenarioRows(orgId: string, rows: IsraDemoScenarioRow[], idOf: Map<string, string>) {
  const scenarios = rows.map((s) => ({
    id: idOf.get(s.id)!,
    orgId,
    code: s.id,
    primaryAssetRef: s.primaryAssetId,
    primaryAssetSource: "platform",
    processRef: s.process || null,
    secondaryAssetRef: s.secondaryAssetId,
    secondaryAssetSource: "platform",
    threatId: s.threatId,
    title: s.title,
    status: s.status,
    cia: s.cia ?? {},
    ciaDesc: s.ciaDesc ?? {},
    impactOverride: (s.impactOverride ?? null) as IsraScenario["impactOverride"],
    inherentL: s.inherentL ?? 1,
    likelihoodNote: s.likelihoodNote ?? null,
    evalCycle: s.evalCycle ?? 1,
    reviewDue: dateOnly(s.reviewDue),
    createdBy: s.createdBy ?? null,
    activity: s.activity ?? [],
    comments: [],
    createdAt: date(s.createdAt) ?? new Date(),
    updatedAt: date(s.updatedAt) ?? date(s.createdAt) ?? new Date(),
  }));
  return scenarios;
}

export async function seedIsraTenantDemo(orgId: string): Promise<IsraTenantDemoResult> {
  if ((await IsraScenario.count({ where: { orgId } })) > 0) return EMPTY;

  const [threatIds, vulnIds, annexRefs] = await Promise.all([
    IsraThreatLibrary.findAll({ attributes: ["id"] }).then((r) => new Set(r.map((x) => x.id))),
    IsraVulnLibrary.findAll({ attributes: ["id"] }).then((r) => new Set(r.map((x) => x.id))),
    IsraAnnexAControl.findAll({ attributes: ["ref"] }).then((r) => new Set(r.map((x) => x.ref))),
  ]);

  const usable = ISRA_DEMO_SCENARIOS.filter((s) => threatIds.has(s.threatId));
  const skippedScenarios = ISRA_DEMO_SCENARIOS.length - usable.length;

  // OD addresses everything by its own `RSC-`/`EXC-` codes; the tables use UUID
  // PKs, so mint the ids up front and keep one code->uuid map for the children.
  const idOf = new Map(usable.map((s) => [s.id, randomUUID()]));

  await IsraScenario.bulkCreate(scenarioRows(orgId, [...usable], idOf));

  const vulnRows: { scenarioId: string; vulnId: string }[] = [];
  let skippedVulns = 0;
  const impactRows: { scenarioId: string; area: string; severity: number; note: string }[] = [];
  const currentRows: Record<string, unknown>[] = [];
  const treatmentRows: Record<string, unknown>[] = [];
  const snapshotRows: Record<string, unknown>[] = [];
  const dispositionRows: Record<string, unknown>[] = [];
  const addedRows: Record<string, unknown>[] = [];
  const rtpRows: Record<string, unknown>[] = [];
  const actionRows: Record<string, unknown>[] = [];
  const actionControlRows: { rtpActionId: string; annexRef: string }[] = [];
  const projectedRows: Record<string, unknown>[] = [];
  const residualRows: Record<string, unknown>[] = [];
  const cycleRows: Record<string, unknown>[] = [];

  for (const s of usable) {
    const scenarioId = idOf.get(s.id)!;

    for (const vid of s.includedVulnIds ?? []) {
      if (vulnIds.has(vid)) vulnRows.push({ scenarioId, vulnId: vid });
      else skippedVulns++;
    }

    for (const p of (s.potentialImpacts ?? []) as DemoImpact[]) {
      impactRows.push({ scenarioId, area: p.perspective, severity: p.severity, note: p.note ?? "" });
    }

    const cur = obj(s.current);
    if (cur) {
      currentRows.push({
        scenarioId,
        method: str(cur.method) ?? "C-capped-quality-gated",
        methodVer: num(cur.methodVer) ?? 1,
        calcAt: date(cur.calcAt),
        iL: num(cur.iL), iImpact: num(cur.iImpact),
        suggestedL: num(cur.suggestedL), suggestedImpact: num(cur.suggestedImpact),
        suggestedScore: num(cur.suggestedScore), suggestedBand: str(cur.suggestedBand),
        confirmedL: num(cur.confirmedL), confirmedImpact: num(cur.confirmedImpact),
        confirmedScore: num(cur.confirmedScore), confirmedBand: str(cur.confirmedBand),
        confirmedAt: date(cur.confirmedAt), confirmedBy: str(cur.confirmedBy),
        overrideRationale: str(cur.overrideRationale),
        needsReview: cur.needsReview === true,
        eligibleControlIds: Array.isArray(cur.eligibleControlIds) ? cur.eligibleControlIds : [],
      });
    }

    const t = obj(s.treatment);
    if (t) {
      treatmentRows.push({
        scenarioId,
        cycle: num(t.cycle) ?? 1,
        version: 1,
        option: str(t.option) ?? "Modify",
        rationale: str(t.rationale),
        decidedBy: str(t.decidedBy),
        decisionDate: dateOnly(t.decisionDate),
        approvalStatus: str(t.approvalStatus),
        approvedBy: str(t.approvedBy),
        approvalDate: dateOnly(t.approvalDate),
        reviewDate: dateOnly(t.reviewDate),
        acceptance: obj(t.acceptance),
        status: str(t.status) ?? "Planning",
        needsReview: t.needsReview === true,
        isCurrent: true,
      });
    }

    const snap = obj(s.recSnapshot);
    if (snap) {
      snapshotRows.push({
        scenarioId,
        // `IsraRecommendedControl` is {annexRef, fromVulns}; OD's snapshot item
        // carries the full vuln objects plus a rendered rationale.
        controls: arr(snap.items).map((it) => ({
          annexRef: String(it.annexRef ?? ""),
          fromVulns: arr(it.vulns).map((v) => String(v.name ?? "")),
        })),
        mapVersion: num(snap.mapVersion),
        generatedAt: date(snap.generatedAt) ?? new Date(),
        isCurrent: true,
      });
    }

    for (const [annexRef, d] of Object.entries(s.recDispositions ?? {})) {
      dispositionRows.push({
        scenarioId, annexRef,
        disposition: d.disposition,
        rationale: d.rationale ?? null,
        existingControlId: null,
      });
    }

    for (const ac of s.addedControls ?? []) {
      addedRows.push({
        scenarioId,
        annexRef: String(ac.annexRef ?? ""),
        relatedVulnNames: Array.isArray(ac.relatedVulnNames) ? ac.relatedVulnNames : [],
        source: "recommendation",
      });
    }

    const rtp = obj(s.rtp);
    if (rtp) {
      const rtpId = randomUUID();
      rtpRows.push({
        id: rtpId,
        scenarioId,
        version: num(rtp.version) ?? 1,
        status: str(rtp.status) ?? "Draft",
        approvedBy: str(rtp.approvedBy),
        approvedAt: date(rtp.approvedAt),
        funding: [],
        monitoring: str(rtp.monitoring),
        completionCriteria: str(rtp.completionCriteria),
        isCurrent: true,
      });
      for (const a of arr(rtp.actions)) {
        const actionId = randomUUID();
        actionRows.push({
          id: actionId,
          rtpId,
          action: String(a.action ?? ""),
          owners: str(a.owner) ? [String(a.owner)] : [],
          targetDate: dateOnly(a.targetDate),
          status: str(a.status) ?? "Planned",
          evidence: str(a.evidenceRequired) ? [String(a.evidenceRequired)] : [],
        });
        const ref = str(a.addedControlRef);
        if (ref) actionControlRows.push({ rtpActionId: actionId, annexRef: ref });
      }
    }

    const proj = obj(s.projected);
    if (proj) {
      projectedRows.push({
        scenarioId,
        suggestedL: null, suggestedImpact: null, suggestedScore: null, suggestedBand: null,
        confirmedL: num(proj.L), confirmedImpact: num(proj.impact),
        confirmedScore: num(proj.score), confirmedBand: str(proj.band),
        rtpVersion: num(proj.rtpVersion),
        adequacy: obj(proj.adequacy),
        confirmedAt: date(proj.assessmentDate),
        confirmedBy: str(proj.assessedBy),
        needsReview: proj.needsReview === true,
      });
    }

    const res = obj(s.residual);
    if (res) {
      residualRows.push({
        scenarioId,
        l: num(res.L), impact: num(res.impact), score: num(res.score), band: str(res.band),
        basis: str(res.basis),
        assessmentDate: dateOnly(res.assessmentDate),
        assessedBy: str(res.assessedBy),
        notes: str(res.rationale),
        adequacy: obj(res.adequacy),
      });
    }

    for (const c of s.cycles ?? []) {
      cycleRows.push({
        scenarioId,
        cycleNumber: num(c.cycle) ?? 1,
        snapshot: c,
        archivedAt: date(c.completedAt) ?? new Date(),
      });
    }
  }

  await IsraScenarioVuln.bulkCreate(vulnRows);
  await IsraScenarioPotentialImpact.bulkCreate(impactRows as never[]);
  await IsraScenarioCurrentRisk.bulkCreate(currentRows as never[]);
  await IsraScenarioTreatmentDecision.bulkCreate(treatmentRows as never[]);
  await IsraScenarioRecommendationSnapshot.bulkCreate(snapshotRows as never[]);
  await IsraScenarioRecommendationDisposition.bulkCreate(dispositionRows as never[]);
  await IsraScenarioAddedControl.bulkCreate(addedRows as never[]);
  await IsraRtp.bulkCreate(rtpRows as never[]);
  await IsraRtpAction.bulkCreate(actionRows as never[]);
  await IsraRtpActionControl.bulkCreate(actionControlRows as never[]);
  await IsraScenarioProjectedResidual.bulkCreate(projectedRows as never[]);
  await IsraScenarioResidual.bulkCreate(residualRows as never[]);
  await IsraScenarioCycle.bulkCreate(cycleRows as never[]);

  /* ── existing controls ─────────────────────────────────────────────── */
  const excIdOf = new Map<string, string>();
  const excRows = ISRA_DEMO_EXISTING_CONTROLS.filter((c) => idOf.has(c.scenarioId)).map((c) => {
    const id = randomUUID();
    excIdOf.set(c.id, id);
    return {
      id, orgId,
      scenarioId: idOf.get(c.scenarioId)!,
      title: c.title ?? c.description,
      description: c.description,
      status: c.status ?? "Implemented",
      affects: c.affects ?? null,
      objective: c.objective ?? null,
      owner: null,
      ceff: {},
      maturity: {},
      maturityByRef: c.maturityByRef ?? {},
      overridePct: null,
      verified: false,
      verifiedEffectiveness: null,
      evidence: [],
      createdBy: c.createdBy ?? null,
      createdAt: date(c.createdAt) ?? new Date(),
      updatedAt: date(c.updatedAt) ?? date(c.createdAt) ?? new Date(),
    };
  });
  await IsraExistingControl.bulkCreate(excRows as never[]);
  await IsraExistingControlAnnexRef.bulkCreate(
    ISRA_DEMO_EXISTING_CONTROLS.flatMap((c) => {
      const ecId = excIdOf.get(c.id);
      return ecId ? (c.annexRefs ?? []).map((annexRef) => ({ existingControlId: ecId, annexRef })) : [];
    }),
  );

  /* ── asset maps ────────────────────────────────────────────────────── */
  let assetMaps = 0;
  for (const m of ISRA_DEMO_ASSET_MAPS) {
    const map = await IsraAssetMap.create({ orgId, primaryAssetRef: m.primaryAssetId, primaryAssetSource: "platform" });
    assetMaps++;
    for (const u of m.usage ?? []) {
      const usage = await IsraAssetMapUsage.create({ assetMapId: map.id, processRef: u.processId ?? u.process });
      for (const sec of u.secondaries ?? []) {
        const secondary = await IsraAssetMapSecondary.create({
          usageId: usage.id,
          secondaryAssetRef: sec.secondaryAssetId ?? sec.name,
          secondaryAssetSource: "platform",
          groupId: sec.groupId ?? null,
          subgroupId: sec.subgroupId ?? null,
        });
        for (const th of sec.threats ?? []) {
          if (!th.threatId || !threatIds.has(th.threatId)) continue;
          const threat = await IsraAssetMapThreat.create({
            secondaryId: secondary.id, threatId: th.threatId, isBaseline: th.b === 1,
          });
          const base = new Set(th.baseVulnIds ?? []);
          await IsraAssetMapVuln.bulkCreate(
            (th.vulnIds ?? [])
              .filter((v) => vulnIds.has(v))
              .map((vulnId) => ({ threatRowId: threat.id, vulnId, isBaseline: base.has(vulnId) })),
          );
        }
      }
    }
  }

  /* ── support tables ────────────────────────────────────────────────── */
  await IsraEvidence.bulkCreate(
    ISRA_DEMO_EVIDENCE.map((e) => ({
      orgId, code: e.id,
      scenarioId: e.scenarioId ? (idOf.get(e.scenarioId) ?? null) : null,
      type: e.type, title: e.title, description: e.description, fileRef: e.fileRef,
      submittedBy: e.submittedBy, submittedAt: date(e.submittedAt),
      relatedKind: e.relatedKind, relatedId: e.relatedId,
      verificationResult: e.verificationResult, verifiedBy: e.verifiedBy, verifiedAt: date(e.verifiedAt),
    })) as never[],
  );

  await IsraAudit.bulkCreate(
    ISRA_DEMO_AUDIT.map((a) => ({
      orgId,
      ts: date(a.ts) ?? new Date(),
      // OD's audit row is `{event, next}`; `next` is the resulting value.
      event: a.event,
      prevValue: null,
      newValue: a.next ? { value: a.next } : null,
      user: a.user,
      scenarioId: a.scenarioId ? (idOf.get(a.scenarioId) ?? null) : null,
      controlId: a.controlId ? (excIdOf.get(a.controlId) ?? null) : null,
    })) as never[],
  );

  let initiatives = 0;
  for (const i of ISRA_DEMO_INITIATIVES) {
    const row = await IsraInitiative.create({
      orgId, code: i.id, title: i.title, description: i.description,
      owner: i.owner, status: i.status, createdAt: date(i.createdAt) ?? new Date(),
    });
    initiatives++;
    await IsraInitiativeScenario.bulkCreate(
      (i.scenarioIds ?? [])
        .filter((code) => idOf.has(code))
        .map((code) => ({ initiativeId: row.id, scenarioId: idOf.get(code)! })),
    );
  }

  const s = ISRA_DEMO_SETTINGS;
  await IsraOrgSettings.upsert({
    orgId,
    // OD keeps the matrix as a label string; the column is JSONB.
    matrix: s.matrix ? { label: s.matrix } : null,
    conseqMethod: s.conseqMethod ?? null,
    requireAccept: s.requireAccept === true,
    requireHigher: s.requireHigher === true,
    autoRec: s.autoRec === true,
    overrideAllowed: s.override === true,
    residualEnabled: s.residual === true,
    reviewFreq: s.reviewFreq ?? null,
    reviewPeriodWithinDays: null,
    reviewPeriodAboveDays: null,
  });

  const baseline = ISRA_DEMO_CONTROL_BASELINE.filter((b) => annexRefs.has(b.annexRef));
  await IsraControlMaturityBaseline.bulkCreate(
    baseline.map((b) => ({
      orgId, annexRef: b.annexRef,
      gov: b.gov ?? null, doc: b.doc ?? null, impl: b.impl ?? null, mon: b.mon ?? null, comp: b.comp ?? null,
      setBy: "System (demo)", setAt: new Date(),
    })) as never[],
  );

  return {
    skipped: false,
    scenarios: usable.length,
    vulns: vulnRows.length,
    impacts: impactRows.length,
    currentRisk: currentRows.length,
    existingControls: excRows.length,
    treatments: treatmentRows.length,
    recSnapshots: snapshotRows.length,
    recDispositions: dispositionRows.length,
    addedControls: addedRows.length,
    rtps: rtpRows.length,
    rtpActions: actionRows.length,
    projected: projectedRows.length,
    residual: residualRows.length,
    cycles: cycleRows.length,
    assetMaps,
    evidence: ISRA_DEMO_EVIDENCE.length,
    audit: ISRA_DEMO_AUDIT.length,
    initiatives,
    controlBaseline: baseline.length,
    skippedScenarios,
    skippedVulns,
    skippedBaseline: ISRA_DEMO_CONTROL_BASELINE.length - baseline.length,
  };
}
