import { Router } from "express";
import * as c from "./israLibrary.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.ISRA_LIBRARY_READ);
const manage = requireAction(ACTIONS.ISRA_LIBRARY_MANAGE);

export const israLibraryRoutes = Router();

israLibraryRoutes.get("/annex-a-controls", read, c.listAnnexA);
israLibraryRoutes.get("/annex-a-controls/:ref", read, c.getAnnexA);
israLibraryRoutes.put("/annex-a-controls/:ref", manage, c.updateAnnexA);

israLibraryRoutes.get("/threats", read, c.listThreats);
israLibraryRoutes.get("/threats/:id", read, c.getThreat);
israLibraryRoutes.post("/threats", manage, c.createThreat);
israLibraryRoutes.put("/threats/:id", manage, c.updateThreat);
israLibraryRoutes.delete("/threats/:id", manage, c.deleteThreat);

israLibraryRoutes.get("/vulns", read, c.listVulns);
israLibraryRoutes.get("/vulns/:id", read, c.getVuln);
israLibraryRoutes.post("/vulns", manage, c.createVuln);
israLibraryRoutes.put("/vulns/:id", manage, c.updateVuln);
israLibraryRoutes.delete("/vulns/:id", manage, c.deleteVuln);

israLibraryRoutes.get("/km/sa-threat", read, c.listKmSaThreat);
israLibraryRoutes.get("/km/threat-vuln", read, c.listKmThreatVuln);
israLibraryRoutes.get("/km/vuln-control", read, c.listKmVulnControl);
israLibraryRoutes.get("/km/meta", read, c.getKmMeta);

israLibraryRoutes.get("/treat-templates", read, c.listTreatTemplates);
israLibraryRoutes.post("/treat-templates", manage, c.createTreatTemplate);
israLibraryRoutes.put("/treat-templates/:id", manage, c.updateTreatTemplate);
israLibraryRoutes.delete("/treat-templates/:id", manage, c.deleteTreatTemplate);

israLibraryRoutes.get("/categories", read, c.listCategories);
