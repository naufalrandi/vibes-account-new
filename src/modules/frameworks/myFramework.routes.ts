import { Router } from "express";
import * as c from "./myFramework.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const myFrameworkRoutes = Router();
myFrameworkRoutes.get("/", requireAction(ACTIONS.MY_FRAMEWORK_READ), c.list);
myFrameworkRoutes.delete("/:subscriptionId", requireAction(ACTIONS.MY_FRAMEWORK_DELETE), c.remove);
