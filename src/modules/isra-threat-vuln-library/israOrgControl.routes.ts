import { Router } from "express";
import * as c from "./israOrgControl.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.ISRA_ORG_CONTROL_READ);
const manage = requireAction(ACTIONS.ISRA_ORG_CONTROL_MANAGE);

export const israOrgControlRoutes = Router();

israOrgControlRoutes.get("/controls", read, c.listControls);
israOrgControlRoutes.get("/controls/:ref", read, c.getControl);
israOrgControlRoutes.put("/controls/:ref", manage, c.upsertControl);
israOrgControlRoutes.delete("/controls/:ref", manage, c.deleteControl);

israOrgControlRoutes.get("/maturity-baselines", read, c.listMaturityBaselines);
israOrgControlRoutes.put("/maturity-baselines/:annexRef", manage, c.upsertMaturityBaseline);
israOrgControlRoutes.delete("/maturity-baselines/:annexRef", manage, c.deleteMaturityBaseline);

israOrgControlRoutes.get("/vuln-control-overlay", read, c.listVulnControlOverlay);
israOrgControlRoutes.post("/vuln-control-overlay", manage, c.createVulnControlOverlay);
israOrgControlRoutes.delete("/vuln-control-overlay/:id", manage, c.deleteVulnControlOverlay);
israOrgControlRoutes.get("/vuln-control-effective", read, c.listEffectiveVulnControlMap);
