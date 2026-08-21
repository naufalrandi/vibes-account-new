import { Op } from "sequelize";
import {
  IsraAnnexAControl,
  IsraOrgControl,
  IsraSoaJustification,
  IsraScenario,
  IsraExistingControl,
  IsraExistingControlAnnexRef,
  IsraScenarioAddedControl,
  IsraRtp,
  IsraRtpAction,
  IsraRtpActionControl,
} from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError } from "../../lib/errors";

export async function getSoa(auth: AuthContext) {
  // 1. Load all Annex A controls & org custom controls
  const standardControls = await IsraAnnexAControl.findAll({ order: [["ref", "ASC"]] });
  const orgControls = await IsraOrgControl.findAll({ where: { orgId: auth.orgId }, order: [["ref", "ASC"]] });

  // Map of effective controls
  const controlMap = new Map<string, any>();
  for (const s of standardControls) {
    controlMap.set(s.ref, {
      ref: s.ref,
      name: s.name,
      category: s.category,
      type: s.type,
      description: s.description,
      isCustom: false,
    });
  }
  for (const o of orgControls) {
    controlMap.set(o.ref, {
      ref: o.ref,
      name: o.name,
      category: o.category,
      type: o.type,
      description: o.description,
      isCustom: o.custom,
    });
  }

  // 2. Query non-archived scenarios
  const activeScenarios = await IsraScenario.findAll({
    where: {
      orgId: auth.orgId,
      status: { [Op.ne]: "Archived" },
    },
    attributes: ["id", "code", "title"],
  });

  const scenarioIds = activeScenarios.map((s) => s.id);

  // 3. Find all applicable control references
  // 3a. Existing controls
  const existingControls = scenarioIds.length
    ? await IsraExistingControl.findAll({
        where: { scenarioId: { [Op.in]: scenarioIds }, orgId: auth.orgId },
        attributes: ["id", "scenarioId"],
      })
    : [];
  const excIds = existingControls.map((c) => c.id);
  const excAnnexRefs = excIds.length
    ? await IsraExistingControlAnnexRef.findAll({
        where: { existingControlId: { [Op.in]: excIds } },
      })
    : [];

  // 3b. Added controls
  const addedControls = scenarioIds.length
    ? await IsraScenarioAddedControl.findAll({
        where: { scenarioId: { [Op.in]: scenarioIds } },
      })
    : [];

  // 3c. RTP actions
  const rtps = scenarioIds.length
    ? await IsraRtp.findAll({
        where: { scenarioId: { [Op.in]: scenarioIds }, isCurrent: true },
        attributes: ["id", "scenarioId"],
      })
    : [];
  const rtpIds = rtps.map((r) => r.id);
  const rtpActions = rtpIds.length
    ? await IsraRtpAction.findAll({
        where: { rtpId: { [Op.in]: rtpIds } },
        attributes: ["id", "rtpId"],
      })
    : [];
  const rtpActionIds = rtpActions.map((a) => a.id);
  const rtpControlRefs = rtpActionIds.length
    ? await IsraRtpActionControl.findAll({
        where: { rtpActionId: { [Op.in]: rtpActionIds } },
      })
    : [];

  // Build mapping of controlRef -> scenario details
  const applicableScenariosByRef = new Map<string, Set<string>>();
  const markRef = (ref: string, scenId: string) => {
    const set = applicableScenariosByRef.get(ref) || new Set<string>();
    set.add(scenId);
    applicableScenariosByRef.set(ref, set);
  };

  const scenIdByExc = new Map<string, string>();
  for (const ec of existingControls) scenIdByExc.set(ec.id, ec.scenarioId);

  for (const er of excAnnexRefs) {
    const scenId = scenIdByExc.get(er.existingControlId);
    if (scenId) markRef(er.annexRef, scenId);
  }

  for (const ac of addedControls) {
    markRef(ac.annexRef, ac.scenarioId);
  }

  const rtpIdByAction = new Map<string, string>();
  for (const a of rtpActions) rtpIdByAction.set(a.id, (a as any).rtpId);
  const scenIdByRtp = new Map<string, string>();
  for (const r of rtps) scenIdByRtp.set(r.id, r.scenarioId);

  for (const rc of rtpControlRefs) {
    const rtpId = rtpIdByAction.get(rc.rtpActionId);
    if (rtpId) {
      const scenId = scenIdByRtp.get(rtpId);
      if (scenId) markRef(rc.annexRef, scenId);
    }
  }

  // 4. Load justifications
  const justifications = await IsraSoaJustification.findAll({ where: { orgId: auth.orgId } });
  const justMap = new Map<string, string>();
  for (const j of justifications) justMap.set(j.annexRef, j.justification);

  // 5. Combine results
  const scenarioLookup = new Map(activeScenarios.map((s) => [s.id, s.get({ plain: true })]));

  const result = Array.from(controlMap.values()).map((ctrl) => {
    const scenIds = applicableScenariosByRef.get(ctrl.ref);
    const isApplicable = !!scenIds && scenIds.size > 0;
    const scenarios = isApplicable ? Array.from(scenIds).map((id) => scenarioLookup.get(id)).filter(Boolean) : [];

    return {
      ...ctrl,
      applicable: isApplicable,
      scenariosCount: scenarios.length,
      scenarios,
      justification: justMap.get(ctrl.ref) || "",
    };
  });

  return result;
}

export async function saveSoaJustification(
  auth: AuthContext,
  annexRef: string,
  justification: string,
  ip: string | null
) {
  if (!annexRef) throw new BadRequestError("Annex A control reference is required", "REF_REQUIRED");

  let row = await IsraSoaJustification.findOne({
    where: { orgId: auth.orgId, annexRef },
  });

  if (!row) {
    row = await IsraSoaJustification.create({
      orgId: auth.orgId,
      annexRef,
      justification: justification || "",
      updatedBy: auth.userId,
    });
  } else {
    row.justification = justification || "";
    row.updatedBy = auth.userId;
    await row.save();
  }

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    action: "isra.soaJustification.updated",
    entityType: "IsraSoaJustification",
    entityId: row.id,
    sourceIp: ip,
    result: "Success",
  });

  return row.get({ plain: true });
}
