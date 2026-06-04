import { Router } from "express";
import * as c from "./frameworkCatalog.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const frameworkCatalogRoutes = Router();
frameworkCatalogRoutes.get("/", requireAction(ACTIONS.FRAMEWORK_CATALOG_READ), c.catalog);
frameworkCatalogRoutes.post("/:frameworkId/subscribe", requireAction(ACTIONS.FRAMEWORK_CATALOG_SUBSCRIBE), c.subscribe);
