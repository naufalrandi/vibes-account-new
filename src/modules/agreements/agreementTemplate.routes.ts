import { Router } from "express";
import * as c from "./agreementTemplate.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const agreementTemplateRoutes = Router();
agreementTemplateRoutes.get("/", requireAction(ACTIONS.AGREEMENT_READ), c.list);
// Static segment must precede the "/:id" param route so it isn't shadowed.
agreementTemplateRoutes.get("/variables", requireAction(ACTIONS.AGREEMENT_READ), c.variables);
agreementTemplateRoutes.get("/:id", requireAction(ACTIONS.AGREEMENT_READ), c.get);
agreementTemplateRoutes.post("/", requireAction(ACTIONS.AGREEMENT_CREATE), c.create);
agreementTemplateRoutes.post("/:id/duplicate", requireAction(ACTIONS.AGREEMENT_CREATE), c.duplicate);
agreementTemplateRoutes.put("/:id", requireAction(ACTIONS.AGREEMENT_UPDATE), c.update);
agreementTemplateRoutes.delete("/:id", requireAction(ACTIONS.AGREEMENT_DELETE), c.remove);
