import { Router } from "express";
import * as c from "./israAssetLibrary.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.ISRA_LIBRARY_READ);
const admin = requireAction(ACTIONS.ISRA_LIBRARY_ADMIN);

export const israAssetLibraryRoutes = Router();

israAssetLibraryRoutes.get("/primary-assets", read, c.listPrimaryAssets);
israAssetLibraryRoutes.post("/primary-assets", admin, c.createPrimaryAsset);
israAssetLibraryRoutes.put("/primary-assets/:id", admin, c.updatePrimaryAsset);
israAssetLibraryRoutes.delete("/primary-assets/:id", admin, c.deletePrimaryAsset);

israAssetLibraryRoutes.get("/secondary-assets", read, c.listSecondaryAssets);
israAssetLibraryRoutes.post("/secondary-assets", admin, c.createSecondaryAsset);
israAssetLibraryRoutes.put("/secondary-assets/:id", admin, c.updateSecondaryAsset);
israAssetLibraryRoutes.delete("/secondary-assets/:id", admin, c.deleteSecondaryAsset);
