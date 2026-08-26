import { Router } from "express";
import * as c from "./business.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const businessRoutes = Router();
businessRoutes.post("/enterprise/ent-projects/from-proposal/:proposalId", requireAction(ACTIONS.BUSINESS_MANAGE), c.createFromProposal);
businessRoutes.post("/exelera/ex-cab/:id/price", requireAction(ACTIONS.BUSINESS_MANAGE), c.priceCabClient);
businessRoutes.post("/exelera/ex-cab/:id/issue-certificate", requireAction(ACTIONS.BUSINESS_MANAGE), c.issueCabCertificate);
businessRoutes.get("/:area/:module", requireAction(ACTIONS.BUSINESS_READ), c.list);
businessRoutes.post("/:area/:module", requireAction(ACTIONS.BUSINESS_MANAGE), c.create);
businessRoutes.put("/:area/:module/:id", requireAction(ACTIONS.BUSINESS_MANAGE), c.update);
businessRoutes.delete("/:area/:module/:id", requireAction(ACTIONS.BUSINESS_MANAGE), c.remove);
