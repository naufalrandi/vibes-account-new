import { Router } from "express";
import * as c from "./israLibraryOverride.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.ISRA_LIBRARY_READ);
// Org-level Lt customization (override/item/archive) is a tenant-manage
// action, distinct from the platform-admin `ISRA_LIBRARY_ADMIN` grant used by
// `israTaxonomy.routes.ts`/`israAssetLibrary.routes.ts` — any org with this
// grant may customize its OWN library, enforced by `targetOrg` in the service.
const manage = requireAction(ACTIONS.ISRA_LIBRARY_MANAGE);

export const israLibraryOverrideRoutes = Router();

israLibraryOverrideRoutes.get("/:libType/effective", read, c.listEffective);

israLibraryOverrideRoutes.get("/:libType/overrides", read, c.listOverrides);
israLibraryOverrideRoutes.put("/:libType/overrides/:platformItemId", manage, c.saveOverride);
israLibraryOverrideRoutes.delete("/:libType/overrides/:platformItemId", manage, c.restoreOverride);

israLibraryOverrideRoutes.post("/:libType/items", manage, c.createItem);
israLibraryOverrideRoutes.post("/:libType/items/copy", manage, c.copyItem);
israLibraryOverrideRoutes.put("/:libType/items/:tenantItemId", manage, c.updateItem);

israLibraryOverrideRoutes.get("/:libType/archive", read, c.listArchived);
israLibraryOverrideRoutes.post("/:libType/archive", manage, c.archiveItem);
israLibraryOverrideRoutes.post("/:libType/unarchive", manage, c.unarchiveItem);

// Two literal path segments — does not collide with the `:libType/xxx`
// patterns above (Express only matches this route when the second segment is
// the literal "log").
israLibraryOverrideRoutes.get("/audit/log", read, c.listAudit);
