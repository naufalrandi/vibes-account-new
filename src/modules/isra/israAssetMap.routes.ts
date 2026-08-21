import { Router } from "express";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";
import * as controller from "./israAssetMap.controller";

const read = requireAction(ACTIONS.ISRA_LIBRARY_READ);
const manage = requireAction(ACTIONS.ISRA_LIBRARY_MANAGE);

export const israAssetMapRoutes = Router();

// Read operations
israAssetMapRoutes.get("/tree", read, controller.getAssetMapTree);
israAssetMapRoutes.get("/secondaries/:secondaryId/diff", read, controller.getBaselineDiff);

// Mutate operations
israAssetMapRoutes.post("/", manage, controller.createAssetMap);
israAssetMapRoutes.delete("/:id", manage, controller.deleteAssetMap);
israAssetMapRoutes.post("/:id/usages", manage, controller.addUsage);
israAssetMapRoutes.delete("/usages/:usageId", manage, controller.deleteUsage);
israAssetMapRoutes.post("/usages/:usageId/secondaries", manage, controller.addSecondary);
israAssetMapRoutes.delete("/secondaries/:secondaryId", manage, controller.deleteSecondary);
israAssetMapRoutes.post("/secondaries/:secondaryId/threats", manage, controller.addThreat);
israAssetMapRoutes.delete("/threats/:threatRowId", manage, controller.deleteThreat);
israAssetMapRoutes.post("/threats/:threatRowId/vulns", manage, controller.addVuln);
israAssetMapRoutes.delete("/vulns/:vulnRowId", manage, controller.deleteVuln);
israAssetMapRoutes.post("/secondaries/:secondaryId/refresh", manage, controller.refreshBaseline);
