import { Router } from "express";
import * as c from "./referenceDb.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// Reuses the existing Enterprise business-unit-register permissions — these
// routes directly replace the generic BusinessRegister for the 5 `ent-db-*`
// modules, so the permission boundary should not change underneath admins.
const read = requireAction(ACTIONS.BUSINESS_READ);
const manage = requireAction(ACTIONS.BUSINESS_MANAGE);

export const referenceDbRoutes = Router();

// [DEPRECATED / ORPHANED — see referenceDb.service.ts "Education Levels"
// section] the Enterprise Education Levels page now reads/writes
// `/v1/competence/education` instead (the store roles actually reference).
// Kept live only for schema stability; slated for removal in a follow-up.
referenceDbRoutes.get("/education-levels", read, c.listEducationLevels);
referenceDbRoutes.post("/education-levels", manage, c.createEducationLevel);
referenceDbRoutes.put("/education-levels/:id", manage, c.updateEducationLevel);
referenceDbRoutes.delete("/education-levels/:id", manage, c.deleteEducationLevel);

referenceDbRoutes.get("/industry-sectors", read, c.listIndustrySectors);
referenceDbRoutes.post("/industry-sectors", manage, c.createIndustrySector);
referenceDbRoutes.put("/industry-sectors/:id", manage, c.updateIndustrySector);
referenceDbRoutes.delete("/industry-sectors/:id", manage, c.deleteIndustrySector);

referenceDbRoutes.get("/education-fields", read, c.listEducationFields);
referenceDbRoutes.post("/education-fields", manage, c.createEducationField);
referenceDbRoutes.put("/education-fields/:id", manage, c.updateEducationField);
referenceDbRoutes.delete("/education-fields/:id", manage, c.deleteEducationField);

referenceDbRoutes.get("/sector-frameworks", read, c.listSectorFrameworks);
referenceDbRoutes.post("/sector-frameworks", manage, c.createSectorFramework);
referenceDbRoutes.put("/sector-frameworks/:id", manage, c.updateSectorFramework);
referenceDbRoutes.delete("/sector-frameworks/:id", manage, c.deleteSectorFramework);

referenceDbRoutes.get("/countries", read, c.listCountries);
referenceDbRoutes.post("/countries", manage, c.createCountry);
referenceDbRoutes.put("/countries/:id", manage, c.updateCountry);
referenceDbRoutes.delete("/countries/:id", manage, c.deleteCountry);

referenceDbRoutes.get("/banks", read, c.listBanks);
referenceDbRoutes.post("/banks", manage, c.createBank);
referenceDbRoutes.put("/banks/:id", manage, c.updateBank);
referenceDbRoutes.delete("/banks/:id", manage, c.deleteBank);

referenceDbRoutes.get("/holidays", read, c.listHolidays);
referenceDbRoutes.post("/holidays", manage, c.createHoliday);
referenceDbRoutes.put("/holidays/:id", manage, c.updateHoliday);
referenceDbRoutes.delete("/holidays/:id", manage, c.deleteHoliday);

referenceDbRoutes.get("/business-processes", read, c.listBpProcesses);
referenceDbRoutes.post("/business-processes", manage, c.createBpProcess);
referenceDbRoutes.put("/business-processes/:id", manage, c.updateBpProcess);
referenceDbRoutes.delete("/business-processes/:id", manage, c.deleteBpProcess);

referenceDbRoutes.get("/fiscal-periods", read, c.getFiscalConfig);
referenceDbRoutes.put("/fiscal-periods", manage, c.updateFiscalConfig);
referenceDbRoutes.patch("/fiscal-periods/:id", manage, c.setFiscalPeriodStatus);
