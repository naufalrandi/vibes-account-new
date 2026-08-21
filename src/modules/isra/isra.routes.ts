import { Router } from "express";
import { israTaxonomyRoutes } from "./israTaxonomy.routes";
import { israAssetLibraryRoutes } from "./israAssetLibrary.routes";
import { israLibraryOverrideRoutes } from "./israLibraryOverride.routes";
import { israAssetMapRoutes } from "./israAssetMap.routes";
import { israScenarioRoutes } from "./israScenario.routes";
import { israSoaRoutes } from "./israSoa.routes";
import { israSupportRoutes } from "./israSupport.routes";

/**
 * ISRA + SoA route aggregator.
 */
export const israRoutes = Router();
israRoutes.use("/taxonomy", israTaxonomyRoutes);
israRoutes.use("/catalog", israAssetLibraryRoutes);
israRoutes.use("/lt", israLibraryOverrideRoutes);
israRoutes.use("/asset-maps", israAssetMapRoutes);
israRoutes.use("/scenarios", israScenarioRoutes);
israRoutes.use("/soa", israSoaRoutes);
israRoutes.use("/support", israSupportRoutes);

// For backwards-compatibility with F-2a mount
export const israLibraryRoutes = israRoutes;
