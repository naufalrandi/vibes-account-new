import { Router } from "express";
import * as c from "./agreement.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const agreementRoutes = Router();
// `/variables` must precede `/:id` so the catalog route is not captured as an id.
agreementRoutes.get("/variables", requireAction(ACTIONS.AGREEMENT_READ), c.variables);
agreementRoutes.get("/", requireAction(ACTIONS.AGREEMENT_READ), c.list);
agreementRoutes.get("/:id", requireAction(ACTIONS.AGREEMENT_READ), c.get);
agreementRoutes.post("/", requireAction(ACTIONS.AGREEMENT_CREATE), c.create);
agreementRoutes.put("/:id", requireAction(ACTIONS.AGREEMENT_UPDATE), c.update);
agreementRoutes.post("/:id/duplicate", requireAction(ACTIONS.AGREEMENT_CREATE), c.duplicate);
agreementRoutes.delete("/:id", requireAction(ACTIONS.AGREEMENT_DELETE), c.remove);
