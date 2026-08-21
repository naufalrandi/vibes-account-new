import { Router } from "express";
import * as c from "./israTaxonomy.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.ISRA_LIBRARY_READ);
// Table Group A mutations are Service-Owner-only at the service layer
// (`assertServiceOwner`); the action grant gates who even reaches that check.
const admin = requireAction(ACTIONS.ISRA_LIBRARY_ADMIN);

export const israTaxonomyRoutes = Router();

israTaxonomyRoutes.get("/pa-groups", read, c.listPaGroups);
israTaxonomyRoutes.post("/pa-groups", admin, c.createPaGroup);
israTaxonomyRoutes.put("/pa-groups/:id", admin, c.updatePaGroup);
israTaxonomyRoutes.delete("/pa-groups/:id", admin, c.deletePaGroup);

israTaxonomyRoutes.get("/pa-subgroups", read, c.listPaSubgroups);
israTaxonomyRoutes.post("/pa-subgroups", admin, c.createPaSubgroup);
israTaxonomyRoutes.put("/pa-subgroups/:id", admin, c.updatePaSubgroup);
israTaxonomyRoutes.delete("/pa-subgroups/:id", admin, c.deletePaSubgroup);

israTaxonomyRoutes.get("/sa-groups", read, c.listSaGroups);
israTaxonomyRoutes.post("/sa-groups", admin, c.createSaGroup);
israTaxonomyRoutes.put("/sa-groups/:id", admin, c.updateSaGroup);
israTaxonomyRoutes.delete("/sa-groups/:id", admin, c.deleteSaGroup);

israTaxonomyRoutes.get("/sa-subgroups", read, c.listSaSubgroups);
israTaxonomyRoutes.post("/sa-subgroups", admin, c.createSaSubgroup);
israTaxonomyRoutes.put("/sa-subgroups/:id", admin, c.updateSaSubgroup);
israTaxonomyRoutes.delete("/sa-subgroups/:id", admin, c.deleteSaSubgroup);
// The SA Subgroup approval-workflow transition (design doc §1.2) — gates V2
// baseline auto-load via `status === 'Approved'`.
israTaxonomyRoutes.post("/sa-subgroups/:id/status", admin, c.setSaSubgroupStatus);
