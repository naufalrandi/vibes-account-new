import { Router } from "express";
import { israTaxonomyRoutes } from "./israTaxonomy.routes";
import { israAssetLibraryRoutes } from "./israAssetLibrary.routes";
import { israLibraryOverrideRoutes } from "./israLibraryOverride.routes";
import { israAssetMapRoutes } from "./israAssetMap.routes";
import { israScenarioRoutes } from "./israScenario.routes";
import { israSoaRoutes } from "./israSoa.routes";
import { israSupportRoutes } from "./israSupport.routes";

/**
 * ISRA + SoA route aggregator. Mounted at exactly one prefix, "/v1/isra"
 * (src/app.ts) — see P-6.2: this file used to also export its Router under
 * the name `israLibraryRoutes` "for backwards-compatibility with F-2a
 * mount", which app.ts imported and re-aliased to `israAssetLibraryRoutes`.
 * That alias collided in *name* (not value) with the real asset-library
 * router (`./israAssetLibrary.routes`'s own `israAssetLibraryRoutes`,
 * primary/secondary assets only) and led app.ts to mount this aggregator at
 * "/v1/isra-asset-library" instead of the real router — so
 * GET /v1/isra-asset-library/primary-assets 404'd even though the FE has
 * called it since the ISRA module shipped. Fixed by giving this aggregator
 * one name and one mount, and importing the real asset-library router
 * directly for its own prefix.
 */
export const israRoutes = Router();
israRoutes.use("/taxonomy", israTaxonomyRoutes);
israRoutes.use("/catalog", israAssetLibraryRoutes);
israRoutes.use("/lt", israLibraryOverrideRoutes);
israRoutes.use("/asset-maps", israAssetMapRoutes);
israRoutes.use("/scenarios", israScenarioRoutes);
israRoutes.use("/soa", israSoaRoutes);
israRoutes.use("/support", israSupportRoutes);
