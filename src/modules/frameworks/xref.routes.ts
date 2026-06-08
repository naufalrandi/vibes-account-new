import { Router } from "express";
import * as c from "./xref.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const xrefRoutes = Router();
xrefRoutes.get("/", requireAction(ACTIONS.XREF_READ), c.get);
