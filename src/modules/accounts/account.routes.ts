import { Router } from "express";
import * as c from "./account.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const accountRoutes = Router();
accountRoutes.get("/", requireAction(ACTIONS.ACCOUNT_READ), c.list);
accountRoutes.post("/", requireAction(ACTIONS.ACCOUNT_CREATE), c.create);
accountRoutes.put("/:id", requireAction(ACTIONS.ACCOUNT_UPDATE), c.update);
accountRoutes.delete("/:id", requireAction(ACTIONS.ACCOUNT_DELETE), c.remove);
