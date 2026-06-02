import { Router } from "express";
import * as c from "./menu.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const menuRoutes = Router();
menuRoutes.get("/", c.myMenu); // any authenticated user gets their own menu tree
menuRoutes.get("/all", requireAction(ACTIONS.MENU_READ), c.listMenus);
menuRoutes.post("/", requireAction(ACTIONS.MENU_MANAGE), c.createMenu);
